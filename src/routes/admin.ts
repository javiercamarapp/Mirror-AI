import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { cleanupExpiredStories } from '../jobs/storyCleanup.js';
import { logger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';

const admin = new Hono<{ Variables: AppVariables }>();

// ─── Validate ADMIN_USER_IDS at route registration time ─────────────────────
const ADMIN_USER_IDS: string[] = (() => {
  const raw = process.env.ADMIN_USER_IDS?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
  if (raw.length === 0) {
    logger.warn('ADMIN_USER_IDS is empty or not set — all admin endpoints will reject requests');
  }
  // Basic UUID-ish validation (Supabase UUIDs)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of raw) {
    if (!UUID_RE.test(id)) {
      logger.warn({ id }, 'ADMIN_USER_IDS contains a value that does not look like a UUID');
    }
  }
  return raw;
})();

// ─── Admin rate-limit state (simple in-memory, per-user, per-minute) ────────
const adminRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const ADMIN_RATE_LIMIT = 30; // requests per window
const ADMIN_RATE_WINDOW_MS = 60_000; // 1 minute

// All admin routes require authentication
admin.use('*', authMiddleware);

// Admin authorization check middleware
admin.use('*', async (c, next) => {
  const userId = c.get('userId');

  if (!ADMIN_USER_IDS.includes(userId)) {
    logger.warn(
      { userId, method: c.req.method, path: c.req.path, ip: c.req.header('x-forwarded-for') },
      'Admin auth failed — unauthorized user attempted admin access'
    );
    return c.json({ success: false, error: 'Admin access required' }, 403);
  }

  // Per-user rate limiting for admin endpoints
  const now = Date.now();
  let bucket = adminRateLimitMap.get(userId);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + ADMIN_RATE_WINDOW_MS };
    adminRateLimitMap.set(userId, bucket);
  }
  bucket.count++;
  if (bucket.count > ADMIN_RATE_LIMIT) {
    logger.warn({ userId }, 'Admin rate limit exceeded');
    return c.json({ success: false, error: 'Admin rate limit exceeded. Try again shortly.' }, 429);
  }

  await next();
});

// ─── Audit helper ───────────────────────────────────────────────────────────
function auditLog(adminId: string, action: string, details?: Record<string, unknown>) {
  logger.info({ adminId, adminAction: action, ...details }, `[ADMIN AUDIT] ${action}`);
}

// ─── GET /admin/jobs/cleanup-stories ─────────────────────────────────────────
// Triggers cleanup of expired stories and their associated views.
// Intended to be called via a cron job or manual admin action.
admin.get('/jobs/cleanup-stories', async (c) => {
  const adminId = c.get('userId');
  auditLog(adminId, 'cleanup-stories:start');

  try {
    const result = await cleanupExpiredStories();

    auditLog(adminId, 'cleanup-stories:success', {
      deleted_stories: result.deletedStories,
      deleted_views: result.deletedViews,
    });

    return c.json({
      success: true,
      data: {
        message: 'Story cleanup completed',
        deleted_stories: result.deletedStories,
        deleted_views: result.deletedViews,
        executed_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, adminId }, 'Admin story cleanup failed');
    auditLog(adminId, 'cleanup-stories:error', { error: message });
    return c.json({ success: false, error: message }, 500);
  }
});

export { admin as adminRoutes };
