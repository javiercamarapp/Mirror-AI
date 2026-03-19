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

const mockUploadImage = vi.fn().mockResolvedValue('https://storage.example.com/image.png');
vi.mock('../../services/storage.js', () => ({
  uploadImage: (...args: any[]) => mockUploadImage(...args),
}));

const mockRemoveBackground = vi.fn().mockResolvedValue(Buffer.from('transparent-png'));
vi.mock('../../services/rembg.js', () => ({
  removeBackground: (...args: any[]) => mockRemoveBackground(...args),
}));

function createSharpInstance() {
  const instance: any = {};
  const chainMethods = ['resize', 'jpeg', 'png', 'composite', 'withMetadata', 'flatten',
    'trim', 'extend', 'extract', 'rotate', 'flip', 'flop', 'sharpen', 'median',
    'blur', 'normalise', 'normalize', 'gamma', 'negate', 'linear', 'recomb',
    'modulate', 'tint', 'greyscale', 'grayscale', 'toColorspace', 'toColourspace',
    'removeAlpha', 'ensureAlpha', 'extractChannel', 'joinChannel', 'bandbool',
    'threshold', 'boolean', 'convolve', 'affine', 'clahe', 'unflatten', 'metadata',
    'stats', 'webp', 'avif', 'heif', 'tiff', 'raw', 'gif', 'jp2', 'jxl',
    'toFormat', 'keepExif', 'withExif', 'keepIccProfile', 'withIccProfile',
    'keepMetadata', 'pipelineColorspace', 'pipelineColourspace'];
  for (const method of chainMethods) {
    instance[method] = vi.fn(() => instance);
  }
  instance.toBuffer = vi.fn().mockResolvedValue(Buffer.from('processed-image'));
  instance.toFile = vi.fn().mockResolvedValue({ width: 100, height: 100 });
  return instance;
}

const mockSharpInstance = createSharpInstance();
const mockSharpFn = Object.assign(vi.fn((..._args: any[]) => mockSharpInstance), {
  // sharp can also be called with options object like sharp({ create: { ... } })
});
vi.mock('sharp', () => {
  return { default: mockSharpFn, __esModule: true };
});

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

// Mock global fetch for collage image download
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Import route after mocks ──────────────────────────────────────────────
const { imageRoutes } = await import('../../routes/images.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/images', imageRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/images${path}`, init);
}

const AUTH_HEADER = { 'X-Test-User-Id': 'user-1' };

// Small valid base64 string
const VALID_BASE64 = 'dGVzdC1pbWFnZQ==';

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Image Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-setup sharp chain methods after clearAllMocks
    const chainMethods = ['resize', 'jpeg', 'png', 'composite', 'withMetadata', 'flatten',
      'trim', 'extend', 'extract', 'rotate', 'flip', 'flop', 'sharpen', 'median',
      'blur', 'normalise', 'normalize', 'gamma', 'negate', 'linear', 'recomb',
      'modulate', 'tint', 'greyscale', 'grayscale', 'toColorspace', 'toColourspace',
      'removeAlpha', 'ensureAlpha', 'extractChannel', 'joinChannel', 'bandbool',
      'threshold', 'boolean', 'convolve', 'affine', 'clahe', 'unflatten', 'metadata',
      'stats', 'webp', 'avif', 'heif', 'tiff', 'raw', 'gif', 'jp2', 'jxl',
      'toFormat', 'keepExif', 'withExif', 'keepIccProfile', 'withIccProfile',
      'keepMetadata', 'pipelineColorspace', 'pipelineColourspace'];
    for (const method of chainMethods) {
      mockSharpInstance[method] = vi.fn(() => mockSharpInstance);
    }
    mockSharpInstance.toBuffer = vi.fn().mockResolvedValue(Buffer.from('processed-image'));
    mockSharpFn.mockImplementation(() => mockSharpInstance);
  });

  // ── POST /images/upload ──────────────────────────────────────────────────

  describe('POST /images/upload', () => {
    it('should upload an image with resizing and thumbnail', async () => {
      const res = await req('POST', '/upload', { image: VALID_BASE64, bucket: 'wardrobe' }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.image_url).toBeDefined();
      expect(json.data.thumbnail_url).toBeDefined();
      expect(mockUploadImage).toHaveBeenCalledTimes(2);
    });

    it('should return 400 when image is missing', async () => {
      const res = await req('POST', '/upload', { bucket: 'wardrobe' }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('image');
    });

    it('should return 400 when bucket is missing', async () => {
      const res = await req('POST', '/upload', { image: VALID_BASE64 }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('bucket');
    });

    it('should return 400 for invalid bucket name', async () => {
      const res = await req('POST', '/upload', { image: VALID_BASE64, bucket: 'invalid-bucket' }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid bucket');
    });

    it('should accept all valid bucket names', async () => {
      for (const bucket of ['wardrobe', 'avatars', 'outfits', 'social']) {
        vi.clearAllMocks();
        const res = await req('POST', '/upload', { image: VALID_BASE64, bucket }, AUTH_HEADER);
        expect(res.status).toBe(200);
      }
    });

    it('should return 400 when image exceeds 10MB', async () => {
      const hugeBase64 = 'a'.repeat(10 * 1024 * 1024 * 4 / 3 + 100);
      const res = await req('POST', '/upload', { image: hugeBase64, bucket: 'wardrobe' }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('10MB');
    });

    it('should strip data URI prefix from base64', async () => {
      const dataUri = `data:image/png;base64,${VALID_BASE64}`;
      const res = await req('POST', '/upload', { image: dataUri, bucket: 'wardrobe' }, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/upload', { image: VALID_BASE64, bucket: 'wardrobe' });
      expect(res.status).toBe(401);
    });

    it('should return 500 when sharp processing fails', async () => {
      mockSharpInstance.toBuffer.mockRejectedValueOnce(new Error('Sharp processing error'));
      const res = await req('POST', '/upload', { image: VALID_BASE64, bucket: 'wardrobe' }, AUTH_HEADER);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Sharp processing error');
    });

    it('should return 500 when storage upload fails', async () => {
      mockUploadImage.mockRejectedValueOnce(new Error('Storage unavailable'));
      const res = await req('POST', '/upload', { image: VALID_BASE64, bucket: 'wardrobe' }, AUTH_HEADER);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Storage unavailable');
    });
  });

  // ── POST /images/remove-bg ──────────────────────────────────────────────

  describe('POST /images/remove-bg', () => {
    it('should remove background from an image', async () => {
      const res = await req('POST', '/remove-bg', { image: VALID_BASE64 }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.image_url).toBeDefined();
      expect(mockRemoveBackground).toHaveBeenCalledTimes(1);
      expect(mockUploadImage).toHaveBeenCalledTimes(1);
    });

    it('should return 400 when image is missing', async () => {
      const res = await req('POST', '/remove-bg', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('image');
    });

    it('should return 400 when image exceeds 10MB', async () => {
      const hugeBase64 = 'a'.repeat(10 * 1024 * 1024 * 4 / 3 + 100);
      const res = await req('POST', '/remove-bg', { image: hugeBase64 }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('10MB');
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/remove-bg', { image: VALID_BASE64 });
      expect(res.status).toBe(401);
    });

    it('should return 500 when background removal service fails', async () => {
      mockRemoveBackground.mockRejectedValueOnce(new Error('Rembg service unavailable'));
      const res = await req('POST', '/remove-bg', { image: VALID_BASE64 }, AUTH_HEADER);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Rembg service unavailable');
    });

    it('should strip data URI prefix before processing', async () => {
      const dataUri = `data:image/jpeg;base64,${VALID_BASE64}`;
      const res = await req('POST', '/remove-bg', { image: dataUri }, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should upload result to wardrobe bucket as PNG', async () => {
      await req('POST', '/remove-bg', { image: VALID_BASE64 }, AUTH_HEADER);
      expect(mockUploadImage).toHaveBeenCalledWith(
        'wardrobe',
        expect.stringContaining('nobg_'),
        expect.any(Buffer),
        'image/png'
      );
    });
  });

  // ── POST /images/collage ────────────────────────────────────────────────

  describe('POST /images/collage', () => {
    const validUrls = ['https://abc.supabase.co/storage/v1/object/img1.png'];

    it('should generate a collage from valid image URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const res = await req('POST', '/collage', { item_urls: validUrls }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.collage_url).toBeDefined();
    });

    it('should return 400 when item_urls is empty', async () => {
      const res = await req('POST', '/collage', { item_urls: [] }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('item_urls');
    });

    it('should return 400 when item_urls is missing', async () => {
      const res = await req('POST', '/collage', {}, AUTH_HEADER);
      expect(res.status).toBe(400);
    });

    it('should return 400 when more than 9 items are provided', async () => {
      const tooManyUrls = Array.from({ length: 10 }, (_, i) => `https://abc.supabase.co/img${i}.png`);
      const res = await req('POST', '/collage', { item_urls: tooManyUrls }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Maximum 9');
    });

    it('should reject non-HTTPS URLs (SSRF prevention)', async () => {
      const res = await req('POST', '/collage', { item_urls: ['http://evil.com/image.png'] }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('not allowed');
    });

    it('should reject URLs from non-approved domains (SSRF prevention)', async () => {
      const res = await req('POST', '/collage', { item_urls: ['https://evil.com/image.png'] }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('not allowed');
    });

    it('should reject invalid URLs', async () => {
      const res = await req('POST', '/collage', { item_urls: ['not-a-url'] }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid URL');
    });

    it('should accept supabase.co domain URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const res = await req('POST', '/collage', {
        item_urls: ['https://project.supabase.co/storage/image.png'],
      }, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should accept supabase.in domain URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const res = await req('POST', '/collage', {
        item_urls: ['https://project.supabase.in/storage/image.png'],
      }, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 400 when all image downloads fail', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const res = await req('POST', '/collage', { item_urls: validUrls }, AUTH_HEADER);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Could not download');
    });

    it('should handle partial download failures gracefully', async () => {
      const twoUrls = [
        'https://abc.supabase.co/img1.png',
        'https://abc.supabase.co/img2.png',
      ];
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        })
        .mockRejectedValueOnce(new Error('Timeout'));

      const res = await req('POST', '/collage', { item_urls: twoUrls }, AUTH_HEADER);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should use custom width and height when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      const res = await req('POST', '/collage', {
        item_urls: validUrls,
        width: 800,
        height: 600,
      }, AUTH_HEADER);
      expect(res.status).toBe(200);
    });

    it('should return 401 when not authenticated', async () => {
      const res = await req('POST', '/collage', { item_urls: validUrls });
      expect(res.status).toBe(401);
    });

    it('should upload collage to outfits bucket', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      });

      await req('POST', '/collage', { item_urls: validUrls }, AUTH_HEADER);
      expect(mockUploadImage).toHaveBeenCalledWith(
        'outfits',
        expect.stringContaining('collage_'),
        expect.any(Buffer),
        'image/png'
      );
    });
  });
});
