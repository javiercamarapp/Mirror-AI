import sharp from 'sharp';
import { config } from '../config.js';

/**
 * Remove the background from an image buffer.
 *
 * If BIREFNET_API_URL is configured, uses the external BiRefNet API.
 * Otherwise falls back to a simple sharp-based center-crop with transparency.
 *
 * @returns A Buffer containing a transparent PNG.
 */
export async function removeBackground(imageBuffer: Buffer): Promise<Buffer> {
  if (config.birefnetApiUrl) {
    return removeBackgroundExternal(imageBuffer);
  }
  return removeBackgroundFallback(imageBuffer);
}

/**
 * Download an image from a URL and remove its background.
 */
export async function removeBackgroundFromUrl(imageUrl: string): Promise<Buffer> {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status}): ${imageUrl}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return removeBackground(buffer);
}

/**
 * Use the external BiRefNet API to remove the background.
 */
async function removeBackgroundExternal(imageBuffer: Buffer): Promise<Buffer> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
  formData.append('image', blob, 'image.png');

  const response = await fetch(config.birefnetApiUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `BiRefNet API error (${response.status}): ${errorBody.slice(0, 300)}`
    );
  }

  const contentType = response.headers.get('content-type') ?? '';

  // If the API returns raw image bytes
  if (contentType.includes('image/')) {
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // If the API returns JSON with base64 data
  const data = await response.json();
  if (data.image) {
    return Buffer.from(data.image, 'base64');
  }
  if (data.output) {
    // Some APIs return a URL in the output field
    const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
    if (typeof outputUrl === 'string' && outputUrl.startsWith('http')) {
      const imgResponse = await fetch(outputUrl);
      if (!imgResponse.ok) {
        throw new Error(`Failed to download BiRefNet output from ${outputUrl}`);
      }
      const ab = await imgResponse.arrayBuffer();
      return Buffer.from(ab);
    }
    // Assume base64
    return Buffer.from(outputUrl, 'base64');
  }

  throw new Error('BiRefNet API returned an unrecognized response format');
}

/**
 * Fallback: use sharp to create a center-cropped image with a soft-edge
 * transparency vignette. Not a real background removal, but provides a
 * usable result when no external API is available.
 */
async function removeBackgroundFallback(imageBuffer: Buffer): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  const width = metadata.width ?? 512;
  const height = metadata.height ?? 512;

  // Create an elliptical alpha mask to approximate subject isolation.
  // The center of the image gets full opacity; edges fade to transparent.
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const rx = Math.round(width * 0.42);
  const ry = Math.round(height * 0.48);

  const maskSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" rx="${rx}" ry="${ry}"
          gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}">
          <stop offset="0.7" stop-color="white"/>
          <stop offset="1" stop-color="black"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#g)"/>
    </svg>`
  );

  const mask = await sharp(maskSvg).resize(width, height).grayscale().raw().toBuffer();

  // Ensure base image is in raw RGBA
  const rawImage = await sharp(imageBuffer)
    .resize(width, height, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  // Apply the mask to the alpha channel
  const pixels = Buffer.from(rawImage);
  for (let i = 0; i < width * height; i++) {
    const alphaIndex = i * 4 + 3;
    const maskValue = mask[i] ?? 0;
    // Multiply existing alpha with mask
    pixels[alphaIndex] = Math.round((pixels[alphaIndex]! * maskValue) / 255);
  }

  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
