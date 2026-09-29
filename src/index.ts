import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import quotesRouter from './routes/quotes';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
  ],
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'mbuyu-cfl-api', timestamp: new Date().toISOString() });
});

app.use('/api/quotes', quotesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Mbuyu CFL API running on http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   Quotes:  http://localhost:${PORT}/api/quotes`);
});