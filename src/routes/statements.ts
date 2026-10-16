import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

interface StatementLine {
  id: string;
  date: string;
  type: 'quote' | 'shipment';
  reference: string;
  description: string;
  route: string;
  currency: string | null;
  amount: number | null;
  taxName: string | null;
  taxAmount: number | null;
  total: number | null;
  status: string;
  runningBalance: number;
}

async function buildStatement(customerEmail: string) {
  const email = customerEmail.toLowerCase();

  const [quotes, shipments] = await Promise.all([
    prisma.quote.findMany({
      where: { email },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.shipment.findMany({
      where: { customerEmail: email },
      include: { quote: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Shipment references already cover their linked quote — skip those quotes
  const linkedQuoteRefs = new Set(
    shipments.map((s) => s.quote?.reference).filter(Boolean) as string[]
  );

  const lines: StatementLine[] = [];

  for (const q of quotes) {
    if (linkedQuoteRefs.has(q.reference)) continue;
    const base = parseFloat(q.quotedAmount || '0') || null;
    const tax = parseFloat(q.taxAmount || '0') || null;
    const total =
      base !== null || tax !== null ? (base || 0) + (tax || 0) : null;
    lines.push({
      id: `q-${q.id}`,
      date: q.createdAt.toISOString(),
      type: 'quote',
      reference: q.reference,
      description: `${q.cargoType} — ${
        q.cargoDescription?.slice(0, 60) || 'Cargo'
      }`,
      route: `${q.originCity}, ${q.originCountry} → ${q.destinationCity}, ${q.destinationCountry}`,
      currency: q.quotedCurrency || null,
      amount: base,
      taxName: q.taxName || null,
      taxAmount: tax,
      total,
      status: q.status,
      runningBalance: 0,
    });
  }

  for (const s of shipments) {
    const linkedQuote = s.quote;
    const base = linkedQuote?.quotedAmount
      ? parseFloat(linkedQuote.quotedAmount) || null
      : null;
    const tax = linkedQuote?.taxAmount
      ? parseFloat(linkedQuote.taxAmount) || null
      : null;
    const total =
      base !== null || tax !== null ? (base || 0) + (tax || 0) : null;
    lines.push({
      id: `s-${s.id}`,
      date: s.createdAt.toISOString(),
      type: 'shipment',
      reference: s.trackingNumber,
      description: `${s.cargoType} — ${s.description?.slice(0, 60) || 'Shipment'}`,
      route: `${s.originCity}, ${s.originCountry} → ${s.destinationCity}, ${s.destinationCountry}`,
      currency: linkedQuote?.quotedCurrency || null,
      amount: base,
      taxName: linkedQuote?.taxName || null,
      taxAmount: tax,
      total,
      status: s.status,
      runningBalance: 0,
    });
  }

  lines.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Running balance — only billable lines count
  let running = 0;
  const withBalance = lines.map((l) => {
    const isBillable =
      l.total !== null &&
      (l.type === 'shipment' ||
        (l.type === 'quote' &&
          (l.status === 'ACCEPTED' || l.status === 'QUOTED')));
    if (isBillable && l.total) running += l.total;
    return { ...l, runningBalance: Number(running.toFixed(2)) };
  });

  const currency = withBalance.find((l) => l.currency)?.currency || 'USD';

  return {
    lines: withBalance,
    summary: {
      currency,
      totalQuoted: Number(
        withBalance
          .filter((l) => l.type === 'quote' && l.total)
          .reduce((s, l) => s + (l.total || 0), 0)
          .toFixed(2)
      ),
      totalInvoiced: Number(
        withBalance
          .filter((l) => l.type === 'shipment' && l.total)
          .reduce((s, l) => s + (l.total || 0), 0)
          .toFixed(2)
      ),
      outstandingBalance: Number(running.toFixed(2)),
      quoteCount: withBalance.filter((l) => l.type === 'quote').length,
      shipmentCount: withBalance.filter((l) => l.type === 'shipment').length,
    },
  };
}

router.use(requireAuth);

// ─── GET /api/statements/my — customer's own ──────────────
router.get('/my', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });
    const statement = await buildStatement(req.user!.email);
    res.json({
      customer: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            companyName: user.companyName,
            address: user.address,
            city: user.city,
            country: user.country,
          }
        : { name: req.user!.email, email: req.user!.email },
      ...statement,
    });
  } catch (err) {
    console.error('[GET /statements/my]', err);
    res.status(500).json({ error: 'Failed to build statement' });
  }
});

// ─── GET /api/statements/customers — admin list ───────────
router.get(
  '/customers',
  requireRole('ADMIN'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const customers = await prisma.user.findMany({
        where: { role: 'CUSTOMER' },
        orderBy: { createdAt: 'desc' },
      });

      const withSummary = await Promise.all(
        customers.map(async (c) => {
          const [quotes, shipments] = await Promise.all([
            prisma.quote.findMany({
              where: { email: c.email.toLowerCase() },
              select: {
                quotedAmount: true,
                taxAmount: true,
                quotedCurrency: true,
                status: true,
              },
            }),
            prisma.shipment.findMany({
              where: { customerEmail: c.email.toLowerCase() },
              select: { id: true },
            }),
          ]);

          const totalBilled = quotes
            .filter((q) => q.status === 'ACCEPTED' || q.status === 'QUOTED')
            .reduce((sum, q) => {
              const base = parseFloat(q.quotedAmount || '0') || 0;
              const tax = parseFloat(q.taxAmount || '0') || 0;
              return sum + base + tax;
            }, 0);

          const currency =
            quotes.find((q) => q.quotedCurrency)?.quotedCurrency || 'USD';

          return {
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            companyName: c.companyName,
            createdAt: c.createdAt,
            registrationCompleted: c.registrationCompleted,
            quoteCount: quotes.length,
            shipmentCount: shipments.length,
            totalBilled: Number(totalBilled.toFixed(2)),
            currency,
          };
        })
      );

      res.json(withSummary);
    } catch (err) {
      console.error('[GET /statements/customers]', err);
      res.status(500).json({ error: 'Failed to fetch customers' });
    }
  }
);

// ─── GET /api/statements/customer/:email — admin detail ───
router.get(
  '/customer/:email',
  requireRole('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const email = String(req.params.email).toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      const statement = await buildStatement(email);
      res.json({
        customer: user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              phone: user.phone,
              companyName: user.companyName,
              tinNumber: user.tinNumber,
              ninNumber: user.ninNumber,
              passportNumber: user.passportNumber,
              address: user.address,
              city: user.city,
              country: user.country,
              createdAt: user.createdAt,
            }
          : { name: email, email },
        ...statement,
      });
    } catch (err) {
      console.error('[GET /statements/customer/:email]', err);
      res.status(500).json({ error: 'Failed to build statement' });
    }
  }
);

export default router;