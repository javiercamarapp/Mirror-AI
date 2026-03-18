import { supabaseAdmin } from './supabase.js';
import { config } from '../config.js';

export type StorageBucket = 'wardrobe' | 'avatars' | 'outfits' | 'social';

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
