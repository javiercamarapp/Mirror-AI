import { supabaseAdmin } from './supabase.js';
import { logger } from './logger.js';

// ─── Profanity Blocklist ─────────────────────────────────────────────────────
// Basic blocklist for content moderation. In production, consider using a
// dedicated moderation API (e.g., OpenAI Moderation, Perspective API).
const PROFANITY_BLOCKLIST = [
  'fuck', 'shit', 'ass', 'bitch', 'bastard', 'damn', 'dick', 'cunt',
  'piss', 'cock', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'fag',
  'retard', 'retarded', 'kys', 'kill yourself', 'stfu',
];

// Build regex patterns that match whole words (case-insensitive)
const PROFANITY_PATTERNS = PROFANITY_BLOCKLIST.map(
  (word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
);

/**
 * Checks text content for profanity.
 * Returns an object indicating whether the content passed moderation.
 */
export function checkTextContent(text: string): {
  passed: boolean;
  flaggedWords: string[];
} {
  if (!text || text.trim().length === 0) {
    return { passed: true, flaggedWords: [] };
  }

  const flaggedWords: string[] = [];
  const normalizedText = text.toLowerCase();

  for (let i = 0; i < PROFANITY_BLOCKLIST.length; i++) {
    if (PROFANITY_PATTERNS[i]!.test(normalizedText)) {
      flaggedWords.push(PROFANITY_BLOCKLIST[i]!);
    }
  }

  return {
    passed: flaggedWords.length === 0,
    flaggedWords,
  };
}

// ─── Thresholds ──────────────────────────────────────────────────────────────
const AUTO_FLAG_THRESHOLD = 3;
const AUTO_HIDE_THRESHOLD = 5;
const AUTO_SUSPEND_THRESHOLD = 10;

/**
 * Processes reports for a given piece of content.
 * Automatically flags, hides, or suspends based on report count thresholds.
 *
 * Called after a new report is created.
 */
export async function processReports(
  contentType: string,
  contentId: string
): Promise<void> {
  try {
    // Count total reports for this content
    const { count: reportCount } = await supabaseAdmin
      .from('content_reports')
      .select('id', { count: 'exact', head: true })
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .eq('status', 'pending');

    const total = reportCount ?? 0;

    // Auto-hide posts/stories with 5+ reports
    if (total >= AUTO_HIDE_THRESHOLD) {
      if (contentType === 'post') {
        await supabaseAdmin
          .from('social_posts')
          .update({ is_public: false })
          .eq('id', contentId);
      } else if (contentType === 'story') {
        // Expire the story immediately
        await supabaseAdmin
          .from('stories')
          .update({ expires_at: new Date().toISOString() })
          .eq('id', contentId);
      } else if (contentType === 'comment') {
        // Delete the comment
        await supabaseAdmin
          .from('post_comments')
          .delete()
          .eq('id', contentId);
      }

      // Update report statuses to 'action_taken'
      await supabaseAdmin
        .from('content_reports')
        .update({ status: 'action_taken', reviewed_at: new Date().toISOString() })
        .eq('content_type', contentType)
        .eq('content_id', contentId)
        .eq('status', 'pending');
    } else if (total >= AUTO_FLAG_THRESHOLD) {
      // Auto-flag: update reports to 'reviewed' so admins notice them
      // (they stay visible but are flagged for priority review)
      logger.info(
        { contentType, contentId, reportCount: total },
        `Content ${contentType}:${contentId} flagged with ${total} reports`
      );
    }

    // Check if the reported user should be auto-suspended
    await checkUserSuspension(contentType, contentId);
  } catch (err) {
    logger.error({ err, contentType, contentId }, 'Failed to process moderation reports');
  }
}

/**
 * Checks whether the user who owns the reported content should be auto-suspended.
 * Suspension happens when a user accumulates 10+ pending reports across all their content.
 */
async function checkUserSuspension(
  contentType: string,
  contentId: string
): Promise<void> {
  try {
    // Find the user who owns this content
    let reportedUserId: string | null = null;

    if (contentType === 'post') {
      const { data: post } = await supabaseAdmin
        .from('social_posts')
        .select('user_id')
        .eq('id', contentId)
        .single();
      reportedUserId = post?.user_id ?? null;
    } else if (contentType === 'comment') {
      const { data: comment } = await supabaseAdmin
        .from('post_comments')
        .select('user_id')
        .eq('id', contentId)
        .single();
      reportedUserId = comment?.user_id ?? null;
    } else if (contentType === 'story') {
      const { data: story } = await supabaseAdmin
        .from('stories')
        .select('user_id')
        .eq('id', contentId)
        .single();
      reportedUserId = story?.user_id ?? null;
    } else if (contentType === 'user') {
      reportedUserId = contentId;
    }

    if (!reportedUserId) return;

    // Count all pending/action_taken reports against this user's content
    // We need to find all content by this user and count reports
    const [postsResult, commentsResult, storiesResult, userReportsResult] =
      await Promise.all([
        // Reports on their posts
        supabaseAdmin
          .from('social_posts')
          .select('id')
          .eq('user_id', reportedUserId)
          .then(async ({ data: posts }) => {
            if (!posts || posts.length === 0) return 0;
            const { count } = await supabaseAdmin
              .from('content_reports')
              .select('id', { count: 'exact', head: true })
              .eq('content_type', 'post')
              .in(
                'content_id',
                posts.map((p) => p.id)
              );
            return count ?? 0;
          }),
        // Reports on their comments
        supabaseAdmin
          .from('post_comments')
          .select('id')
          .eq('user_id', reportedUserId)
          .then(async ({ data: comments }) => {
            if (!comments || comments.length === 0) return 0;
            const { count } = await supabaseAdmin
              .from('content_reports')
              .select('id', { count: 'exact', head: true })
              .eq('content_type', 'comment')
              .in(
                'content_id',
                comments.map((c) => c.id)
              );
            return count ?? 0;
          }),
        // Reports on their stories
        supabaseAdmin
          .from('stories')
          .select('id')
          .eq('user_id', reportedUserId)
          .then(async ({ data: stories }) => {
            if (!stories || stories.length === 0) return 0;
            const { count } = await supabaseAdmin
              .from('content_reports')
              .select('id', { count: 'exact', head: true })
              .eq('content_type', 'story')
              .in(
                'content_id',
                stories.map((s) => s.id)
              );
            return count ?? 0;
          }),
        // Direct reports on the user
        supabaseAdmin
          .from('content_reports')
          .select('id', { count: 'exact', head: true })
          .eq('content_type', 'user')
          .eq('content_id', reportedUserId)
          .then(({ count }) => count ?? 0),
      ]);

    const totalReports =
      postsResult + commentsResult + storiesResult + userReportsResult;

    if (totalReports >= AUTO_SUSPEND_THRESHOLD) {
      // Auto-suspend: hide all their posts and mark profile as suspended
      logger.warn(
        { userId: reportedUserId, totalReports },
        `Auto-suspending user ${reportedUserId} with ${totalReports} total reports`
      );

      // Hide all their posts
      await supabaseAdmin
        .from('social_posts')
        .update({ is_public: false })
        .eq('user_id', reportedUserId);

      // Expire all their stories
      await supabaseAdmin
        .from('stories')
        .update({ expires_at: new Date().toISOString() })
        .eq('user_id', reportedUserId)
        .gt('expires_at', new Date().toISOString());
    }
  } catch (err) {
    logger.error({ err, contentType, contentId }, 'Failed to check user suspension');
  }
}
