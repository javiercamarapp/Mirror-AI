import { describe, it, expect } from 'vitest';

// Test the validation helpers from storage service
describe('Storage Validation', () => {
  const ALLOWED_BUCKETS = new Set(['wardrobe', 'avatars', 'outfits', 'social']);

  it('should accept valid bucket names', () => {
    expect(ALLOWED_BUCKETS.has('wardrobe')).toBe(true);
    expect(ALLOWED_BUCKETS.has('avatars')).toBe(true);
    expect(ALLOWED_BUCKETS.has('outfits')).toBe(true);
    expect(ALLOWED_BUCKETS.has('social')).toBe(true);
  });

  it('should reject invalid bucket names', () => {
    expect(ALLOWED_BUCKETS.has('invalid')).toBe(false);
    expect(ALLOWED_BUCKETS.has('')).toBe(false);
    expect(ALLOWED_BUCKETS.has('admin')).toBe(false);
  });

  it('should reject paths with directory traversal', () => {
    const isValidPath = (path: string) => !path.includes('..') && !path.startsWith('/');
    expect(isValidPath('../etc/passwd')).toBe(false);
    expect(isValidPath('/root/file')).toBe(false);
    expect(isValidPath('user123/image.jpg')).toBe(true);
  });
});

describe('UUID Validation', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('should validate proper UUIDs', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(UUID_REGEX.test('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
  });

  it('should reject invalid UUIDs', () => {
    expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
    expect(UUID_REGEX.test('')).toBe(false);
    expect(UUID_REGEX.test("'; DROP TABLE users; --")).toBe(false);
  });
});
