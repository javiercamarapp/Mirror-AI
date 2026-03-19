import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('../../services/supabase.js', () => ({
  supabaseAdmin: mockSupabase,
}));

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    const userId = c.req.header('X-Test-User-Id');
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
    c.set('userId', userId);
    await next();
  }),
}));

const mockTryOn = vi.fn();
vi.mock('../../services/fashn.js', () => ({
  tryOn: (...args: any[]) => mockTryOn(...args),
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../services/storage.js', () => ({
  uploadImage: vi.fn().mockResolvedValue('https://storage.test/outfits/vton_result.png'),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'vton-uuid'),
}));

// Mock global fetch for downloading VTON result
const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

function chainMock(returnValue: { data: any; error: any; count?: number | null }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'or', 'in', 'ilike', 'contains', 'not', 'gt',
    'single', 'maybeSingle', 'order', 'limit', 'range',
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

const { vtonRoutes } = await import('../../routes/vton.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/vton', vtonRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/vton${path}`, init);
}

const AUTH = { 'X-Test-User-Id': 'user-vton-1' };

describe('VTON Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Generate ──────────────────────────────────────────────────────────

  describe('POST /vton/generate', () => {
    it('should generate a virtual try-on and decrement credits', async () => {
      // Profile with credits and body photo
      const profileChain = chainMock({
        data: { vton_credits: 5, body_photo_url: 'https://storage.test/body.jpg' },
        error: null,
      });

      mockTryOn.mockResolvedValue('https://fashn.ai/result/123.png');

      // Mock fetch for downloading the result image
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      });

      // Mock rpc for credit decrement
      mockSupabase.rpc.mockResolvedValue({ data: 4, error: null });

      // Usage log insert
      const usageChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return profileChain;
        return usageChain;
      });

      const res = await req('POST', '/generate', {
        garment_image_url: 'https://img.com/garment.jpg',
        category: 'tops',
      }, AUTH);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.result_image_url).toBeTruthy();
      expect(json.data.credits_remaining).toBe(4);
    });

    it('should return 400 when garment_image_url is missing', async () => {
      const res = await req('POST', '/generate', { category: 'tops' }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 when category is missing', async () => {
      const res = await req('POST', '/generate', {
        garment_image_url: 'https://img.com/g.jpg',
      }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid category', async () => {
      const res = await req('POST', '/generate', {
        garment_image_url: 'https://img.com/g.jpg',
        category: 'hats',
      }, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 403 when no credits remaining', async () => {
      const profileChain = chainMock({
        data: { vton_credits: 0, body_photo_url: 'https://storage.test/body.jpg' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(profileChain);

      const res = await req('POST', '/generate', {
        garment_image_url: 'https://img.com/g.jpg',
        category: 'tops',
      }, AUTH);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('No virtual try-on credits');
      expect(json.data.credits_remaining).toBe(0);
    });

    it('should return 400 when body photo is not uploaded', async () => {
      const profileChain = chainMock({
        data: { vton_credits: 5, body_photo_url: null },
        error: null,
      });
      mockSupabase.from.mockReturnValue(profileChain);

      const res = await req('POST', '/generate', {
        garment_image_url: 'https://img.com/g.jpg',
        category: 'tops',
      }, AUTH);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('body photo');
    });

    it('should return 409 on credit update conflict', async () => {
      const profileChain = chainMock({
        data: { vton_credits: 1, body_photo_url: 'https://storage.test/body.jpg' },
        error: null,
      });

      mockTryOn.mockResolvedValue('https://fashn.ai/result/456.png');
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(50)),
      });

      // rpc returns null (failure) or error
      mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Credit conflict' } });

      mockSupabase.from.mockReturnValue(profileChain);

      const res = await req('POST', '/generate', {
        garment_image_url: 'https://img.com/g.jpg',
        category: 'tops',
      }, AUTH);

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain('decrement');
    });

    it('should handle Fashn API errors', async () => {
      const profileChain = chainMock({
        data: { vton_credits: 5, body_photo_url: 'https://storage.test/body.jpg' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(profileChain);

      mockTryOn.mockRejectedValue(new Error('Fashn API timeout'));

      const res = await req('POST', '/generate', {
        garment_image_url: 'https://img.com/g.jpg',
        category: 'tops',
      }, AUTH);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Fashn');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/generate', {
        garment_image_url: 'https://img.com/g.jpg',
        category: 'tops',
      });
      expect(res.status).toBe(401);
    });
  });

  // ── Credits ───────────────────────────────────────────────────────────

  describe('GET /vton/credits', () => {
    it('should return credit info for free plan', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'free', vton_credits: 2 },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/credits', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.credits_remaining).toBe(2);
      expect(json.data.credits_total).toBe(3);
      expect(json.data.plan).toBe('free');
    });

    it('should return credit info for premium plan', async () => {
      const chain = chainMock({
        data: { subscription_plan: 'premium', vton_credits: 45 },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/credits', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.credits_remaining).toBe(45);
      expect(json.data.credits_total).toBe(50);
      expect(json.data.plan).toBe('premium');
    });
  });

  // ── History ───────────────────────────────────────────────────────────

  describe('GET /vton/history', () => {
    it('should return paginated VTON history', async () => {
      const chain = chainMock({
        data: [
          { id: 'usage-1', result_image_url: 'https://storage.test/r1.png', credits_used: 1, created_at: '2025-01-01' },
          { id: 'usage-2', result_image_url: 'https://storage.test/r2.png', credits_used: 1, created_at: '2025-01-02' },
        ],
        error: null,
        count: 2,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/history?page=1&limit=10', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.pagination.total).toBe(2);
    });

    it('should cap limit at 50', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/history?limit=100', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.pagination.limit).toBe(50);
    });
  });
});
