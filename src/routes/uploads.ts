import { Router, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Cloudinary config ─────────────────────────────────────
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY = process.env.CLOUDINARY_API_KEY || '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.warn(
    '[uploads] Cloudinary credentials missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'
  );
}

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
  secure: true,
});

// ─── Allowed types ─────────────────────────────────────────
const ALLOWED_MIMES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

// Cloudinary distinguishes "image" vs "raw" resources.
// PDFs must go through "raw" for reliable retrieval.
function resourceTypeFor(mime: string): 'image' | 'raw' {
  return mime === 'application/pdf' ? 'raw' : 'image';
}

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

router.use(requireAuth);

// ─── POST /api/uploads/document ───────────────────────────
// Body: { dataUrl: "data:image/jpeg;base64,..." }
// Uploads to Cloudinary and returns the secure public URL.
router.post('/document', async (req: AuthRequest, res: Response) => {
  try {
    const { dataUrl } = req.body || {};
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      res.status(400).json({ error: 'Invalid data URL' });
      return;
    }

    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: 'Malformed data URL' });
      return;
    }
    const [, mime, base64] = match;

    if (!ALLOWED_MIMES[mime]) {
      res.status(400).json({
        error: `Unsupported file type: ${mime}. Allowed: JPG, PNG, WEBP, PDF`,
      });
      return;
    }

    // Decode to check size
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > MAX_BYTES) {
      res.status(413).json({
        error: `File too large (${(buffer.length / 1024 / 1024).toFixed(
          1
        )} MB). Max is 8 MB.`,
      });
      return;
    }

    const userId = req.user!.userId;
    const resourceType = resourceTypeFor(mime);

    // Upload to Cloudinary via the data URI
    const uploadResult: any = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        dataUrl,
        {
          folder: `mbuyucfl/customer-documents/${userId}`,
          resource_type: resourceType,
          use_filename: false,
          unique_filename: true,
          overwrite: false,
          ...(resourceType === 'raw' && { format: 'pdf' }),
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
    });

    res.status(201).json({
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      filename: uploadResult.public_id,
      mime,
      sizeBytes: buffer.length,
      provider: 'cloudinary',
    });
  } catch (err: any) {
    console.error('[POST /uploads/document]', err);
    const msg =
      err?.message || err?.error?.message || 'Failed to upload to Cloudinary';
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/uploads/mine — list current user's uploads ──
router.get('/mine', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const folder = `mbuyucfl/customer-documents/${userId}`;

    const [images, raws] = await Promise.all([
      cloudinary.api.resources({
        type: 'upload',
        resource_type: 'image',
        prefix: folder,
        max_results: 100,
      }),
      cloudinary.api.resources({
        type: 'upload',
        resource_type: 'raw',
        prefix: folder,
        max_results: 100,
      }),
    ]);

    const combined = [
      ...(images.resources || []),
      ...(raws.resources || []),
    ]
      .map((r: any) => ({
        filename: r.public_id,
        sizeBytes: r.bytes,
        createdAt: r.created_at,
        url: r.secure_url,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json(combined);
  } catch (err: any) {
    console.error('[GET /uploads/mine]', err);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

export default router;