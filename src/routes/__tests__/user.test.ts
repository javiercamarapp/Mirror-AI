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
      upload: vi.fn().mockResolvedValue({ data: { path: 'test/path.jpg' }, error: null }),
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.example.com/image.png' } }),
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

const mockUploadImage = vi.fn().mockResolvedValue('https://storage.example.com/image.png');
vi.mock('../../services/storage.js', () => ({
  uploadImage: (...args: any[]) => mockUploadImage(...args),
  deleteImage: vi.fn().mockResolvedValue(undefined),
  extractPathFromUrl: vi.fn().mockReturnValue('user-1/image.png'),
  getPublicUrl: vi.fn().mockReturnValue('https://storage.example.com/public.png'),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

// Mock sharp to prevent "unsupported image format" errors from transitive imports
const sharpChain: any = new Proxy({}, {
  get: (_target, prop) => {
    if (prop === 'toBuffer') return vi.fn().mockResolvedValue(Buffer.from('processed'));
    if (prop === 'toFile') return vi.fn().mockResolvedValue({ width: 100, height: 100 });
    if (prop === 'then') return undefined;
    return vi.fn(() => sharpChain);
  },
});
vi.mock('sharp', () => ({
  default: vi.fn(() => sharpChain),
  __esModule: true,
}));

// Helper to build chainable query mock
function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in', 'single', 'maybeSingle', 'order', 'limit', 'range', 'ilike', 'contains', 'not', 'gt', 'gte', 'lte', 'head'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

// ─── Import route after mocks ──────────────────────────────────────────────
const { userRoutes } = await import('../../routes/user.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/user', userRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/user${path}`, init);
}

const AUTH_HEADER = { 'X-Test-User-Id': 'user-1' };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('User Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── GET /user/profile ─────────────────────────────────────────────────

  describe('GET /user/profile', () => {
    it('should return user profile', async () => {
      const chain = chainMock({ data: { id: 'user-1', full_name: 'Alice', email: 'alice@test.com' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/profile', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.full_name).toBe('Alice');
    });

    it('should return 404 when profile not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/profile', undefined, AUTH_HEADER);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('Profile not found');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/profile');
      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /user/profile ───────────────────────────────────────────────

  describe('PATCH /user/profile', () => {
    it('should update profile with valid fields', async () => {
      const chain = chainMock({ data: { id: 'user-1', full_name: 'Alice Updated', gender: 'female' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/profile', { full_name: 'Alice Updated', gender: 'female' }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should return 400 when no valid fields are provided', async () => {
      const res = await req('PATCH', '/profile', { invalid_field: 'value', another_bad: 123 }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('No valid fields');
    });

    it('should ignore disallowed fields and update allowed ones', async () => {
      const chain = chainMock({ data: { id: 'user-1', full_name: 'New Name' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/profile', { full_name: 'New Name', email: 'hack@evil.com', id: 'new-id' }, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should allow updating all permitted fields', async () => {
      const chain = chainMock({ data: { id: 'user-1' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/profile', {
        full_name: 'Alice',
        avatar_url: 'https://example.com/avatar.png',
        gender: 'female',
        age_range: '25-34',
        body_shape: 'hourglass',
        height: 165,
        weight: 60,
        skin_tone: 'medium',
        style_preferences: ['casual', 'boho'],
        onboarding_completed: true,
      }, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 500 when database update fails', async () => {
      const chain = chainMock({ data: null, error: { message: 'DB error' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/profile', { full_name: 'Test' }, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('PATCH', '/profile', { full_name: 'Test' });
      expect(res.status).toBe(401);
    });
  });

  // ── POST /user/onboarding ────────────────────────────────────────────

  describe('POST /user/onboarding', () => {
    it('should complete onboarding with all fields', async () => {
      const chain = chainMock({ data: { id: 'user-1', onboarding_completed: true }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/onboarding', {
        name: 'Alice',
        gender: 'female',
        age_range: '25-34',
        body_shape: 'hourglass',
        height: 165,
        weight: 60,
        skin_tone: 'medium',
        style_preferences: ['casual'],
        color_season: 'autumn',
      }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should complete onboarding with minimal fields', async () => {
      const chain = chainMock({ data: { id: 'user-1', onboarding_completed: true }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/onboarding', {}, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 500 when database update fails', async () => {
      const chain = chainMock({ data: null, error: { message: 'DB error' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/onboarding', { name: 'Alice' }, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/onboarding', { name: 'Alice' });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /user/subscription ────────────────────────────────────────────

  describe('GET /user/subscription', () => {
    it('should return subscription details and plan limits', async () => {
      const chain = chainMock({ data: { subscription_plan: 'basic', vton_credits: 10 }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/subscription', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.plan).toBe('basic');
      expect(json.data.limits.wardrobe_limit).toBe(200);
      expect(json.data.vton_credits_remaining).toBe(10);
    });

    it('should return free plan limits as default', async () => {
      const chain = chainMock({ data: { subscription_plan: 'free', vton_credits: 2 }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/subscription', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.limits.wardrobe_limit).toBe(50);
      expect(json.data.limits.vton_credits_monthly).toBe(3);
    });

    it('should return premium plan limits', async () => {
      const chain = chainMock({ data: { subscription_plan: 'premium', vton_credits: 45 }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/subscription', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.limits.wardrobe_limit).toBe(-1);
      expect(json.data.limits.ai_chats_daily).toBe(-1);
    });

    it('should return 404 when profile not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/subscription', undefined, AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/subscription');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /user/avatar ────────────────────────────────────────────────

  describe('POST /user/avatar', () => {
    it('should upload body photo', async () => {
      const chain = chainMock({ data: { id: 'user-1', body_photo_url: 'https://storage.example.com/image.png' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/avatar', { body_photo: 'dGVzdA==' }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockUploadImage).toHaveBeenCalledTimes(1);
    });

    it('should upload selfie', async () => {
      const chain = chainMock({ data: { id: 'user-1', avatar_url: 'https://storage.example.com/image.png' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/avatar', { selfie: 'dGVzdA==' }, AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(mockUploadImage).toHaveBeenCalledTimes(1);
    });

    it('should upload both body photo and selfie', async () => {
      const chain = chainMock({ data: { id: 'user-1' }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/avatar', { body_photo: 'dGVzdA==', selfie: 'dGVzdA==' }, AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(mockUploadImage).toHaveBeenCalledTimes(2);
    });

    it('should return 400 when neither body_photo nor selfie provided', async () => {
      const res = await req('POST', '/avatar', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('At least one');
    });

    it('should return 400 when body_photo exceeds 10MB', async () => {
      const hugeBase64 = 'a'.repeat(10 * 1024 * 1024 * 4 / 3 + 100);
      const res = await req('POST', '/avatar', { body_photo: hugeBase64 }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('10MB');
    });

    it('should return 400 when selfie exceeds 10MB', async () => {
      const hugeBase64 = 'a'.repeat(10 * 1024 * 1024 * 4 / 3 + 100);
      const res = await req('POST', '/avatar', { selfie: hugeBase64 }, AUTH_HEADER);
      expect(res.status).toBe(400);
    });

    it('should return 500 when database update fails', async () => {
      const chain = chainMock({ data: null, error: { message: 'DB error' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/avatar', { body_photo: 'dGVzdA==' }, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/avatar', { body_photo: 'dGVzdA==' });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /user/stats ──────────────────────────────────────────────────

  describe('GET /user/stats', () => {
    it('should return user stats', async () => {
      const wardrobeChain = chainMock({ data: null, error: null, count: 15 });
      const outfitsChain = chainMock({ data: null, error: null, count: 5 });
      const streakChain = chainMock({ data: [], error: null });
      const postsChain = chainMock({ data: null, error: null, count: 3 });
      const scoredChain = chainMock({ data: [], error: null });

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return wardrobeChain;
        if (callCount === 2) return outfitsChain;
        if (callCount === 3) return streakChain;
        if (callCount === 4) return postsChain;
        return scoredChain;
      });

      const res = await req('GET', '/stats', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.wardrobe_count).toBeDefined();
      expect(json.data.outfits_count).toBeDefined();
      expect(json.data.posts_count).toBeDefined();
      expect(json.data.streak).toBeDefined();
      expect(json.data.average_score).toBeDefined();
    });

    it('should return zero stats for empty user', async () => {
      const emptyChain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(emptyChain);

      const res = await req('GET', '/stats', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.wardrobe_count).toBe(0);
      expect(json.data.streak).toBe(0);
      expect(json.data.average_score).toBe(0);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/stats');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /user/notifications ──────────────────────────────────────────

  describe('GET /user/notifications', () => {
    it('should return paginated notifications', async () => {
      const chain = chainMock({
        data: [{ id: 'n-1', type: 'like', read: false }],
        error: null,
        count: 1,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/notifications?page=1&limit=10', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.pagination.total).toBe(1);
    });

    it('should return empty array when no notifications', async () => {
      const chain = chainMock({ data: [], error: null, count: 0 });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/notifications', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(0);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/notifications');
      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /user/notifications/:id ────────────────────────────────────

  describe('PATCH /user/notifications/:id', () => {
    it('should mark notification as read', async () => {
      const chain = chainMock({ data: { id: 'n-1', read: true }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/notifications/n-1', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.read).toBe(true);
    });

    it('should return 404 when notification not found', async () => {
      const chain = chainMock({ data: null, error: { message: 'Not found' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('PATCH', '/notifications/nonexistent', undefined, AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('PATCH', '/notifications/n-1');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /user/notifications/read-all ────────────────────────────────

  describe('POST /user/notifications/read-all', () => {
    it('should mark all notifications as read', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/notifications/read-all', {}, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.message).toContain('All notifications');
    });

    it('should return 500 when database update fails', async () => {
      const chain = chainMock({ data: null, error: { message: 'DB error' } });
      // Need a thenable chain that does not end with .single()
      const customChain: any = {};
      const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in', 'single', 'maybeSingle', 'order', 'limit', 'range'];
      for (const method of methods) {
        customChain[method] = vi.fn(() => customChain);
      }
      customChain.then = (resolve: any) => resolve({ data: null, error: { message: 'DB error' } });
      mockSupabase.from.mockReturnValue(customChain);

      const res = await req('POST', '/notifications/read-all', {}, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/notifications/read-all', {});
      expect(res.status).toBe(401);
    });
  });

  // ── GET /user/notification-preferences ───────────────────────────────

  describe('GET /user/notification-preferences', () => {
    it('should return stored notification preferences', async () => {
      const chain = chainMock({
        data: { notification_preferences: { likes: false, comments: true, friend_requests: true, new_posts: false } },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/notification-preferences', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.likes).toBe(false);
      expect(json.data.comments).toBe(true);
    });

    it('should return defaults when no preferences are stored', async () => {
      const chain = chainMock({ data: { notification_preferences: null }, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/notification-preferences', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.likes).toBe(true);
      expect(json.data.comments).toBe(true);
      expect(json.data.friend_requests).toBe(true);
      expect(json.data.new_posts).toBe(true);
    });

    it('should return 404 when profile not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/notification-preferences', undefined, AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/notification-preferences');
      expect(res.status).toBe(401);
    });
  });

  // ── PUT /user/notification-preferences ───────────────────────────────

  describe('PUT /user/notification-preferences', () => {
    it('should update notification preferences', async () => {
      const existingChain = chainMock({
        data: { notification_preferences: { likes: true, comments: true, friend_requests: true, new_posts: true } },
        error: null,
      });
      const updateChain = chainMock({
        data: { notification_preferences: { likes: false, comments: true, friend_requests: true, new_posts: true } },
        error: null,
      });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : updateChain;
      });

      const res = await req('PUT', '/notification-preferences', { likes: false }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should return 400 when no preferences are provided', async () => {
      const res = await req('PUT', '/notification-preferences', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('At least one preference');
    });

    it('should return 400 when preference value is not boolean', async () => {
      const res = await req('PUT', '/notification-preferences', { likes: 'yes' }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('boolean');
    });

    it('should ignore unknown preference keys', async () => {
      const res = await req('PUT', '/notification-preferences', { unknown_key: true }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('At least one preference');
    });

    it('should return 500 when database update fails', async () => {
      const existingChain = chainMock({ data: { notification_preferences: null }, error: null });
      const updateChain = chainMock({ data: null, error: { message: 'DB error' } });
      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : updateChain;
      });

      const res = await req('PUT', '/notification-preferences', { likes: false }, AUTH_HEADER);
      expect(res.status).toBe(500);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('PUT', '/notification-preferences', { likes: false });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /user/export-data ────────────────────────────────────────────

  describe('GET /user/export-data', () => {
    it('should export all user data (GDPR)', async () => {
      const profileChain = chainMock({ data: { id: 'user-1', full_name: 'Alice' }, error: null });
      const wardrobeChain = chainMock({ data: [{ id: 'w-1' }], error: null });
      const outfitsChain = chainMock({ data: [{ id: 'o-1' }], error: null });
      const postsChain = chainMock({ data: [], error: null });
      const storiesChain = chainMock({ data: [], error: null });
      const friendsChain = chainMock({ data: [], error: null });
      const notificationsChain = chainMock({ data: [{ id: 'n-1' }], error: null });

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return profileChain;
        if (callCount === 2) return wardrobeChain;
        if (callCount === 3) return outfitsChain;
        if (callCount === 4) return postsChain;
        if (callCount === 5) return storiesChain;
        if (callCount === 6) return friendsChain;
        return notificationsChain;
      });

      const res = await req('GET', '/export-data', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.exported_at).toBeDefined();
      expect(json.data.profile).toBeDefined();
      expect(json.data.wardrobe_items).toHaveLength(1);
      expect(json.data.daily_outfits).toHaveLength(1);
      expect(json.data.notifications).toHaveLength(1);
    });

    it('should return empty arrays for users with no data', async () => {
      const emptyChain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(emptyChain);

      const res = await req('GET', '/export-data', undefined, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.wardrobe_items).toHaveLength(0);
      expect(json.data.social_posts).toHaveLength(0);
    });

    it('should include ISO timestamp in exported_at', async () => {
      const chain = chainMock({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/export-data', undefined, AUTH_HEADER);
      const json = await res.json();
      expect(() => new Date(json.data.exported_at)).not.toThrow();
      expect(new Date(json.data.exported_at).toISOString()).toBe(json.data.exported_at);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('GET', '/export-data');
      expect(res.status).toBe(401);
    });
  });
});
