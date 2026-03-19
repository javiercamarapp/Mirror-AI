import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { cleanupExpiredStories } from '../jobs/storyCleanup.js';
import { logger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';

const admin = new Hono<{ Variables: AppVariables }>();

// All admin routes require authentication
admin.use('*', authMiddleware);

// Admin authorization check middleware
admin.use('*', async (c, next) => {
  const userId = c.get('userId');
  const adminIds = process.env.ADMIN_USER_IDS?.split(',').map((id) => id.trim()) ?? [];

  if (!adminIds.includes(userId)) {
    return c.json({ success: false, error: 'Admin access required' }, 403);
  }

  await next();
});

// ─── GET /admin/jobs/cleanup-stories ─────────────────────────────────────────
// Triggers cleanup of expired stories and their associated views.
// Intended to be called via a cron job or manual admin action.
admin.get('/jobs/cleanup-stories', async (c) => {
  try {
    const result = await cleanupExpiredStories();

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
    logger.error({ err }, 'Admin story cleanup failed');
    return c.json({ success: false, error: message }, 500);
  }
});

export { admin as adminRoutes };
