import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Supabase ─────────────────────────────────────────────────────────
const mockSupabase = {
  auth: {
    signInWithIdToken: vi.fn(),
    signInWithOtp: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    refreshSession: vi.fn(),
    getUser: vi.fn(),
    admin: { deleteUser: vi.fn() },
  },
  from: vi.fn(),
  rpc: vi.fn(),
  storage: {
    from: vi.fn(() => ({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
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

vi.mock('../../middleware/subscription.js', () => ({
  requireSubscription: vi.fn(() => async (_c: any, next: any) => {
    await next();
  }),
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

const mockUploadImage = vi.fn().mockResolvedValue('https://storage.example.com/image.png');
const mockDeleteImage = vi.fn().mockResolvedValue(undefined);
const mockExtractPathFromUrl = vi.fn().mockReturnValue('user-1/render.png');

vi.mock('../../services/storage.js', () => ({
  uploadImage: (...args: any[]) => mockUploadImage(...args),
  deleteImage: (...args: any[]) => mockDeleteImage(...args),
  extractPathFromUrl: (...args: any[]) => mockExtractPathFromUrl(...args),
}));

const mockTryOn = vi.fn().mockResolvedValue('https://fashn.example.com/result.png');
vi.mock('../../services/fashn.js', () => ({
  tryOn: (...args: any[]) => mockTryOn(...args),
}));

const mockGenerateImage = vi.fn().mockResolvedValue(Buffer.from('fake-image'));
vi.mock('../../services/flux.js', () => ({
  generateImage: (...args: any[]) => mockGenerateImage(...args),
}));

const mockAnalyzeImageJSON = vi.fn().mockResolvedValue({
  skin_tone: 'medium',
  hair_style: 'short straight',
  hair_color: 'brown',
  face_shape: 'oval',
  body_type: 'athletic',
  gender: 'male',
});
vi.mock('../../services/gemini.js', () => ({
  analyzeImageJSON: (...args: any[]) => mockAnalyzeImageJSON(...args),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

// Mock global fetch for try-on image download
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helper to build chainable query mock
function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in', 'single', 'maybeSingle', 'order', 'limit', 'range', 'ilike', 'contains', 'not', 'gt', 'gte', 'lte'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

// ─── Import route after mocks ──────────────────────────────────────────────
const { avatarRoutes } = await import('../../routes/avatar.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/avatar', avatarRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/avatar${path}`, init);
}

const AUTH_HEADER = { 'X-Test-User-Id': 'user-1' };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Avatar Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST /avatar/generate ──────────────────────────────────────────────

  describe('POST /avatar/generate', () => {
    it('should generate an avatar from a selfie (new user, no existing avatar)', async () => {
      // No existing avatar
      const existingChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({ data: { id: 'test-uuid-1234', user_id: 'user-1', style: 'default' }, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : insertChain;
      });

      const res = await req('POST', '/generate', { selfie: 'dGVzdC1pbWFnZQ==' }, AUTH_HEADER);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.user_id).toBe('user-1');
    });

    it('should update existing avatar when one already exists', async () => {
      const existingChain = chainMock({ data: { id: 'existing-avatar' }, error: null });
      const updateChain = chainMock({ data: { id: 'existing-avatar', user_id: 'user-1', style: 'default' }, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : updateChain;
      });

      const res = await req('POST', '/generate', { selfie: 'dGVzdA==', style: 'anime' }, AUTH_HEADER);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should return 400 when selfie is missing', async () => {
      const res = await req('POST', '/generate', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('selfie');
    });

    it('should return 400 when image exceeds max size', async () => {
      const hugeBase64 = 'a'.repeat(10 * 1024 * 1024 * 4 / 3 + 100);
      const res = await req('POST', '/generate', { selfie: hugeBase64 }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('10MB');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/generate', { selfie: 'dGVzdA==' });
      expect(res.status).toBe(401);
    });

    it('should return 500 when database insert fails', async () => {
      const existingChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({ data: null, error: { message: 'DB error' } });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : insertChain;
      });

      const res = await req('POST', '/generate', { selfie: 'dGVzdA==' }, AUTH_HEADER);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('should handle AI analysis failure gracefully and use defaults', async () => {
      mockAnalyzeImageJSON.mockRejectedValueOnce(new Error('AI service down'));
      const existingChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({ data: { id: 'test-uuid-1234', skin_tone: 'medium' }, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : insertChain;
      });

      const res = await req('POST', '/generate', { selfie: 'dGVzdA==' }, AUTH_HEADER);
      expect(res.status).toBe(201);
    });

    it('should return 500 when Flux image generation fails', async () => {
      mockGenerateImage.mockRejectedValueOnce(new Error('Flux API error'));

      const res = await req('POST', '/generate', { selfie: 'dGVzdA==' }, AUTH_HEADER);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Flux API error');
    });
  });

  // ── GET /avatar ────────────────────────────────────────────────────────

  describe('GET /avatar', () => {
    it('should return the user avatar when it exists', async () => {
      const chain = chainMock({ data: { id: 'av-1', user_id: 'user-1', base_image_url: 'https://example.com/avatar.png' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('av-1');
    });

    it('should return null data when no avatar exists', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeNull();
      expect(json.message).toContain('No avatar found');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '');
      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /avatar/customize ────────────────────────────────────────────

  describe('PATCH /avatar/customize', () => {
    it('should update allowed fields', async () => {
      const chain = chainMock({ data: { id: 'av-1', style: 'anime', hair_style: 'curly' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/customize', { style: 'anime', hair_style: 'curly' }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should return 400 when no valid fields are provided', async () => {
      const res = await req('PATCH', '/customize', { invalid_field: 'value' }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('No valid fields');
    });

    it('should return 404 when avatar not found', async () => {
      const chain = chainMock({ data: null, error: { message: 'Not found' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/customize', { style: 'anime' }, AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('PATCH', '/customize', { style: 'anime' });
      expect(res.status).toBe(401);
    });
  });

  // ── POST /avatar/try-outfit ────────────────────────────────────────────

  describe('POST /avatar/try-outfit', () => {
    it('should perform virtual try-on successfully', async () => {
      const profileChain = chainMock({ data: { vton_credits: 5 }, error: null });
      const avatarChain = chainMock({ data: { base_image_url: 'https://example.com/avatar.png' }, error: null });
      const itemsChain = chainMock({ data: [{ id: 'item-1', category: 'tops', image_url: 'https://example.com/top.png', image_no_bg_url: null }], error: null });
      const renderInsertChain = chainMock({ data: null, error: null });

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return profileChain;
        if (callCount === 2) return avatarChain;
        if (callCount === 3) return itemsChain;
        return renderInsertChain;
      });
      mockSupabase.rpc.mockResolvedValue({ data: 4, error: null });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const res = await req('POST', '/try-outfit', { item_ids: ['item-1'] }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.credits_remaining).toBe(4);
      expect(json.data.result_image_url).toBeDefined();
    });

    it('should return 400 when item_ids is empty', async () => {
      const res = await req('POST', '/try-outfit', { item_ids: [] }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('item_ids');
    });

    it('should return 400 when item_ids is missing', async () => {
      const res = await req('POST', '/try-outfit', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
    });

    it('should return 403 when user has no VTON credits', async () => {
      const profileChain = chainMock({ data: { vton_credits: 0 }, error: null });
      mockSupabase.from.mockReturnValue(profileChain);

      const res = await req('POST', '/try-outfit', { item_ids: ['item-1'] }, AUTH_HEADER);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('credits');
    });

    it('should return 404 when user profile not found', async () => {
      const profileChain = chainMock({ data: null, error: { message: 'Not found' } });
      mockSupabase.from.mockReturnValue(profileChain);

      const res = await req('POST', '/try-outfit', { item_ids: ['item-1'] }, AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it('should return 400 when user has no avatar', async () => {
      const profileChain = chainMock({ data: { vton_credits: 5 }, error: null });
      const avatarChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileChain : avatarChain;
      });

      const res = await req('POST', '/try-outfit', { item_ids: ['item-1'] }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('No avatar found');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/try-outfit', { item_ids: ['item-1'] });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /avatar/renders ────────────────────────────────────────────────

  describe('GET /avatar/renders', () => {
    it('should return paginated list of renders', async () => {
      const chain = chainMock({
        data: [{ id: 'r-1', result_image_url: 'https://example.com/render.png' }],
        error: null,
        count: 1,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/renders?page=1&limit=10', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.pagination.page).toBe(1);
      expect(json.pagination.total).toBe(1);
    });

    it('should return empty array when no renders exist', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/renders', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(0);
      expect(json.pagination.has_more).toBe(false);
    });

    it('should return 500 on database error', async () => {
      const chain = chainMock({ data: null, error: { message: 'DB error' }, count: 0 });
      // Need to make the chain resolve without .single()
      const customChain: any = {};
      const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in', 'single', 'maybeSingle', 'order', 'limit', 'range'];
      for (const method of methods) {
        customChain[method] = vi.fn(() => customChain);
      }
      customChain.then = (resolve: any) => resolve({ data: null, error: { message: 'DB error' }, count: 0 });
      mockSupabase.from.mockReturnValue(customChain);

      const res = await req('GET', '/renders', undefined, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/renders');
      expect(res.status).toBe(401);
    });
  });

  // ── DELETE /avatar/renders/:id ─────────────────────────────────────────

  describe('DELETE /avatar/renders/:id', () => {
    it('should delete render owned by user', async () => {
      const fetchChain = chainMock({ data: { id: 'r-1', user_id: 'user-1', result_image_url: 'https://example.com/render.png' }, error: null });
      const deleteChain = chainMock({ data: null, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? fetchChain : deleteChain;
      });

      const res = await req('DELETE', '/renders/r-1', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('deleted');
    });

    it('should return 404 when render not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('DELETE', '/renders/nonexistent', undefined, AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('DELETE', '/renders/r-1');
      expect(res.status).toBe(401);
    });
  });
});
