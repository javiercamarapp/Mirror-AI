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

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

const mockGenerateJSON = vi.fn();
const mockAnalyzeImageJSON = vi.fn();
vi.mock('../../services/gemini.js', () => ({
  generateJSON: (...args: any[]) => mockGenerateJSON(...args),
  analyzeImageJSON: (...args: any[]) => mockAnalyzeImageJSON(...args),
}));

const mockUploadImage = vi.fn().mockResolvedValue('https://storage.example.com/image.png');
vi.mock('../../services/storage.js', () => ({
  uploadImage: (...args: any[]) => mockUploadImage(...args),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

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
const { outfitRoutes } = await import('../../routes/outfits.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/outfits', outfitRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/outfits${path}`, init);
}

const AUTH_HEADER = { 'X-Test-User-Id': 'user-1' };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Outfit Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── POST /outfits/generate ────────────────────────────────────────────

  describe('POST /outfits/generate', () => {
    it('should generate outfit suggestions from wardrobe', async () => {
      const profileChain = chainMock({ data: { gender: 'female', body_shape: 'hourglass', style_preferences: ['casual'], skin_tone: 'medium' }, error: null });
      const itemsChain = chainMock({
        data: [
          { id: 'item-1', name: 'White Tee', category: 'tops', subcategory: 'tshirt', color: 'white', season: ['summer'], occasions: ['casual'] },
          { id: 'item-2', name: 'Blue Jeans', category: 'bottoms', subcategory: 'jeans', color: 'blue', season: ['all'], occasions: ['casual'] },
        ],
        error: null,
      });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileChain : itemsChain;
      });

      mockGenerateJSON.mockResolvedValue([
        { name: 'Casual Day', item_ids: ['item-1', 'item-2'], styling_tips: 'Simple and clean', score: 8, reasoning: 'Classic combo' },
      ]);

      const res = await req('POST', '/generate', { occasion: 'casual' }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].name).toBe('Casual Day');
    });

    it('should return 400 when occasion is missing', async () => {
      const res = await req('POST', '/generate', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('occasion');
    });

    it('should return 400 for invalid occasion', async () => {
      const res = await req('POST', '/generate', { occasion: 'invalid' }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid occasion');
    });

    it('should return 400 when no wardrobe items match', async () => {
      const profileChain = chainMock({ data: { gender: 'male' }, error: null });
      const itemsChain = chainMock({ data: [], error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileChain : itemsChain;
      });

      const res = await req('POST', '/generate', { occasion: 'formal' }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('No wardrobe items');
    });

    it('should return 500 when items query fails', async () => {
      const profileChain = chainMock({ data: null, error: null });
      const itemsChain = chainMock({ data: null, error: { message: 'DB error' } });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileChain : itemsChain;
      });

      const res = await req('POST', '/generate', { occasion: 'casual' }, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/generate', { occasion: 'casual' });
      expect(res.status).toBe(401);
    });

    it('should return 500 when AI generation fails', async () => {
      const profileChain = chainMock({ data: { gender: 'female' }, error: null });
      const itemsChain = chainMock({
        data: [{ id: 'item-1', name: 'Top', category: 'tops', occasions: ['casual'] }],
        error: null,
      });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? profileChain : itemsChain;
      });
      mockGenerateJSON.mockRejectedValue(new Error('AI service down'));

      const res = await req('POST', '/generate', { occasion: 'casual' }, AUTH_HEADER);
      expect(res.status).toBe(500);
    });
  });

  // ── POST /outfits/daily ───────────────────────────────────────────────

  describe('POST /outfits/daily', () => {
    it('should save a new daily outfit', async () => {
      const existingChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({ data: { id: 'test-uuid-1234', user_id: 'user-1', date: '2026-03-19' }, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : insertChain;
      });

      const res = await req('POST', '/daily', { outfit_data: { name: 'Today outfit' } }, AUTH_HEADER);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should update existing daily outfit (upsert)', async () => {
      const existingChain = chainMock({ data: { id: 'existing-daily' }, error: null });
      const updateChain = chainMock({ data: { id: 'existing-daily', outfit_data: { name: 'Updated' } }, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : updateChain;
      });

      const res = await req('POST', '/daily', { outfit_data: { name: 'Updated' } }, AUTH_HEADER);
      expect(res.status).toBe(201);
    });

    it('should return 400 when outfit_data is missing', async () => {
      const res = await req('POST', '/daily', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('outfit_data');
    });

    it('should increment wear count for provided item_ids', async () => {
      const existingChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({ data: { id: 'test-uuid-1234' }, error: null });
      const itemChain = chainMock({ data: { wear_count: 3 }, error: null });
      const updateItemChain = chainMock({ data: null, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return existingChain;
        if (callCount === 2) return insertChain;
        if (callCount === 3) return itemChain;
        return updateItemChain;
      });

      const res = await req('POST', '/daily', {
        outfit_data: { name: 'Outfit' },
        item_ids: ['item-1'],
      }, AUTH_HEADER);
      expect(res.status).toBe(201);
    });

    it('should return 500 when database insert fails', async () => {
      const existingChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({ data: null, error: { message: 'DB error' } });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : insertChain;
      });

      const res = await req('POST', '/daily', { outfit_data: { name: 'Test' } }, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/daily', { outfit_data: { name: 'Test' } });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /outfits/daily ────────────────────────────────────────────────

  describe('GET /outfits/daily', () => {
    it('should return today\'s outfit', async () => {
      const chain = chainMock({ data: { id: 'd-1', date: '2026-03-19', outfit_data: {} }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/daily', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('d-1');
    });

    it('should return outfit for a specific date', async () => {
      const chain = chainMock({ data: { id: 'd-2', date: '2026-03-15' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/daily?date=2026-03-15', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 404 when no outfit found for date', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/daily', undefined, AUTH_HEADER);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('No outfit found');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/daily');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /outfits/history ──────────────────────────────────────────────

  describe('GET /outfits/history', () => {
    it('should return paginated outfit history', async () => {
      const chain = chainMock({
        data: [{ id: 'h-1', date: '2026-03-19' }, { id: 'h-2', date: '2026-03-18' }],
        error: null,
        count: 2,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/history?page=1&limit=10', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.pagination.page).toBe(1);
      expect(json.pagination.total).toBe(2);
    });

    it('should filter by month when provided', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/history?month=2026-03', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // Verify gte/lte were called on the chain
      expect(chain.gte).toHaveBeenCalled();
      expect(chain.lte).toHaveBeenCalled();
    });

    it('should return empty data when no history exists', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/history', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(0);
      expect(json.pagination.has_more).toBe(false);
    });

    it('should return 500 on database error', async () => {
      const chain: any = {};
      const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in', 'single', 'maybeSingle', 'order', 'limit', 'range', 'gte', 'lte'];
      for (const method of methods) {
        chain[method] = vi.fn(() => chain);
      }
      chain.then = (resolve: any) => resolve({ data: null, error: { message: 'DB error' }, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/history', undefined, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/history');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /outfits/streak ───────────────────────────────────────────────

  describe('GET /outfits/streak', () => {
    it('should return streak information', async () => {
      const today = new Date().toISOString().split('T')[0];
      const chain = chainMock({
        data: [{ date: today }],
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/streak', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.current_streak).toBeDefined();
      expect(json.data.longest_streak).toBeDefined();
      expect(json.data.total_outfits).toBe(1);
      expect(json.data.has_today).toBe(true);
    });

    it('should return zero streak when no outfits exist', async () => {
      const chain = chainMock({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/streak', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.current_streak).toBe(0);
      expect(json.data.longest_streak).toBe(0);
      expect(json.data.total_outfits).toBe(0);
      expect(json.data.has_today).toBe(false);
    });

    it('should return 500 on database error', async () => {
      const chain = chainMock({ data: null, error: { message: 'DB error' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/streak', undefined, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/streak');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /outfits/save ────────────────────────────────────────────────

  describe('POST /outfits/save', () => {
    it('should save an outfit combination', async () => {
      const itemsChain = chainMock({
        data: [
          { id: 'item-1', name: 'Shirt', category: 'tops', color: 'blue', image_url: 'url1', image_no_bg_url: null },
          { id: 'item-2', name: 'Pants', category: 'bottoms', color: 'black', image_url: 'url2', image_no_bg_url: null },
        ],
        error: null,
      });
      const insertChain = chainMock({ data: { id: 'test-uuid-1234', name: 'My Outfit', item_ids: ['item-1', 'item-2'] }, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? itemsChain : insertChain;
      });

      const res = await req('POST', '/save', { item_ids: ['item-1', 'item-2'], name: 'My Outfit' }, AUTH_HEADER);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should return 400 when item_ids is empty', async () => {
      const res = await req('POST', '/save', { item_ids: [] }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('item_ids');
    });

    it('should return 400 when item_ids is missing', async () => {
      const res = await req('POST', '/save', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
    });

    it('should return 400 when some item_ids are invalid', async () => {
      const itemsChain = chainMock({
        data: [{ id: 'item-1', name: 'Shirt', category: 'tops' }],
        error: null,
      });
      mockSupabase.from.mockReturnValue(itemsChain);

      const res = await req('POST', '/save', { item_ids: ['item-1', 'nonexistent'] }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('invalid');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/save', { item_ids: ['item-1'] });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /outfits/saved ────────────────────────────────────────────────

  describe('GET /outfits/saved', () => {
    it('should return paginated saved outfits', async () => {
      const chain = chainMock({
        data: [{ id: 'o-1', name: 'Outfit 1' }],
        error: null,
        count: 1,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/saved?page=1&limit=10', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.pagination.total).toBe(1);
    });

    it('should return empty array when no saved outfits', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/saved', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(0);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/saved');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /outfits/:id ──────────────────────────────────────────────────

  describe('GET /outfits/:id', () => {
    it('should return a single saved outfit', async () => {
      const chain = chainMock({ data: { id: 'o-1', user_id: 'user-1', name: 'My Outfit' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/o-1', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('o-1');
    });

    it('should return 404 when outfit not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/nonexistent', undefined, AUTH_HEADER);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('Outfit not found');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/o-1');
      expect(res.status).toBe(401);
    });
  });

  // ── DELETE /outfits/:id ───────────────────────────────────────────────

  describe('DELETE /outfits/:id', () => {
    it('should delete an outfit owned by user', async () => {
      const existingChain = chainMock({ data: { id: 'o-1' }, error: null });
      const deleteChain = chainMock({ data: null, error: null });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : deleteChain;
      });

      const res = await req('DELETE', '/o-1', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('deleted');
    });

    it('should return 404 when outfit not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('DELETE', '/nonexistent', undefined, AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it('should return 500 when delete fails', async () => {
      const existingChain = chainMock({ data: { id: 'o-1' }, error: null });
      const deleteChain = chainMock({ data: null, error: { message: 'Delete failed' } });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : deleteChain;
      });

      const res = await req('DELETE', '/o-1', undefined, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('DELETE', '/o-1');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /outfits/rate ────────────────────────────────────────────────

  describe('POST /outfits/rate', () => {
    it('should rate an outfit photo with AI analysis', async () => {
      const profileChain = chainMock({ data: { gender: 'female', body_shape: 'hourglass', skin_tone: 'medium', style_preferences: ['casual'] }, error: null });
      mockSupabase.from.mockReturnValue(profileChain);

      mockAnalyzeImageJSON.mockResolvedValue({
        score: 8,
        overall_feedback: 'Great outfit!',
        strengths: ['Color coordination', 'Fit'],
        improvements: ['Could add accessories'],
        color_harmony: 9,
        fit_assessment: 'Good fit overall',
        style_coherence: 8,
        occasion_appropriateness: 7,
      });

      const res = await req('POST', '/rate', { image: 'dGVzdA==', occasion: 'casual' }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.score).toBe(8);
      expect(json.data.strengths).toHaveLength(2);
    });

    it('should return 400 when image is missing', async () => {
      const res = await req('POST', '/rate', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('image');
    });

    it('should return 500 when AI analysis fails', async () => {
      const profileChain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(profileChain);
      mockAnalyzeImageJSON.mockRejectedValue(new Error('AI error'));

      const res = await req('POST', '/rate', { image: 'dGVzdA==' }, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/rate', { image: 'dGVzdA==' });
      expect(res.status).toBe(401);
    });
  });
});
