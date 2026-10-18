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
import vehiclesRouter from './routes/vehicles';
import checklistsRouter from './routes/checklists';
import maintenanceRouter from './routes/maintenance';
import journeysRouter from './routes/journeys';
import geocodeRouter from './routes/geocode';
import statementsRouter from './routes/statements';
import uploadsRouter from './routes/uploads';
import transfersRouter from './routes/transfers';
import { emailStatus } from './lib/email';
import platformRouter from './routes/platform';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      'http://localhost:5177',
      'http://localhost:5178',
      'https://app.mbuyucfl.com',
      'https://mbuyucfl.com',
      'https://www.mbuyucfl.com',
    ],
    credentials: true,
  })
);

app.use(express.json({ limit: '15mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mbuyu-cfl-api',
    timestamp: new Date().toISOString(),
    storage: process.env.CLOUDINARY_CLOUD_NAME ? 'cloudinary' : 'unconfigured',
  });
});

app.use('/api/quotes', quotesRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/profile', profileRouter);
app.use('/api/shipments', shipmentsRouter);
app.use('/api/forex', forexRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/checklists', checklistsRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/journeys', journeysRouter);
app.use('/api/geocode', geocodeRouter);
app.use('/api/statements', statementsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/transfers', transfersRouter);
app.use('/api/platform', platformRouter);
app.use('/api', documentsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Mbuyu CFL API running on http://localhost:${PORT}`);
  console.log(`   Health:     http://localhost:${PORT}/health`);
  console.log(`   Uploads:    http://localhost:${PORT}/api/uploads/document`);
  console.log(`   Transfers:  http://localhost:${PORT}/api/transfers`);
  console.log(
    `   Storage:    ${
      process.env.CLOUDINARY_CLOUD_NAME
        ? 'Cloudinary (' + process.env.CLOUDINARY_CLOUD_NAME + ')'
        : 'NOT CONFIGURED — set CLOUDINARY_* env vars'
    }`
  );
  console.log(`   Email:      ${emailStatus()}`);
});