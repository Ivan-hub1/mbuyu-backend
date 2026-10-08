import { Router, Response } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, AuthRequest } from '../middleware/auth';
import { uploadToCloudinary } from '../lib/cloudinary';

const router = Router();

// Multer — store file in memory (max 10 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

router.use(requireAuth);

// ─── POST /api/shipments/:id/documents — upload a document ─
router.post(
  '/shipments/:id/documents',
  requireRole('ADMIN', 'STAFF'),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const shipmentId = req.params.id as string;

      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // Check shipment exists and staff can access it
      const shipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
      });
      if (!shipment) {
        res.status(404).json({ error: 'Shipment not found' });
        return;
      }

      if (
        req.user!.role === 'STAFF' &&
        shipment.assignedToId !== req.user!.userId
      ) {
        res.status(403).json({
          error: 'You can only upload documents to shipments assigned to you',
        });
        return;
      }

      // Upload to Cloudinary
      const { url, bytes } = await uploadToCloudinary(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      // Save to database
      const document = await prisma.shipmentDocument.create({
        data: {
          shipmentId: shipment.id,
          fileName: req.file.originalname,
          fileUrl: url,
          fileSize: bytes,
          mimeType: req.file.mimetype,
          uploadedById: req.user!.userId,
        },
        include: {
          uploadedBy: { select: { id: true, name: true, role: true } },
        },
      });

      res.status(201).json(document);
    } catch (err: any) {
      console.error('[POST /documents]', err);
      res.status(500).json({
        error: err?.message || 'Failed to upload document',
      });
    }
  }
);

// ─── DELETE /api/shipments/:id/documents/:docId ──────────
router.delete(
  '/shipments/:id/documents/:docId',
  requireRole('ADMIN', 'STAFF'),
  async (req: AuthRequest, res: Response) => {
    try {
      const docId = req.params.docId as string;

      const doc = await prisma.shipmentDocument.findUnique({
        where: { id: docId },
      });
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      await prisma.shipmentDocument.delete({ where: { id: docId } });
      res.json({ ok: true });
    } catch (err) {
      console.error('[DELETE /documents]', err);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  }
);

export default router;