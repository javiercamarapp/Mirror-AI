import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase Storage ──────────────────────────────────────────────────
const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockGetPublicUrl = vi.fn();

const mockStorageFrom = vi.fn(() => ({
  upload: mockUpload,
  remove: mockRemove,
  getPublicUrl: mockGetPublicUrl,
}));

vi.mock('../supabase.js', () => ({
  supabaseAdmin: {
    storage: {
      from: (...args: any[]) => mockStorageFrom(...args),
    },
  },
}));

vi.mock('../../config.js', () => ({
  config: {
    supabaseUrl: 'https://test.supabase.co',
  },
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
const { uploadImage, deleteImage, getPublicUrl, extractPathFromUrl } = await import('../storage.js');

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Storage Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://test.supabase.co/storage/v1/object/public/wardrobe/user-1/image.jpg' },
    });
  });

  // ── uploadImage ───────────────────────────────────────────────────────────

  describe('uploadImage', () => {
    it('should upload a valid image and return public URL', async () => {
      mockUpload.mockResolvedValue({ error: null });

      const buffer = Buffer.from('fake-image');
      const result = await uploadImage('wardrobe', 'user-1/image.jpg', buffer, 'image/jpeg');

      expect(mockStorageFrom).toHaveBeenCalledWith('wardrobe');
      expect(mockUpload).toHaveBeenCalledWith(
        'user-1/image.jpg',
        buffer,
        { contentType: 'image/jpeg', upsert: true }
      );
      expect(result).toContain('https://');
    });

    it('should throw on invalid MIME type', async () => {
      const buffer = Buffer.from('fake-image');
      await expect(
        uploadImage('wardrobe', 'user-1/file.txt', buffer, 'text/plain')
      ).rejects.toThrow('Invalid content type');
    });

    it('should accept image/png', async () => {
      mockUpload.mockResolvedValue({ error: null });
      const buffer = Buffer.from('fake-png');

      await expect(
        uploadImage('wardrobe', 'user-1/image.png', buffer, 'image/png')
      ).resolves.toBeDefined();
    });

    it('should accept image/webp', async () => {
      mockUpload.mockResolvedValue({ error: null });
      const buffer = Buffer.from('fake-webp');

      await expect(
        uploadImage('wardrobe', 'user-1/image.webp', buffer, 'image/webp')
      ).resolves.toBeDefined();
    });

    it('should reject path traversal with ".."', async () => {
      const buffer = Buffer.from('fake-image');
      await expect(
        uploadImage('wardrobe', '../etc/passwd', buffer, 'image/jpeg')
      ).rejects.toThrow('Invalid storage path');
    });

    it('should reject absolute paths starting with "/"', async () => {
      const buffer = Buffer.from('fake-image');
      await expect(
        uploadImage('wardrobe', '/root/image.jpg', buffer, 'image/jpeg')
      ).rejects.toThrow('Invalid storage path');
    });

    it('should throw on disallowed bucket', async () => {
      const buffer = Buffer.from('fake-image');
      await expect(
        uploadImage('forbidden-bucket' as any, 'path/image.jpg', buffer, 'image/jpeg')
      ).rejects.toThrow('Invalid storage bucket');
    });

    it('should accept all allowed buckets', async () => {
      mockUpload.mockResolvedValue({ error: null });
      const buffer = Buffer.from('fake-image');

      for (const bucket of ['wardrobe', 'avatars', 'outfits', 'social'] as const) {
        await expect(
          uploadImage(bucket, 'user-1/image.jpg', buffer, 'image/jpeg')
        ).resolves.toBeDefined();
      }
    });

    it('should throw when supabase upload returns error', async () => {
      mockUpload.mockResolvedValue({ error: { message: 'Bucket full' } });
      const buffer = Buffer.from('fake-image');

      await expect(
        uploadImage('wardrobe', 'user-1/image.jpg', buffer, 'image/jpeg')
      ).rejects.toThrow('Storage upload failed');
    });
  });

  // ── deleteImage ───────────────────────────────────────────────────────────

  describe('deleteImage', () => {
    it('should delete an image successfully', async () => {
      mockRemove.mockResolvedValue({ error: null });

      await deleteImage('wardrobe', 'user-1/image.jpg');
      expect(mockStorageFrom).toHaveBeenCalledWith('wardrobe');
      expect(mockRemove).toHaveBeenCalledWith(['user-1/image.jpg']);
    });

    it('should throw when deletion fails', async () => {
      mockRemove.mockResolvedValue({ error: { message: 'Not found' } });

      await expect(
        deleteImage('wardrobe', 'user-1/missing.jpg')
      ).rejects.toThrow('Storage delete failed');
    });

    it('should reject path traversal in delete', async () => {
      await expect(
        deleteImage('wardrobe', '../etc/passwd')
      ).rejects.toThrow('Invalid storage path');
    });

    it('should reject disallowed bucket in delete', async () => {
      await expect(
        deleteImage('private' as any, 'user-1/image.jpg')
      ).rejects.toThrow('Invalid storage bucket');
    });
  });

  // ── getPublicUrl ──────────────────────────────────────────────────────────

  describe('getPublicUrl', () => {
    it('should return the public URL for a file', () => {
      const url = getPublicUrl('wardrobe', 'user-1/image.jpg');
      expect(url).toBe('https://test.supabase.co/storage/v1/object/public/wardrobe/user-1/image.jpg');
      expect(mockStorageFrom).toHaveBeenCalledWith('wardrobe');
    });
  });

  // ── extractPathFromUrl ────────────────────────────────────────────────────

  describe('extractPathFromUrl', () => {
    it('should extract path from a valid public URL', () => {
      const path = extractPathFromUrl(
        'wardrobe',
        'https://test.supabase.co/storage/v1/object/public/wardrobe/user-1/image.jpg'
      );
      expect(path).toBe('user-1/image.jpg');
    });

    it('should return null for URL from a different bucket', () => {
      const path = extractPathFromUrl(
        'wardrobe',
        'https://test.supabase.co/storage/v1/object/public/avatars/user-1/avatar.jpg'
      );
      expect(path).toBeNull();
    });

    it('should return null for completely unrelated URL', () => {
      const path = extractPathFromUrl('wardrobe', 'https://example.com/image.jpg');
      expect(path).toBeNull();
    });
  });
});
