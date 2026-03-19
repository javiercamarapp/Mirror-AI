import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Supabase ──────────────────────────────────────────────────────────
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  storage: {
    from: vi.fn(() => ({
      upload: vi.fn().mockResolvedValue({ error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn(() => ({
        data: { publicUrl: 'https://test.supabase.co/storage/v1/object/public/wardrobe/test.jpg' },
      })),
    })),
  },
};

function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in',
    'single', 'maybeSingle', 'order', 'limit', 'range', 'ilike', 'contains',
    'not', 'gt', 'is', 'head',
  ];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

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

vi.mock('../../services/storage.js', () => ({
  uploadImage: vi.fn().mockResolvedValue('https://test.supabase.co/storage/v1/object/public/wardrobe/test.jpg'),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  extractPathFromUrl: vi.fn().mockReturnValue('user-1/item.jpg'),
}));

vi.mock('../../services/rembg.js', () => ({
  removeBackground: vi.fn().mockResolvedValue(Buffer.from('nobg-image')),
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

const mockSharp = vi.fn(() => ({
  withMetadata: vi.fn().mockReturnThis(),
  jpeg: vi.fn().mockReturnThis(),
  png: vi.fn().mockReturnThis(),
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('processed-image')),
}));
vi.mock('sharp', () => ({
  default: mockSharp,
  __esModule: true,
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

// ─── Import route after mocks ───────────────────────────────────────────────
const { wardrobeRoutes } = await import('../../routes/wardrobe.js');

// Also import friends route for closet tests
const { friendsRoutes } = await import('../../routes/friends.js').catch(() => ({ friendsRoutes: null }));

const app = new Hono<{ Variables: AppVariables }>();
app.route('/wardrobe', wardrobeRoutes);
if (friendsRoutes) {
  app.route('/friends', friendsRoutes);
}

const AUTH = { 'X-Test-User-Id': 'user-1' };
const AUTH_PREMIUM = { 'X-Test-User-Id': 'premium-user' };

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost${path}`, init);
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Wardrobe Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Add Wardrobe Item ─────────────────────────────────────────────────────

  describe('Add Item → Appears in List', () => {
    it('should add a wardrobe item and return it', async () => {
      // Profile check for subscription
      const profileChain = chainMock({
        data: { subscription_plan: 'free' },
        error: null,
      });
      // Count check (below limit)
      const countChain = chainMock({ data: null, error: null, count: 10 });
      // Insert
      const itemData = {
        id: 'item-1', user_id: 'user-1', name: 'Blue T-Shirt',
        category: 'tops', color: 'blue', wear_count: 0, is_favorite: false,
        image_url: 'https://test.supabase.co/storage/v1/object/public/wardrobe/test.jpg',
      };
      const insertChain = chainMock({ data: itemData, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (table === 'user_profiles') return profileChain;
        if (table === 'wardrobe_items' && callIdx === 2) return countChain;
        if (table === 'wardrobe_items') return insertChain;
        return chainMock({ data: null, error: null });
      });

      const res = await req('POST', '/wardrobe', {
        image: Buffer.from('fake-image').toString('base64'),
      }, AUTH);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Blue T-Shirt');
    });

    it('should return 400 when image is missing', async () => {
      const res = await req('POST', '/wardrobe', {}, AUTH);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Validation failed');
    });
  });

  // ── Free User Wardrobe Limit ──────────────────────────────────────────────

  describe('Free User → Wardrobe Limit', () => {
    it('should return 403 when free user hits wardrobe limit (50)', async () => {
      // Profile: free plan
      const profileChain = chainMock({
        data: { subscription_plan: 'free' },
        error: null,
      });
      // Count: at limit
      const countChain = chainMock({ data: null, error: null, count: 50 });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (table === 'user_profiles') return profileChain;
        return countChain;
      });

      const res = await req('POST', '/wardrobe', {
        image: Buffer.from('fake-image').toString('base64'),
      }, AUTH);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('limit');
    });
  });

  // ── Premium User No Limit ────────────────────────────────────────────────

  describe('Premium User → No Limit', () => {
    it('should allow premium user to add items without limit', async () => {
      // Profile: premium plan
      const profileChain = chainMock({
        data: { subscription_plan: 'premium' },
        error: null,
      });
      // Insert (no count check for unlimited)
      const itemData = {
        id: 'item-2', user_id: 'premium-user', name: 'Silk Dress',
        category: 'dresses', color: 'red', wear_count: 0, is_favorite: false,
      };
      const insertChain = chainMock({ data: itemData, error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'user_profiles') return profileChain;
        return insertChain;
      });

      const res = await req('POST', '/wardrobe', {
        image: Buffer.from('fake-image').toString('base64'),
      }, AUTH_PREMIUM);

      expect(res.status).toBe(201);
    });
  });

  // ── Favorite Toggle ───────────────────────────────────────────────────────

  describe('Favorite Toggle', () => {
    it('should toggle favorite on a wardrobe item', async () => {
      // Fetch current state
      const fetchChain = chainMock({
        data: { is_favorite: false },
        error: null,
      });
      // Update
      const updateChain = chainMock({
        data: { id: 'item-1', is_favorite: true },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? fetchChain : updateChain;
      });

      const res = await req('POST', '/wardrobe/item-1/favorite', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.is_favorite).toBe(true);
    });

    it('should return 404 for non-existent item', async () => {
      const notFoundChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(notFoundChain);

      const res = await req('POST', '/wardrobe/missing/favorite', undefined, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Wear Count Increment ──────────────────────────────────────────────────

  describe('Wear Count Increment', () => {
    it('should increment wear count when logging a wear', async () => {
      const fetchChain = chainMock({
        data: { wear_count: 5 },
        error: null,
      });
      const updateChain = chainMock({
        data: { id: 'item-1', wear_count: 6, last_worn: new Date().toISOString() },
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? fetchChain : updateChain;
      });

      const res = await req('POST', '/wardrobe/item-1/wear', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.wear_count).toBe(6);
    });

    it('should return 404 when item not found for wear', async () => {
      const notFoundChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(notFoundChain);

      const res = await req('POST', '/wardrobe/missing/wear', undefined, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Delete Item ───────────────────────────────────────────────────────────

  describe('Delete Item', () => {
    it('should delete a wardrobe item and clean up storage', async () => {
      // Fetch item
      const fetchChain = chainMock({
        data: {
          id: 'item-1', user_id: 'user-1',
          image_url: 'https://test.supabase.co/storage/v1/object/public/wardrobe/user-1/item.jpg',
          image_no_bg_url: 'https://test.supabase.co/storage/v1/object/public/wardrobe/user-1/item_nobg.png',
        },
        error: null,
      });
      // Delete
      const deleteChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? fetchChain : deleteChain;
      });

      const { deleteImage } = await import('../../services/storage.js');

      const res = await req('DELETE', '/wardrobe/item-1', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.message).toContain('deleted');

      // Should clean up storage
      expect(deleteImage).toHaveBeenCalled();
    });

    it('should return 404 when deleting non-existent item', async () => {
      const notFoundChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(notFoundChain);

      const res = await req('DELETE', '/wardrobe/missing', undefined, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── List Items ────────────────────────────────────────────────────────────

  describe('List Wardrobe Items', () => {
    it('should list wardrobe items with pagination', async () => {
      const items = [
        { id: 'item-1', name: 'Blue Shirt', category: 'tops' },
        { id: 'item-2', name: 'Black Pants', category: 'bottoms' },
      ];
      const listChain = chainMock({ data: items, error: null, count: 2 });
      mockSupabase.from.mockReturnValue(listChain);

      const res = await req('GET', '/wardrobe', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(2);
      expect(json.pagination).toBeDefined();
      expect(json.pagination.total).toBe(2);
    });
  });

  // ── Get Single Item ───────────────────────────────────────────────────────

  describe('Get Single Item', () => {
    it('should return a single wardrobe item', async () => {
      const itemChain = chainMock({
        data: { id: 'item-1', name: 'Blue Shirt', category: 'tops', user_id: 'user-1' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(itemChain);

      const res = await req('GET', '/wardrobe/item-1', undefined, AUTH);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe('item-1');
    });

    it('should return 404 for item not found', async () => {
      const notFoundChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(notFoundChain);

      const res = await req('GET', '/wardrobe/missing', undefined, AUTH);
      expect(res.status).toBe(404);
    });
  });

  // ── Update Item ───────────────────────────────────────────────────────────

  describe('Update Item', () => {
    it('should update wardrobe item fields', async () => {
      const updateChain = chainMock({
        data: { id: 'item-1', name: 'Updated Shirt', color: 'red' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(updateChain);

      const res = await req('PATCH', '/wardrobe/item-1', { name: 'Updated Shirt', color: 'red' }, AUTH);
      expect(res.status).toBe(200);
    });

    it('should return 400 when no valid fields provided', async () => {
      const res = await req('PATCH', '/wardrobe/item-1', { invalid_field: 'value' }, AUTH);
      expect(res.status).toBe(400);
    });
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe('Authentication Required', () => {
    it('should return 401 for unauthenticated request', async () => {
      const res = await req('GET', '/wardrobe');
      expect(res.status).toBe(401);
    });
  });
});
