import { Hono } from 'hono';
import sharp from 'sharp';
import { authMiddleware } from '../middleware/auth.js';
import { removeBackground } from '../services/rembg.js';
import { uploadImage } from '../services/storage.js';
import { logger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const images = new Hono<{ Variables: AppVariables }>();

// All image routes require authentication
images.use('*', authMiddleware);

// ─── POST /images/upload ──────────────────────────────────────────────────
// Upload an image with automatic resizing and thumbnail generation.
// Body: { image: string (base64), bucket: string }
// Returns { image_url: string, thumbnail_url: string }
images.post('/upload', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      image: string; // base64
      bucket: string;
    }>();

    if (!body.image || !body.bucket) {
      return c.json({ success: false, error: 'image (base64) and bucket are required' }, 400);
    }

    // Validate bucket
    const VALID_BUCKETS = ['wardrobe', 'avatars', 'outfits', 'social'] as const;
    if (!VALID_BUCKETS.includes(body.bucket as typeof VALID_BUCKETS[number])) {
      return c.json({ success: false, error: `Invalid bucket. Must be one of: ${VALID_BUCKETS.join(', ')}` }, 400);
    }

    // Validate image size (base64 is ~4/3 the size of the binary)
    if (body.image.length > 10 * 1024 * 1024 * 4 / 3) {
      return c.json({ success: false, error: 'Image exceeds maximum size of 10MB' }, 400);
    }

    // Strip data URI prefix if present
    const base64Data = body.image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const fileId = uuidv4();
    const bucket = body.bucket as typeof VALID_BUCKETS[number];

    // Process through sharp: full image (max 1200px on longest side)
    // .withMetadata(false) strips all EXIF/IPTC/XMP data (GPS location, camera info, etc.)
    const fullBuffer = await sharp(imageBuffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .withMetadata(false)
      .jpeg()
      .toBuffer();

    // Generate 400px thumbnail (also strip metadata)
    const thumbBuffer = await sharp(imageBuffer)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .withMetadata(false)
      .jpeg()
      .toBuffer();

    // Upload both versions
    const fullPath = `${userId}/${fileId}_full.jpg`;
    const thumbPath = `${userId}/${fileId}_thumb.jpg`;

    const imageUrl = await uploadImage(bucket, fullPath, fullBuffer, 'image/jpeg');
    const thumbnailUrl = await uploadImage(bucket, thumbPath, thumbBuffer, 'image/jpeg');

    return c.json({
      success: true,
      data: { image_url: imageUrl, thumbnail_url: thumbnailUrl },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Image upload failed');
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /images/remove-bg ────────────────────────────────────────────────
// Remove background from image.
// Body: { image: string (base64) }
// Returns { image_url: string } (transparent PNG uploaded to storage)
images.post('/remove-bg', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      image: string; // base64
    }>();

    if (!body.image) {
      return c.json({ success: false, error: 'image (base64) is required' }, 400);
    }

    if (body.image.length > 10 * 1024 * 1024 * 4 / 3) {
      return c.json({ success: false, error: 'Image exceeds maximum size of 10MB' }, 400);
    }

    // Strip data URI prefix if present
    const base64Data = body.image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Remove background
    const noBgBuffer = await removeBackground(imageBuffer);

    // Upload to storage
    const path = `${userId}/nobg_${uuidv4()}.png`;
    const imageUrl = await uploadImage('wardrobe', path, noBgBuffer, 'image/png');

    return c.json({
      success: true,
      data: { image_url: imageUrl },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Background removal failed');
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── POST /images/collage ──────────────────────────────────────────────────
// Generate outfit collage from wardrobe item image URLs.
// Body: { item_urls: string[] } (array of wardrobe item image URLs)
// Uses sharp to compose items into a grid collage.
// Returns { collage_url: string }
images.post('/collage', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json<{
      item_urls: string[];
      width?: number;
      height?: number;
      background_color?: string;
    }>();

    if (!body.item_urls || body.item_urls.length === 0) {
      return c.json({ success: false, error: 'item_urls array is required and must not be empty' }, 400);
    }

    if (body.item_urls.length > 9) {
      return c.json({ success: false, error: 'Maximum 9 items per collage' }, 400);
    }

    const canvasWidth = body.width ?? 1080;
    const canvasHeight = body.height ?? 1080;
    const bgColor = body.background_color ?? '#FFFFFF';
    const padding = 20;

    // SSRF protection: validate URLs against allowed domains
    const ALLOWED_HOSTS = [
      /\.supabase\.co$/,
      /\.supabase\.in$/,
    ];
    for (const url of body.item_urls) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.some(re => re.test(parsed.hostname))) {
          return c.json({ success: false, error: 'URL not allowed: must be HTTPS from approved storage' }, 400);
        }
      } catch {
        return c.json({ success: false, error: `Invalid URL: ${url}` }, 400);
      }
    }

    // Download all item images in parallel (with 5s timeout)
    const downloadResults = await Promise.allSettled(
      body.item_urls.map(async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            throw new Error(`Failed to download: ${url} (${response.status})`);
          }
          const arrayBuffer = await response.arrayBuffer();
          return Buffer.from(arrayBuffer);
        } finally {
          clearTimeout(timeout);
        }
      })
    );

    const imageBuffers: Buffer[] = [];
    for (const result of downloadResults) {
      if (result.status === 'fulfilled') {
        imageBuffers.push(result.value);
      } else {
        logger.error({ err: result.reason }, 'Failed to download collage image');
      }
    }

    if (imageBuffers.length === 0) {
      return c.json({ success: false, error: 'Could not download any of the provided images' }, 400);
    }

    // Calculate grid layout
    const itemCount = imageBuffers.length;
    let cols: number;
    let rows: number;

    if (itemCount <= 1) {
      cols = 1;
      rows = 1;
    } else if (itemCount <= 2) {
      cols = 2;
      rows = 1;
    } else if (itemCount <= 4) {
      cols = 2;
      rows = 2;
    } else if (itemCount <= 6) {
      cols = 3;
      rows = 2;
    } else {
      cols = 3;
      rows = 3;
    }

    const cellWidth = Math.floor((canvasWidth - padding * (cols + 1)) / cols);
    const cellHeight = Math.floor((canvasHeight - padding * (rows + 1)) / rows);

    // Resize all images to fit their cells
    const resizedBuffers: Buffer[] = [];
    for (const imgBuffer of imageBuffers) {
      const resized = await sharp(imgBuffer)
        .resize(cellWidth, cellHeight, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .withMetadata(false)
        .png()
        .toBuffer();
      resizedBuffers.push(resized);
    }

    // Build composite operations
    const compositeOps: sharp.OverlayOptions[] = resizedBuffers.map((buf, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const left = padding + col * (cellWidth + padding);
      const top = padding + row * (cellHeight + padding);

      return {
        input: buf,
        left,
        top,
      };
    });

    // Parse background color
    const hexMatch = bgColor.match(/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
    const bg = hexMatch
      ? { r: parseInt(hexMatch[1]!, 16), g: parseInt(hexMatch[2]!, 16), b: parseInt(hexMatch[3]!, 16), alpha: 1 }
      : { r: 255, g: 255, b: 255, alpha: 1 };

    const collageBuffer = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: bg,
      },
    })
      .composite(compositeOps)
      .png()
      .toBuffer();

    // Upload to storage
    const collagePath = `${userId}/collage_${uuidv4()}.png`;
    const collageUrl = await uploadImage('outfits', collagePath, collageBuffer, 'image/png');

    return c.json({
      success: true,
      data: { collage_url: collageUrl },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err }, 'Collage generation failed');
    return c.json({ success: false, error: message }, 500);
  }
});

export { images as imageRoutes };
