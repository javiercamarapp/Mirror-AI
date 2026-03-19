import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock dependencies ──────────────────────────────────────────────────────

vi.mock('../../config.js', () => ({
  config: {
    geminiApiKey: 'test-gemini-key',
    nodeEnv: 'test',
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// Mock circuit breaker to pass-through by default
const mockExecute = vi.fn((fn: () => Promise<any>) => fn());
vi.mock('../circuit-breaker.js', () => ({
  geminiBreaker: {
    execute: (fn: () => Promise<any>) => mockExecute(fn),
    getState: vi.fn(() => 'CLOSED'),
    reset: vi.fn(),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Import after mocks ─────────────────────────────────────────────────────
const { generateText, generateJSON, analyzeImage, analyzeImageJSON } = await import('../gemini.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function geminiResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    }),
  };
}

function geminiErrorResponse(status: number, body?: any) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(JSON.stringify(body ?? {})),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Gemini Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockImplementation((fn: () => Promise<any>) => fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── generateText ─────────────────────────────────────────────────────────

  describe('generateText', () => {
    it('should return text from a valid Gemini response', async () => {
      mockFetch.mockResolvedValue(geminiResponse('Hello from Gemini'));

      const result = await generateText('Say hello');
      expect(result).toBe('Hello from Gemini');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should pass system prompt in system_instruction', async () => {
      mockFetch.mockResolvedValue(geminiResponse('response'));

      await generateText('prompt', 'You are a fashion expert');
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.system_instruction).toEqual({
        parts: [{ text: 'You are a fashion expert' }],
      });
    });

    it('should omit system_instruction when no system prompt provided', async () => {
      mockFetch.mockResolvedValue(geminiResponse('response'));

      await generateText('prompt');
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.system_instruction).toBeUndefined();
    });

    it('should throw when Gemini returns empty candidates', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ candidates: [] }),
      });

      await expect(generateText('prompt')).rejects.toThrow('no content');
    });

    it('should throw when response has no text in parts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
        }),
      });

      await expect(generateText('prompt')).rejects.toThrow('no content');
    });

    it('should throw on API error in response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          error: { code: 400, message: 'Bad request', status: 'INVALID_ARGUMENT' },
        }),
      });

      await expect(generateText('prompt')).rejects.toThrow('Gemini API error');
    });

    it('should throw on non-OK HTTP response', async () => {
      mockFetch.mockResolvedValue(geminiErrorResponse(500));

      await expect(generateText('prompt')).rejects.toThrow('failed with status 500');
    });
  });

  // ── generateJSON ─────────────────────────────────────────────────────────

  describe('generateJSON', () => {
    it('should parse valid JSON response', async () => {
      const jsonData = { name: 'Blue Shirt', category: 'tops' };
      mockFetch.mockResolvedValue(geminiResponse(JSON.stringify(jsonData)));

      const result = await generateJSON('Analyze this');
      expect(result).toEqual(jsonData);
    });

    it('should use application/json mime type', async () => {
      mockFetch.mockResolvedValue(geminiResponse('{}'));

      await generateJSON('prompt');
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.generation_config.response_mime_type).toBe('application/json');
    });

    it('should throw on malformed JSON response', async () => {
      mockFetch.mockResolvedValue(geminiResponse('not valid json {'));

      await expect(generateJSON('prompt')).rejects.toThrow('Failed to parse Gemini JSON');
    });

    it('should use lower temperature (0.3) for JSON generation', async () => {
      mockFetch.mockResolvedValue(geminiResponse('{}'));

      await generateJSON('prompt');
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.generation_config.temperature).toBe(0.3);
    });
  });

  // ── analyzeImage ─────────────────────────────────────────────────────────

  describe('analyzeImage', () => {
    it('should analyze image with base64 data', async () => {
      mockFetch.mockResolvedValue(geminiResponse('A blue shirt'));

      const result = await analyzeImage('base64imagedata', 'What is this?');
      expect(result).toBe('A blue shirt');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.contents[0].parts[0].inline_data).toEqual({
        mime_type: 'image/jpeg',
        data: 'base64imagedata',
      });
    });

    it('should include text prompt alongside image', async () => {
      mockFetch.mockResolvedValue(geminiResponse('analysis'));

      await analyzeImage('imgdata', 'Describe this garment');
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.contents[0].parts[1].text).toBe('Describe this garment');
    });
  });

  // ── analyzeImageJSON ─────────────────────────────────────────────────────

  describe('analyzeImageJSON', () => {
    it('should parse JSON response from image analysis', async () => {
      const expected = { category: 'tops', color: 'blue' };
      mockFetch.mockResolvedValue(geminiResponse(JSON.stringify(expected)));

      const result = await analyzeImageJSON('imgdata', 'Categorize');
      expect(result).toEqual(expected);
    });

    it('should throw on malformed vision JSON response', async () => {
      mockFetch.mockResolvedValue(geminiResponse('broken json'));

      await expect(analyzeImageJSON('img', 'p')).rejects.toThrow('Failed to parse Gemini vision JSON');
    });
  });

  // ── Rate limiting (429) ──────────────────────────────────────────────────

  describe('rate limit handling', () => {
    it('should retry on 429 and succeed on subsequent attempt', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce(geminiResponse('success after retry'));

      const result = await generateText('prompt');
      expect(result).toBe('success after retry');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting all retries on persistent 429', { timeout: 15000 }, async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      await expect(generateText('prompt')).rejects.toThrow('failed with status 429');
      // Initial + 3 retries = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  // ── Circuit breaker integration ──────────────────────────────────────────

  describe('circuit breaker integration', () => {
    it('should call through the circuit breaker', async () => {
      mockFetch.mockResolvedValue(geminiResponse('ok'));

      await generateText('prompt');
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('should propagate circuit breaker open error', async () => {
      mockExecute.mockRejectedValue(new Error('Circuit breaker "gemini" is OPEN. Service temporarily unavailable.'));

      await expect(generateText('prompt')).rejects.toThrow();
    });
  });

  // ── Timeout handling ─────────────────────────────────────────────────────

  describe('timeout handling', () => {
    it('should pass an AbortSignal to fetch', async () => {
      mockFetch.mockResolvedValue(geminiResponse('ok'));

      await generateText('prompt');
      const fetchOptions = mockFetch.mock.calls[0][1];
      expect(fetchOptions.signal).toBeDefined();
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('should throw on fetch abort (timeout)', async () => {
      mockFetch.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      await expect(generateText('prompt')).rejects.toThrow();
    });
  });

  // ── Error sanitization ───────────────────────────────────────────────────

  describe('error sanitization', () => {
    it('should log the error on failure', async () => {
      const { logger } = await import('../logger.js');
      mockFetch.mockResolvedValue(geminiErrorResponse(500));

      await expect(generateText('prompt')).rejects.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ── API key in headers ───────────────────────────────────────────────────

  describe('API configuration', () => {
    it('should send x-goog-api-key header', async () => {
      mockFetch.mockResolvedValue(geminiResponse('ok'));

      await generateText('prompt');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-goog-api-key']).toBe('test-gemini-key');
    });

    it('should send Content-Type application/json', async () => {
      mockFetch.mockResolvedValue(geminiResponse('ok'));

      await generateText('prompt');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });
});
