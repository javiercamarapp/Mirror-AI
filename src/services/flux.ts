import { config } from '../config.js';

const FIREWORKS_URL = 'https://api.fireworks.ai/inference/v1/images/generations';
const MODEL = 'accounts/fireworks/models/flux-1-schnell-fp8';

interface FluxOptions {
  width?: number;
  height?: number;
  steps?: number;
}

interface FireworksImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * Generate an image from a text prompt using FLUX.1 schnell via Fireworks.
 * Returns the image as a Buffer (decoded from base64).
 */
export async function generateImage(
  prompt: string,
  opts?: FluxOptions
): Promise<Buffer> {
  const width = opts?.width ?? 1024;
  const height = opts?.height ?? 1024;
  const steps = opts?.steps ?? 4;

  const response = await fetch(FIREWORKS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.fireworksApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      n: 1,
      response_format: 'b64_json',
      size: `${width}x${height}`,
      steps,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Fireworks API error (${response.status}): ${errorBody.slice(0, 300)}`
    );
  }

  const data: FireworksImageResponse = await response.json();

  if (data.error) {
    throw new Error(`Fireworks API error: ${data.error.message}`);
  }

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('Fireworks API returned no image data');
  }

  return Buffer.from(b64, 'base64');
}

/**
 * Generate a fashion outfit image with editorial-quality prompt engineering.
 * Wraps generateImage with fashion-specific modifiers.
 */
export async function generateOutfitImage(
  description: string,
  style: string
): Promise<Buffer> {
  const qualityModifiers =
    'high fashion photography, editorial style, studio lighting, clean background';
  const prompt = `${description}, ${style} style, ${qualityModifiers}`;

  return generateImage(prompt);
}
