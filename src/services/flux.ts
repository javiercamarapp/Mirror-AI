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

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

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

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
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
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        lastError = new Error(
          `Fireworks API error (${response.status}): ${errorBody.slice(0, 300)}`
        );
        continue;
      }

      const data: FireworksImageResponse = await response.json();

      if (data.error) {
        lastError = new Error(`Fireworks API error: ${data.error.message}`);
        continue;
      }

      if (!data.data || data.data.length === 0) {
        lastError = new Error('Fireworks API returned empty data array');
        continue;
      }

      const b64 = data.data[0]?.b64_json;
      if (!b64) {
        throw new Error('Fireworks API returned no image data');
      }

      return Buffer.from(b64, 'base64');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error('Fireworks API request timed out after 60s');
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error('Fireworks API request failed after retries');
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
