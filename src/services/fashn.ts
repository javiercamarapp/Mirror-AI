import { config } from '../config.js';

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

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.fashnApiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Start a virtual try-on prediction.
 * @param modelImage URL of the person / model image.
 * @param garmentImage URL of the garment image.
 * @param category Garment category.
 * @returns The prediction ID.
 */
export async function startTryOn(
  modelImage: string,
  garmentImage: string,
  category: GarmentCategory
): Promise<string> {
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

  const response = await fetch(`${BASE_URL}/run`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
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
}

/**
 * Check the status of a prediction. Retries up to 2 times on 5xx errors.
 */
export async function checkStatus(
  predictionId: string
): Promise<{ status: string; output?: string[]; error?: string }> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${BASE_URL}/status/${predictionId}`, {
      method: 'GET',
      headers: headers(),
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
  }

  throw new Error(`Fashn /status failed after ${maxRetries} retries for prediction ${predictionId}`);
}

/**
 * Poll for a prediction result until completed or timeout.
 * @param predictionId The prediction ID to poll.
 * @param maxWait Maximum wait time in seconds (default 120).
 * @returns The output image URL.
 */
export async function waitForResult(
  predictionId: string,
  maxWait = 120
): Promise<string> {
  const initialInterval = 2000;
  const maxInterval = 15000;
  const deadline = Date.now() + maxWait * 1000;
  let pollInterval = initialInterval;

  while (Date.now() < deadline) {
    const result = await checkStatus(predictionId);

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
 * @returns The final output image URL.
 */
export async function tryOn(
  modelImage: string,
  garmentImage: string,
  category: GarmentCategory
): Promise<string> {
  const predictionId = await startTryOn(modelImage, garmentImage, category);
  return waitForResult(predictionId);
}
