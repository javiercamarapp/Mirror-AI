import { supabaseAdmin } from './supabase.js';
import { config } from '../config.js';

export type StorageBucket = 'wardrobe' | 'avatars' | 'outfits' | 'social';

const ALLOWED_BUCKETS: ReadonlySet<string> = new Set<StorageBucket>([
  'wardrobe',
  'avatars',
  'outfits',
  'social',
]);

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

function validatePath(path: string): void {
  if (path.includes('..') || path.startsWith('/')) {
    throw new Error(`Invalid storage path: ${path}`);
  }
}

function validateBucket(bucket: string): void {
  if (!ALLOWED_BUCKETS.has(bucket)) {
    throw new Error(`Invalid storage bucket: ${bucket}`);
  }
}

function validateContentType(contentType: string): void {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(`Invalid content type: ${contentType}. Allowed: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`);
  }
}

/**
 * Uploads a file to the specified Supabase Storage bucket.
 * Returns the public URL of the uploaded file.
 */
export async function uploadImage(
  bucket: StorageBucket,
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  validateBucket(bucket);
  validatePath(path);
  validateContentType(contentType);

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed (${bucket}/${path}): ${error.message}`);
  }

  return getPublicUrl(bucket, path);
}

/**
 * Deletes a file from the specified Supabase Storage bucket.
 */
export async function deleteImage(
  bucket: StorageBucket,
  path: string
): Promise<void> {
  validateBucket(bucket);
  validatePath(path);

  const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);

  if (error) {
    throw new Error(`Storage delete failed (${bucket}/${path}): ${error.message}`);
  }
}

/**
 * Returns the public URL for a file in a Supabase Storage bucket.
 */
export function getPublicUrl(bucket: StorageBucket, path: string): string {
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Extracts the storage path from a full public URL.
 * Useful when you have a URL and need the path for deletion.
 */
export function extractPathFromUrl(
  bucket: StorageBucket,
  url: string
): string | null {
  const baseUrl = `${config.supabaseUrl}/storage/v1/object/public/${bucket}/`;
  if (!url.startsWith(baseUrl)) {
    return null;
  }
  return url.slice(baseUrl.length);
}
