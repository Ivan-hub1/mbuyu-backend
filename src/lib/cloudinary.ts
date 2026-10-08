import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;

/**
 * Upload a buffer to Cloudinary.
 * Returns the secure URL, public_id, and file size.
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<{ url: string; publicId: string; bytes: number }> {
  const isPdf = mimeType === 'application/pdf';
  const isImage = mimeType.startsWith('image/');

  // For PDFs use 'raw' resource type, for images use 'image', else 'auto'
  const resourceType = isPdf ? 'raw' : isImage ? 'image' : 'auto';

  const timestamp = Date.now();
  const safeName = originalName
    .replace(/\.[^/.]+$/, '') // strip extension
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 50);

  const publicId = `mbuyu-cfl/documents/${timestamp}-${safeName}`;

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        public_id: publicId,
        folder: 'mbuyu-cfl',
        use_filename: false,
        unique_filename: false,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Cloudinary upload failed'));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          bytes: result.bytes,
        });
      }
    );

    uploadStream.end(buffer);
  });
}