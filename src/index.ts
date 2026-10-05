import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import quotesRouter from './routes/quotes';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import profileRouter from './routes/profile';

const app = express();
const PORT = process.env.PORT || 4000;

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

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mbuyu-cfl-api',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/quotes', quotesRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/profile', profileRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Mbuyu CFL API running on http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   Quotes:  http://localhost:${PORT}/api/quotes`);
  console.log(`   Auth:    http://localhost:${PORT}/api/auth`);
  console.log(`   Admin:   http://localhost:${PORT}/api/admin`);
  console.log(`   Profile: http://localhost:${PORT}/api/profile`);
});