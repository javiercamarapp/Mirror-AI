import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Supabase ─────────────────────────────────────────────────────────
const mockSupabase = {
  auth: { getUser: vi.fn() },
  from: vi.fn(),
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

vi.mock('../../services/storage.js', () => ({
  uploadImage: vi.fn().mockResolvedValue('https://storage.test/wardrobe/img.jpg'),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  extractPathFromUrl: vi.fn().mockReturnValue('user-1/item_original.jpg'),
}));

vi.mock('../../services/rembg.js', () => ({
  removeBackground: vi.fn().mockResolvedValue(Buffer.from('nobg')),
}));

vi.mock('../../services/gemini.js', () => ({
  analyzeImageJSON: vi.fn().mockResolvedValue({
    name: 'Blue T-Shirt',
    category: 'tops',
    subcategory: 't-shirt',
    color: 'blue',
    brand: null,
    season: ['summer', 'spring'],
    occasions: ['casual'],
  }),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'wardrobe-uuid'),
}));

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

const { wardrobeRoutes } = await import('../../routes/wardrobe.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/wardrobe', wardrobeRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/wardrobe${path}`, init);
}

const AUTH = { 'X-Test-User-Id': 'user-w-1' };

describe('Wardrobe Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── List Items ────────────────────────────────────────────────────────

  describe('GET /wardrobe', () => {
    it('should return paginated wardrobe items', async () => {
      const chain = chainMock({
        data: [
          { id: 'item-1', name: 'Blue Shirt', category: 'tops', color: 'blue' },
          { id: 'item-2', name: 'Black Jeans', category: 'bottoms', color: 'black' },
        ],
        error: null,
        count: 2,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.pagination.total).toBe(2);
    });

    it('should filter by category', async () => {
      const chain = chainMock({ data: [{ id: 'i1', category: 'tops' }], error: null, count: 1 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/?category=tops', undefined, AUTH);
      expect(res.status).toBe(200);
      // Verify eq was called with category filter
      expect(chain.eq).toHaveBeenCalled();
    });

    it('should filter by color', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/?color=blue', undefined, AUTH);
      expect(res.status).toBe(200);
      expect(chain.ilike).toHaveBeenCalled();
    });

    it('should filter by season', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/?season=summer', undefined, AUTH);
      expect(res.status).toBe(200);
      expect(chain.contains).toHaveBeenCalled();
    });

    it('should filter by favorites', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/?favorite=true', undefined, AUTH);
      expect(res.status).toBe(200);
    });

    it('should reject color filter longer than 50 characters', async () => {
      const res = await req('GET', `/?color=${'a'.repeat(51)}`, undefined, AUTH);
      expect(res.status).toBe(400);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/');
      expect(res.status).toBe(401);
    });
  });

  // ── Add Item ──────────────────────────────────────────────────────────

  describe('POST /wardrobe', () => {
    it('should add a wardrobe item with AI analysis', async () => {
      // profile for plan check
      const profileChain = chainMock({ data: { subscription_plan: 'free' }, error: null });
      // count check
      const countChain = chainMock({ data: null, error: null, count: 5 });
      // insert
      const insertChain = chainMock({
        data: { id: 'wardrobe-uuid', name: 'Blue T-Shirt', category: 'tops' },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return profileChain;
        if (callIdx === 2) return countChain;
        return insertChain;
      });

      const res = await req('POST', '/', {
        image: Buffer.from('fake-image').toString('base64'),
      }, AUTH);
      expect(res.status).toBe(201);
    });

    it('should return 400 when image is missing', async () => {
      const res = await req('POST', '/', {}, AUTH);
      expect(res.status).toBe(400);
    });

    it('should enforce wardrobe limit for free plan (50 items)', async () => {
      const profileChain = chainMock({ data: { subscription_plan: 'free' }, error: null });
      const countChain = chainMock({ data: null, error: null, count: 50 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? profileChain : countChain;
      });

      const res = await req('POST', '/', {
        image: Buffer.from('img').toString('base64'),
      }, AUTH);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('limit reached');
    });

    it('should enforce wardrobe limit for basic plan (200 items)', async () => {
      const profileChain = chainMock({ data: { subscription_plan: 'basic' }, error: null });
      const countChain = chainMock({ data: null, error: null, count: 200 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? profileChain : countChain;
      });

      const res = await req('POST', '/', {
        image: Buffer.from('img').toString('base64'),
      }, AUTH);
      expect(res.status).toBe(403);
    });

    it('should allow unlimited items for premium plan', async () => {
      const profileChain = chainMock({ data: { subscription_plan: 'premium' }, error: null });
      const insertChain = chainMock({
        data: { id: 'wardrobe-uuid', name: 'Premium Item' },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? profileChain : insertChain;
      });

      const res = await req('POST', '/', {
        image: Buffer.from('img').toString('base64'),
      }, AUTH);
      expect(res.status).toBe(201);
    });

    it('should reject oversized images (> 10MB base64)', async () => {
      const profileChain = chainMock({ data: { subscription_plan: 'free' }, error: null });
      const countChain = chainMock({ data: null, error: null, count: 0 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? profileChain : countChain;
      });

      // Create a string larger than 10MB base64 threshold
      const oversizedImage = 'A'.repeat(15 * 1024 * 1024);
      const res = await req('POST', '/', { image: oversizedImage }, AUTH);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('10MB');
    });
  });

  // ── Get Single Item ───────────────────────────────────────────────────

  describe('GET /wardrobe/:id', () => {
    it('should return a single item', async () => {
      const chain = chainMock({
        data: { id: 'item-1', name: 'Jacket', user_id: 'user-w-1' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/item-1', undefined, AUTH);
      expect(res.status).toBe(200);
    });

    it('should return 404 when item not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/nonexistent', undefined, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Update Item ───────────────────────────────────────────────────────

  describe('PATCH /wardrobe/:id', () => {
    it('should update allowed fields', async () => {
      const chain = chainMock({
        data: { id: 'item-1', name: 'Updated Shirt', color: 'red' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/item-1', { name: 'Updated Shirt', color: 'red' }, AUTH);
      expect(res.status).toBe(200);
    });

    it('should return 400 when no valid fields provided', async () => {
      const res = await req('PATCH', '/item-1', { invalid_field: 'x' }, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Delete Item ───────────────────────────────────────────────────────

  describe('DELETE /wardrobe/:id', () => {
    it('should delete item and clean up storage', async () => {
      const fetchChain = chainMock({
        data: { id: 'item-1', user_id: 'user-w-1', image_url: 'https://x.com/img.jpg', image_no_bg_url: 'https://x.com/nobg.png' },
        error: null,
      });
      const deleteChain = chainMock({ data: null, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? fetchChain : deleteChain;
      });

      const res = await req('DELETE', '/item-1', undefined, AUTH);
      expect(res.status).toBe(200);
    });

    it('should return 404 when item not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('DELETE', '/nonexistent', undefined, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Favorite Toggle ───────────────────────────────────────────────────

  describe('POST /wardrobe/:id/favorite', () => {
    it('should toggle favorite on', async () => {
      const fetchChain = chainMock({ data: { is_favorite: false }, error: null });
      const updateChain = chainMock({ data: { id: 'item-1', is_favorite: true }, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? fetchChain : updateChain;
      });

      const res = await req('POST', '/item-1/favorite', {}, AUTH);
      expect(res.status).toBe(200);
    });

    it('should toggle favorite off', async () => {
      const fetchChain = chainMock({ data: { is_favorite: true }, error: null });
      const updateChain = chainMock({ data: { id: 'item-1', is_favorite: false }, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? fetchChain : updateChain;
      });

      const res = await req('POST', '/item-1/favorite', {}, AUTH);
      expect(res.status).toBe(200);
    });

    it('should return 404 when item not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/nonexistent/favorite', {}, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Wear Logging ──────────────────────────────────────────────────────

  describe('POST /wardrobe/:id/wear', () => {
    it('should increment wear count', async () => {
      const fetchChain = chainMock({ data: { wear_count: 3 }, error: null });
      const updateChain = chainMock({ data: { id: 'item-1', wear_count: 4 }, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? fetchChain : updateChain;
      });

      const res = await req('POST', '/item-1/wear', {}, AUTH);
      expect(res.status).toBe(200);
    });

    it('should return 404 when item not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/nonexistent/wear', {}, AUTH);
      expect(res.status).toBe(404);
    });
  });
});
