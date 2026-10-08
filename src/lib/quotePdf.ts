import PDFDocument from 'pdfkit';
import type { Quote } from '@prisma/client';
import path from 'path';
import fs from 'fs';

const BRAND = {
  name: 'Mbuyu CFL',
  tagline: 'Freight & Logistics',
  orange: '#E87A2C',
  dark: '#111111',
  gray: '#666666',
  lightGray: '#EEEEEE',
  contact: {
    email: 'info@mbuyucfl.com',
    phone: '+256 755 028392',
    website: 'www.mbuyucfl.com',
    address: 'Kampala, Uganda',
  },
};

const LOGO_PATH = path.join(__dirname, '..', '..', 'assets', 'mbuyu-logo.png');

function logoExists(): boolean {
  try {
    return fs.existsSync(LOGO_PATH);
  } catch {
    return false;
  }
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function safe(v: string | null | undefined, fallback = '—'): string {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

function money(amount: number, currency: string): string {
  if (isNaN(amount)) return `${currency} 0.00`;
  return `${currency} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function generateQuotePdf(quote: Quote): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `Quotation ${quote.reference}`,
      Author: BRAND.name,
      Subject: 'Freight Quotation',
    },
  });

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 100;

  // ─── HEADER BAR ────────────────────────────────────────
  const HEADER_HEIGHT = 100;
  doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill(BRAND.orange);

  const logoSize = 60;
  const logoX = 50;
  const logoY = (HEADER_HEIGHT - logoSize) / 2;
  let textStartX = 50;

  if (logoExists()) {
    try {
      doc.image(LOGO_PATH, logoX, logoY, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center',
      });
      textStartX = logoX + logoSize + 15;
    } catch (err) {
      console.error('[quote pdf] logo load failed:', err);
    }
  }

  doc
    .fillColor('#FFFFFF')
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(BRAND.name, textStartX, 28, { lineBreak: false });

  doc
    .fontSize(9)
    .font('Helvetica')
    .text(BRAND.tagline, textStartX, 54, { lineBreak: false });

  doc
    .fontSize(9)
    .font('Helvetica')
    .text(BRAND.contact.email, pageWidth - 250, 25, {
      width: 200,
      align: 'right',
      lineBreak: false,
    })
    .text(BRAND.contact.phone, pageWidth - 250, 40, {
      width: 200,
      align: 'right',
      lineBreak: false,
    })
    .text(BRAND.contact.website, pageWidth - 250, 55, {
      width: 200,
      align: 'right',
      lineBreak: false,
    })
    .text(BRAND.contact.address, pageWidth - 250, 70, {
      width: 200,
      align: 'right',
      lineBreak: false,
    });

  // ─── TITLE BLOCK ──────────────────────────────────────
  doc.fillColor(BRAND.dark).fontSize(20).font('Helvetica-Bold');
  doc.text('QUOTATION', 50, 130);

  doc.fontSize(9).font('Helvetica').fillColor(BRAND.gray);
  doc.text(`Reference: ${quote.reference}`, 50, 160);
  doc.text(`Date Issued: ${formatDate(quote.createdAt)}`, 50, 173);
  doc.text(`Valid Until: ${formatDate(addDays(quote.createdAt, 30))}`, 50, 186);

  const statusText = quote.status.replace(/_/g, ' ');
  const badgeWidth = doc.widthOfString(statusText) + 20;
  const badgeX = pageWidth - 50 - badgeWidth;
  doc.roundedRect(badgeX, 130, badgeWidth, 22, 11).fill(BRAND.orange);
  doc
    .fillColor('#FFFFFF')
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(statusText, badgeX, 136, { width: badgeWidth, align: 'center' });

  // ─── CUSTOMER BLOCK ────────────────────────────────────
  let y = 230;
  doc
    .fillColor(BRAND.orange)
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('PREPARED FOR', 50, y);

  y += 18;
  doc.fillColor(BRAND.dark).fontSize(11).font('Helvetica-Bold');
  doc.text(safe(quote.fullName), 50, y);
  y += 15;

  doc.fontSize(9).font('Helvetica').fillColor(BRAND.gray);
  if (quote.companyName) {
    doc.text(safe(quote.companyName), 50, y);
    y += 13;
  }
  doc.text(safe(quote.email), 50, y);
  y += 13;
  doc.text(safe(quote.phone), 50, y);
  y += 13;
  doc.text(`Preferred contact: ${safe(quote.preferredContact)}`, 50, y);

  // ─── SHIPMENT SUMMARY ─────────────────────────────────
  y = 230;
  const rightCol = pageWidth / 2 + 10;
  doc
    .fillColor(BRAND.orange)
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('SHIPMENT SUMMARY', rightCol, y);

  y += 18;
  const shipmentRows: [string, string][] = [
    ['Origin', `${quote.originCity}, ${quote.originCountry}`],
    ['Destination', `${quote.destinationCity}, ${quote.destinationCountry}`],
    ['Cargo Type', quote.cargoType],
    ['Transport Mode', quote.transportMode],
    ['Weight', `${quote.weightKg} kg`],
    ['Volume', quote.volumeCbm ? `${quote.volumeCbm} CBM` : '—'],
    ['Pieces', quote.pieces],
    ['Incoterms', quote.incoterms],
    ['Shipping Date', quote.shippingDate],
  ];

  doc.fontSize(9).font('Helvetica');
  for (const [label, value] of shipmentRows) {
    doc.fillColor(BRAND.gray).text(label, rightCol, y, { width: 100 });
    doc
      .fillColor(BRAND.dark)
      .text(value, rightCol + 100, y, { width: contentWidth / 2 - 100 });
    y += 14;
  }

  // ─── CARGO DESCRIPTION ────────────────────────────────
  y = Math.max(y, 430) + 10;
  doc
    .fillColor(BRAND.orange)
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('CARGO DESCRIPTION', 50, y);

  y += 16;
  doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica');
  doc.text(safe(quote.cargoDescription), 50, y, { width: contentWidth });
  y = doc.y + 10;

  if (quote.specialRequirements) {
    doc
      .fillColor(BRAND.orange)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('SPECIAL REQUIREMENTS', 50, y);
    y += 16;
    doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica');
    doc.text(quote.specialRequirements, 50, y, { width: contentWidth });
    y = doc.y + 10;
  }

  // ─── PRICING BOX (WITH TAX) ───────────────────────────
  y += 10;

  const currency = quote.quotedCurrency || 'USD';
  const baseAmount = quote.quotedAmount ? parseFloat(quote.quotedAmount) : 0;
  const taxRateNum = quote.taxRate ? parseFloat(quote.taxRate) : 0;
  const taxAmt = quote.taxAmount
    ? parseFloat(quote.taxAmount)
    : (baseAmount * taxRateNum) / 100;
  const total = baseAmount + taxAmt;

  const hasAmount = !isNaN(baseAmount) && baseAmount > 0;

  if (hasAmount) {
    const lineHeight = 22;
    const boxHeight = taxAmt > 0 ? 120 : 80;

    doc
      .roundedRect(50, y, contentWidth, boxHeight, 6)
      .fillAndStroke(BRAND.lightGray, BRAND.orange);

    let lineY = y + 15;

    // Subtotal
    doc.fillColor(BRAND.gray).fontSize(10).font('Helvetica-Bold');
    doc.text('Subtotal:', 70, lineY);
    doc
      .fillColor(BRAND.dark)
      .font('Helvetica')
      .text(money(baseAmount, currency), 70, lineY, {
        width: contentWidth - 40,
        align: 'right',
      });
    lineY += lineHeight;

    // Tax line
    if (taxAmt > 0) {
      doc.fillColor(BRAND.gray).font('Helvetica-Bold');
      doc.text(
        `${quote.taxName || 'VAT'} (${taxRateNum.toFixed(0)}%):`,
        70,
        lineY
      );
      doc
        .fillColor(BRAND.dark)
        .font('Helvetica')
        .text(money(taxAmt, currency), 70, lineY, {
          width: contentWidth - 40,
          align: 'right',
        });
      lineY += lineHeight;

      // Separator
      doc
        .moveTo(70, lineY)
        .lineTo(pageWidth - 70, lineY)
        .strokeColor(BRAND.orange)
        .lineWidth(1)
        .stroke();
      lineY += 10;
    }

    // Total
    doc.fillColor(BRAND.orange).fontSize(12).font('Helvetica-Bold');
    doc.text('TOTAL:', 70, lineY);
    doc.text(money(total, currency), 70, lineY, {
      width: contentWidth - 40,
      align: 'right',
    });

    y += boxHeight + 20;
  } else {
    // No amount yet
    doc
      .roundedRect(50, y, contentWidth, 70, 6)
      .fillAndStroke(BRAND.lightGray, BRAND.orange);

    doc
      .fillColor(BRAND.gray)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('TOTAL QUOTED AMOUNT', 70, y + 15);

    doc
      .fillColor(BRAND.orange)
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('To be determined', 70, y + 35);

    y += 90;
  }

  // ─── ADMIN RESPONSE / NOTES ───────────────────────────
  if (quote.adminResponse) {
    doc
      .fillColor(BRAND.orange)
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('NOTES', 50, y);
    y += 16;
    doc.fillColor(BRAND.dark).fontSize(9).font('Helvetica');
    doc.text(quote.adminResponse, 50, y, { width: contentWidth });
    y = doc.y + 15;
  }

  // ─── TERMS ────────────────────────────────────────────
  y += 5;
  doc
    .fillColor(BRAND.orange)
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('TERMS & CONDITIONS', 50, y);

  y += 16;
  doc.fillColor(BRAND.gray).fontSize(8).font('Helvetica');
  const terms = [
    'This quotation is valid for 30 days from the date of issue.',
    'Rates are subject to change based on fuel surcharges and space availability.',
    'Payment terms: 50% deposit on booking, balance before delivery.',
    'Any additional customs duties, taxes, or port charges are the responsibility of the client.',
    'Insurance is not included unless explicitly stated.',
    'Mbuyu CFL is not liable for delays caused by force majeure, customs, or carrier issues.',
  ];
  for (const t of terms) {
    doc.text(`• ${t}`, 50, y, { width: contentWidth });
    y = doc.y + 4;
  }

  // ─── FOOTER ───────────────────────────────────────────
  const footerY = doc.page.height - 80;
  doc
    .moveTo(50, footerY)
    .lineTo(pageWidth - 50, footerY)
    .strokeColor(BRAND.lightGray)
    .stroke();

  doc
    .fillColor(BRAND.gray)
    .fontSize(8)
    .font('Helvetica')
    .text(
      `${BRAND.name} · ${BRAND.contact.email} · ${BRAND.contact.phone} · ${BRAND.contact.address}`,
      50,
      footerY + 12,
      { width: contentWidth, align: 'center' }
    );

  doc
    .fillColor(BRAND.orange)
    .fontSize(9)
    .font('Helvetica-Bold')
    .text('Thank you for your business.', 50, footerY + 30, {
      width: contentWidth,
      align: 'center',
    });

  doc.end();
  return doc;
}

function addDays(d: Date | string, days: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + days);
  return date;
}