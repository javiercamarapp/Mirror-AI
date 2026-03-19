import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock dependencies ──────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  config: {
    fashnApiKey: 'test-fashn-key',
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

const mockExecute = vi.fn((fn: () => Promise<any>) => fn());
vi.mock('../circuit-breaker.js', () => ({
  fashnBreaker: {
    execute: (fn: () => Promise<any>) => mockExecute(fn),
    getState: vi.fn(() => 'CLOSED'),
    reset: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Import after mocks ─────────────────────────────────────────────────────
const { startTryOn, checkStatus, waitForResult, tryOn } = await import('../fashn.js');

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Fashn Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockImplementation((fn: () => Promise<any>) => fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── startTryOn ───────────────────────────────────────────────────────────

  describe('startTryOn', () => {
    it('should start a try-on and return prediction ID', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'pred-123' }),
      });

      const result = await startTryOn('model-url', 'garment-url', 'tops');
      expect(result).toBe('pred-123');
    });

    it('should send correct request body with all parameters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'pred-456' }),
      });

      await startTryOn('model.jpg', 'garment.jpg', 'bottoms');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model_image).toBe('model.jpg');
      expect(body.garment_image).toBe('garment.jpg');
      expect(body.category).toBe('bottoms');
      expect(body.mode).toBe('quality');
      expect(body.nsfw_filter).toBe(true);
      expect(body.adjust_hands).toBe(true);
    });

    it('should include Authorization header with Bearer token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'pred-1' }),
      });

      await startTryOn('m', 'g', 'tops');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer test-fashn-key');
    });

    it('should throw when API returns error in body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ error: 'Invalid garment image' }),
      });

      await expect(startTryOn('m', 'g', 'tops')).rejects.toThrow('Invalid garment image');
    });

    it('should throw when API returns no prediction ID', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      await expect(startTryOn('m', 'g', 'tops')).rejects.toThrow('no prediction ID');
    });

    it('should throw on non-OK HTTP response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request body'),
      });

      await expect(startTryOn('m', 'g', 'tops')).rejects.toThrow('400');
    });

    it('should pass AbortSignal for timeout', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'pred-1' }),
      });

      await startTryOn('m', 'g', 'tops');
      expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ── checkStatus ──────────────────────────────────────────────────────────

  describe('checkStatus', () => {
    it('should return status for completed prediction', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: 'completed',
          output: ['https://result.jpg'],
        }),
      });

      const result = await checkStatus('pred-123');
      expect(result.status).toBe('completed');
      expect(result.output).toEqual(['https://result.jpg']);
    });

    it('should return processing status', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'processing' }),
      });

      const result = await checkStatus('pred-123');
      expect(result.status).toBe('processing');
      expect(result.output).toBeUndefined();
    });

    it('should return failed status with error', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: 'failed',
          error: 'NSFW content detected',
        }),
      });

      const result = await checkStatus('pred-123');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('NSFW content detected');
    });

    it('should retry on 5xx errors', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('Internal error') })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status: 'completed', output: ['url'] }),
        });

      const result = await checkStatus('pred-123');
      expect(result.status).toBe('completed');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw on non-retryable errors (4xx)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      });

      await expect(checkStatus('pred-999')).rejects.toThrow('404');
    });
  });

  // ── waitForResult ────────────────────────────────────────────────────────

  describe('waitForResult', () => {
    it('should return output URL when prediction completes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: 'completed',
          output: ['https://result.jpg'],
        }),
      });

      const result = await waitForResult('pred-123', 5);
      expect(result).toBe('https://result.jpg');
    });

    it('should throw when prediction fails', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: 'failed',
          error: 'Processing error',
        }),
      });

      await expect(waitForResult('pred-123', 5)).rejects.toThrow('Fashn prediction failed');
    });

    it('should throw on timeout', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'processing' }),
      });

      // Use very short timeout
      await expect(waitForResult('pred-123', 0)).rejects.toThrow('timed out');
    });

    it('should throw when completed but no output URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'completed', output: [] }),
      });

      await expect(waitForResult('pred-123', 5)).rejects.toThrow('no output URL');
    });
  });

  // ── tryOn (end-to-end) ───────────────────────────────────────────────────

  describe('tryOn', () => {
    it('should start prediction and return final result URL', async () => {
      // First call: startTryOn
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'pred-e2e' }),
      });
      // Second call: checkStatus -> completed
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: 'completed',
          output: ['https://final-result.jpg'],
        }),
      });

      const result = await tryOn('model.jpg', 'garment.jpg', 'tops');
      expect(result).toBe('https://final-result.jpg');
    });
  });

  // ── Circuit breaker integration ──────────────────────────────────────────

  describe('circuit breaker integration', () => {
    it('should call through the circuit breaker for startTryOn', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'pred-cb' }),
      });

      await startTryOn('m', 'g', 'tops');
      expect(mockExecute).toHaveBeenCalled();
    });

    it('should propagate circuit breaker open error', async () => {
      mockExecute.mockRejectedValue(new Error('Circuit breaker "fashn" is OPEN'));

      await expect(startTryOn('m', 'g', 'tops')).rejects.toThrow();
    });

    it('should call through circuit breaker for checkStatus', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'processing' }),
      });

      await checkStatus('pred-123');
      expect(mockExecute).toHaveBeenCalled();
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should log errors on startTryOn failure', async () => {
      const { logger } = await import('../logger.js');
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(startTryOn('m', 'g', 'tops')).rejects.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });

    it('should log errors on checkStatus failure', async () => {
      const { logger } = await import('../logger.js');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
      });

      await expect(checkStatus('pred-x')).rejects.toThrow();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
