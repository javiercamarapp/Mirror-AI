import { config } from '../config.js';
import { geminiBreaker } from './circuit-breaker.js';
import { logger } from './logger.js';

const isProduction = config.nodeEnv === 'production';

/**
 * Sanitize error messages in production to avoid leaking internal details.
 */
function sanitizeError(error: unknown): Error {
  if (!isProduction) {
    return error instanceof Error ? error : new Error(String(error));
  }
  // In production, return a generic message
  if (error instanceof Error && error.message.includes('Circuit breaker')) {
    return new Error('Service temporarily unavailable. Please try again later.');
  }
  return new Error('An unexpected error occurred while processing your request.');
}

const BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17';

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiTextPart {
  text: string;
}

interface GeminiInlineDataPart {
  inline_data: {
    mime_type: string;
    data: string;
  };
}

type GeminiPart = GeminiTextPart | GeminiInlineDataPart;

interface GeminiRequest {
  contents: GeminiContent[];
  system_instruction?: { parts: GeminiTextPart[] };
  generation_config?: {
    temperature?: number;
    max_output_tokens?: number;
    response_mime_type?: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
    finishReason: string;
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function callGeminiRaw(request: GeminiRequest, requestId?: string): Promise<string> {
  const url = `${BASE_URL}:generateContent`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const hdrs: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      };
      if (requestId) {
        hdrs['X-Request-Id'] = requestId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (response.status === 429 && attempt < MAX_RETRIES) {
        lastError = new Error(`Gemini rate limited (429). Attempt ${attempt + 1}/${MAX_RETRIES}.`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Gemini API request failed with status ${response.status}`);
      }

      const data: GeminiResponse = await response.json();

      if (data.error) {
        throw new Error(`Gemini API error [${data.error.code}]: ${data.error.message}`);
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text === undefined || text === null) {
        throw new Error('Gemini returned no content in response');
      }

      return text;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error('Gemini request failed after retries');
}

/**
 * Call Gemini API wrapped with circuit breaker for fault tolerance.
 * @param requestId Optional correlation ID propagated to the external API.
 */
async function callGemini(request: GeminiRequest, requestId?: string): Promise<string> {
  try {
    return await geminiBreaker.execute(() => callGeminiRaw(request, requestId));
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : String(error), requestId }, 'Gemini API call failed');
    throw sanitizeError(error);
  }
}

function buildSystemInstruction(systemPrompt?: string): { parts: GeminiTextPart[] } | undefined {
  if (!systemPrompt) return undefined;
  return { parts: [{ text: systemPrompt }] };
}

/**
 * Generate text from a prompt.
 * @param requestId Optional correlation ID for tracing across services.
 */
export async function generateText(prompt: string, systemPrompt?: string, requestId?: string): Promise<string> {
  const request: GeminiRequest = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    system_instruction: buildSystemInstruction(systemPrompt),
    generation_config: {
      temperature: 0.7,
      max_output_tokens: 4096,
    },
  };

  return callGemini(request, requestId);
}

/**
 * Generate text and parse the response as JSON.
 * @param requestId Optional correlation ID for tracing across services.
 */
export async function generateJSON<T>(prompt: string, systemPrompt?: string, requestId?: string): Promise<T> {
  const request: GeminiRequest = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    system_instruction: buildSystemInstruction(systemPrompt),
    generation_config: {
      temperature: 0.3,
      max_output_tokens: 4096,
      response_mime_type: 'application/json',
    },
  };

  const raw = await callGemini(request, requestId);

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Failed to parse Gemini JSON response: ${raw.slice(0, 200)}`);
  }
}

/**
 * Analyze an image with a text prompt using Gemini vision.
 * @param requestId Optional correlation ID for tracing across services.
 */
export async function analyzeImage(imageBase64: string, prompt: string, requestId?: string): Promise<string> {
  const request: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
    generation_config: {
      temperature: 0.3,
      max_output_tokens: 4096,
    },
  };

  return callGemini(request, requestId);
}

/**
 * Analyze an image with a text prompt and parse the response as JSON.
 * @param requestId Optional correlation ID for tracing across services.
 */
export async function analyzeImageJSON<T>(imageBase64: string, prompt: string, requestId?: string): Promise<T> {
  const request: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
          { text: prompt },
        ],
      },
    ],
    generation_config: {
      temperature: 0.3,
      max_output_tokens: 4096,
      response_mime_type: 'application/json',
    },
  };

  const raw = await callGemini(request, requestId);

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Failed to parse Gemini vision JSON response: ${raw.slice(0, 200)}`);
  }
}
