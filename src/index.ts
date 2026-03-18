import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { config, validateConfig } from './config.js';
import type { AppVariables } from './types/index.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/user.js';
import { wardrobeRoutes } from './routes/wardrobe.js';
import { outfitRoutes } from './routes/outfits.js';
import { aiRoutes } from './routes/ai.js';
import { vtonRoutes } from './routes/vton.js';
import { imageRoutes } from './routes/images.js';
import { socialRoutes } from './routes/social.js';
import { friendsRoutes } from './routes/friends.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { avatarRoutes } from './routes/avatar.js';

// Validate required env vars before anything else
validateConfig();

const app = new Hono<{ Variables: AppVariables }>();

// ─── Global Middleware ────────────────────────────────────────────────────────

app.use('*', logger());

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

// ─── Health Check ────────────────────────────────────────────────────────────

app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'mirror-ai-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  })
);

// ─── Route Modules ───────────────────────────────────────────────────────────

app.route('/api/auth', authRoutes);
app.route('/api/user', userRoutes);
app.route('/api/wardrobe', wardrobeRoutes);
app.route('/api/outfits', outfitRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/vton', vtonRoutes);
app.route('/api/images', imageRoutes);
app.route('/api/social', socialRoutes);
app.route('/api/friends', friendsRoutes);
app.route('/api/subscriptions', subscriptionRoutes);
app.route('/api/avatar', avatarRoutes);

// ─── 404 Fallback ────────────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ success: false, error: 'Not found' }, 404)
);

// ─── Global Error Handler ────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.url}:`, err);
  return c.json(
    {
      success: false,
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : err.message,
    },
    500
  );
});

// ─── Start Server ────────────────────────────────────────────────────────────

console.log(`Mirror AI backend starting on port ${config.port}...`);

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Mirror AI backend running at http://localhost:${info.port}`);
  }
);

export default app;
