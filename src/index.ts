import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { config, validateConfig } from './config.js';
import { supabaseAdmin } from './services/supabase.js';
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
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

// ─── Security Headers ─────────────────────────────────────────────────────────

app.use('*', async (c, next) => {
  await next();
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
});

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getRateLimitKey(ip: string, isAuth: boolean): string {
  return isAuth ? `auth:${ip}` : `general:${ip}`;
}

app.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const isAuth = c.req.path.startsWith('/api/auth');
  const key = getRateLimitKey(ip, isAuth);
  const maxRequests = isAuth ? 10 : 100;
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const now = Date.now();

  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count++;
    if (entry.count > maxRequests) {
      return c.json({ success: false, error: 'Too many requests' }, 429);
    }
  }

  // Periodically clean up expired entries
  if (Math.random() < 0.01) {
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }

  await next();
});

// ─── Health Check ────────────────────────────────────────────────────────────

app.get('/api/health', async (c) => {
  try {
    const { error } = await supabaseAdmin.from('user_profiles').select('id').limit(1);
    if (error) throw error;
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    return c.json({ status: 'degraded', timestamp: new Date().toISOString() }, 503);
  }
});

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

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Mirror AI backend running at http://localhost:${info.port}`);
  }
);

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  // Force close after 10s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
