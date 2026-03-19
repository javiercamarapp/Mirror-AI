import { config } from '../config.js';
import { fashnBreaker } from './circuit-breaker.js';
import { logger } from './logger.js';

const isProduction = config.nodeEnv === 'production';

/**
 * Sanitize error messages in production to avoid leaking internal details.
 */
function sanitizeError(error: unknown): Error {
  if (!isProduction) {
    return error instanceof Error ? error : new Error(String(error));
  }
  if (error instanceof Error && error.message.includes('Circuit breaker')) {
    return new Error('Service temporarily unavailable. Please try again later.');
  }
  return new Error('An unexpected error occurred while processing your request.');
}

const BASE_URL = 'https://api.fashn.ai/v1';

type GarmentCategory = 'tops' | 'bottoms' | 'one-pieces';

interface TryOnRequestBody {
  model_image: string;
  garment_image: string;
  category: GarmentCategory;
  mode: string;
  nsfw_filter: boolean;
  cover_feet: boolean;
  adjust_hands: boolean;
  restore_background: boolean;
  restore_clothes: boolean;
  flat_lay: boolean;
  long_top: boolean;
}

interface StatusResponse {
  status: string;
  output?: string[];
  error?: string;
}

interface RunResponse {
  id: string;
  error?: string;
}

function headers(requestId?: string): Record<string, string> {
  const hdrs: Record<string, string> = {
    Authorization: `Bearer ${config.fashnApiKey}`,
    'Content-Type': 'application/json',
  };
  if (requestId) {
    hdrs['X-Request-Id'] = requestId;
  }
  return hdrs;
}

/**
 * Start a virtual try-on prediction.
 * @param modelImage URL of the person / model image.
 * @param garmentImage URL of the garment image.
 * @param category Garment category.
 * @param requestId Optional correlation ID for tracing across services.
 * @returns The prediction ID.
 */
export async function startTryOn(
  modelImage: string,
  garmentImage: string,
  category: GarmentCategory,
  requestId?: string
): Promise<string> {
  try {
    return await fashnBreaker.execute(async () => {
      const body: TryOnRequestBody = {
        model_image: modelImage,
        garment_image: garmentImage,
        category,
        mode: 'quality',
        nsfw_filter: true,
        cover_feet: false,
        adjust_hands: true,
        restore_background: true,
        restore_clothes: true,
        flat_lay: false,
        long_top: false,
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(`${BASE_URL}/run`, {
          method: 'POST',
          headers: headers(requestId),
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Fashn /run failed (${response.status}): ${errorBody.slice(0, 300)}`);
        }

        const data: RunResponse = await response.json();

        if (data.error) {
          throw new Error(`Fashn /run error: ${data.error}`);
        }

        if (!data.id) {
          throw new Error('Fashn /run returned no prediction ID');
        }

        return data.id;
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : String(error) }, 'Fashn startTryOn failed');
    throw sanitizeError(error);
  }
}

/**
 * Check the status of a prediction. Retries up to 2 times on 5xx errors.
 * @param requestId Optional correlation ID for tracing across services.
 */
export async function checkStatus(
  predictionId: string,
  requestId?: string
): Promise<{ status: string; output?: string[]; error?: string }> {
  try {
    return await fashnBreaker.execute(async () => {
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
          const response = await fetch(`${BASE_URL}/status/${predictionId}`, {
            method: 'GET',
            headers: headers(requestId),
            signal: controller.signal,
          });

          if (response.status >= 500 && attempt < maxRetries) {
            const delay = 1000 * Math.pow(2, attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
              `Fashn /status failed (${response.status}): ${errorBody.slice(0, 300)}`
            );
          }

          const data: StatusResponse = await response.json();

          return {
            status: data.status,
            output: data.output,
            error: data.error,
          };
        } finally {
          clearTimeout(timeout);
        }
      }

      throw new Error(`Fashn /status failed after ${maxRetries} retries for prediction ${predictionId}`);
    });
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : String(error), predictionId }, 'Fashn checkStatus failed');
    throw sanitizeError(error);
  }
}

/**
 * Poll for a prediction result until completed or timeout.
 * @param predictionId The prediction ID to poll.
 * @param maxWait Maximum wait time in seconds (default 120).
 * @param requestId Optional correlation ID for tracing across services.
 * @returns The output image URL.
 */
export async function waitForResult(
  predictionId: string,
  maxWait = 120,
  requestId?: string
): Promise<string> {
  const initialInterval = 2000;
  const maxInterval = 15000;
  const deadline = Date.now() + maxWait * 1000;
  let pollInterval = initialInterval;

  while (Date.now() < deadline) {
    const result = await checkStatus(predictionId, requestId);

    if (result.status === 'completed') {
      const url = result.output?.[0];
      if (!url) {
        throw new Error('Fashn prediction completed but returned no output URL');
      }
      return url;
    }

    if (result.status === 'failed') {
      throw new Error(`Fashn prediction failed: ${result.error ?? 'unknown error'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(pollInterval * 2, maxInterval);
  }

  throw new Error(`Fashn prediction timed out after ${maxWait}s (id: ${predictionId})`);
}

/**
 * Run a complete virtual try-on: start prediction and wait for result.
 * @param requestId Optional correlation ID for tracing across services.
 * @returns The final output image URL.
 */
export async function tryOn(
  modelImage: string,
  garmentImage: string,
  category: GarmentCategory,
  requestId?: string
): Promise<string> {
  const predictionId = await startTryOn(modelImage, garmentImage, category, requestId);
  return waitForResult(predictionId, 120, requestId);
}
