import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import quotesRouter from './routes/quotes';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import profileRouter from './routes/profile';
import shipmentsRouter from './routes/shipments';
import documentsRouter from './routes/documents';
import forexRouter from './routes/forex';

const app = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ───────────────────────────────────────────
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://app.mbuyucfl.com',
      'https://mbuyucfl.com',
      'https://www.mbuyucfl.com',
    ],
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

// ─── Health check ─────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mbuyu-cfl-api',
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────
// ⚠️ ORDER MATTERS: /api/forex must come BEFORE /api (documents)
//    because documents applies auth to everything under /api.
app.use('/api/quotes', quotesRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/profile', profileRouter);
app.use('/api/shipments', shipmentsRouter);
app.use('/api/forex', forexRouter);
app.use('/api', documentsRouter); // documents handles its own /shipments/:id/documents path

// ─── 404 handler ──────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Start server ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Mbuyu CFL API running on http://localhost:${PORT}`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`   Quotes:    http://localhost:${PORT}/api/quotes`);
  console.log(`   Auth:      http://localhost:${PORT}/api/auth`);
  console.log(`   Admin:     http://localhost:${PORT}/api/admin`);
  console.log(`   Profile:   http://localhost:${PORT}/api/profile`);
  console.log(`   Shipments: http://localhost:${PORT}/api/shipments`);
  console.log(`   Forex:     http://localhost:${PORT}/api/forex/rates`);
  console.log(`   Documents: http://localhost:${PORT}/api/shipments/:id/documents`);
});