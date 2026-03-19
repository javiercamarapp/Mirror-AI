import { supabaseAdmin } from '../services/supabase.js';

/**
 * Cleans up expired stories and their associated story_views.
 *
 * Stories expire when their `expires_at` timestamp is in the past.
 * Due to the ON DELETE CASCADE constraint on story_views.story_id,
 * deleting stories automatically removes associated views. However,
 * we explicitly clean up views for expired stories first as a safety
 * measure in case cascading deletes are not configured.
 *
 * Returns a summary of deleted counts.
 */
export async function cleanupExpiredStories(): Promise<{
  deletedStories: number;
  deletedViews: number;
}> {
  const now = new Date().toISOString();
  let deletedStories = 0;
  let deletedViews = 0;

  try {
    // Step 1: Find all expired story IDs
    const { data: expiredStories, error: fetchError } = await supabaseAdmin
      .from('stories')
      .select('id')
      .lt('expires_at', now);

    if (fetchError) {
      console.error('[StoryCleanup] Failed to fetch expired stories:', fetchError.message);
      return { deletedStories: 0, deletedViews: 0 };
    }

    if (!expiredStories || expiredStories.length === 0) {
      console.log('[StoryCleanup] No expired stories found');
      return { deletedStories: 0, deletedViews: 0 };
    }

    const expiredIds = expiredStories.map((s) => s.id);

    // Step 2: Delete associated story_views for expired stories.
    // Process in batches to avoid overly large IN clauses.
    const BATCH_SIZE = 500;
    for (let i = 0; i < expiredIds.length; i += BATCH_SIZE) {
      const batch = expiredIds.slice(i, i + BATCH_SIZE);

      const { error: viewError } = await supabaseAdmin
        .from('story_views')
        .delete()
        .in('story_id', batch);

      if (viewError) {
        console.error('[StoryCleanup] Failed to delete story views batch:', viewError.message);
      } else {
        deletedViews += batch.length;
      }
    }

    // Step 3: Delete the expired stories themselves.
    for (let i = 0; i < expiredIds.length; i += BATCH_SIZE) {
      const batch = expiredIds.slice(i, i + BATCH_SIZE);

      const { error: storyError } = await supabaseAdmin
        .from('stories')
        .delete()
        .in('id', batch);

      if (storyError) {
        console.error('[StoryCleanup] Failed to delete stories batch:', storyError.message);
      } else {
        deletedStories += batch.length;
      }
    }

    console.log(
      `[StoryCleanup] Cleaned up ${deletedStories} expired stories and ${deletedViews} story views`
    );

    return { deletedStories, deletedViews };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[StoryCleanup] Unexpected error:', message);
    return { deletedStories, deletedViews };
  }
}
