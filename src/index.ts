import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { supabaseAdmin } from './services/supabase.js';
import { logger } from './services/logger.js';
import { isRedisHealthy, disconnectRedis } from './services/redis.js';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter, endpointRateLimiter } from './middleware/rateLimiter.js';
import { globalErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
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
import { adminRoutes } from './routes/admin.js';

// ─── Read package.json version at startup ────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string };
const APP_VERSION = pkg.version;
const startTime = Date.now();

const app = new Hono<{ Variables: AppVariables }>();

// ─── Structured Request Logging ─────────────────────────────────────────────

app.use('*', requestLogger);

// ─── CORS ───────────────────────────────────────────────────────────────────

app.use(
  '*',
  cors({
    origin: config.allowedOrigins.split(','),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length', 'X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
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
  c.header('Content-Security-Policy', "default-src 'self'");
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// ─── Redis-Based Rate Limiter ───────────────────────────────────────────────

app.use('*', rateLimiter);

// ─── Health Check Endpoints ─────────────────────────────────────────────────

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    version: APP_VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/ready', async (c) => {
  const checks: Record<string, { status: string; latency?: number }> = {};
  let allHealthy = true;

  // Check Supabase connectivity
  const supabaseStart = Date.now();
  try {
    const { error } = await supabaseAdmin.from('user_profiles').select('id').limit(1);
    if (error) throw error;
    checks.supabase = { status: 'ok', latency: Date.now() - supabaseStart };
  } catch {
    checks.supabase = { status: 'down', latency: Date.now() - supabaseStart };
    allHealthy = false;
  }

  // Check Redis connectivity
  const redisStart = Date.now();
  try {
    const healthy = await isRedisHealthy();
    checks.redis = {
      status: healthy ? 'ok' : 'unavailable',
      latency: Date.now() - redisStart,
    };
    // Redis is optional — don't mark as unhealthy if unavailable
  } catch {
    checks.redis = { status: 'unavailable', latency: Date.now() - redisStart };
  }

  const status = allHealthy ? 'ready' : 'degraded';
  const httpStatus = allHealthy ? 200 : 503;

  return c.json(
    {
      status,
      version: APP_VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks,
    },
    httpStatus
  );
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
app.route('/api/admin', adminRoutes);

// ─── 404 Fallback ────────────────────────────────────────────────────────────

app.notFound(notFoundHandler);

// ─── Global Error Handler ────────────────────────────────────────────────────

app.onError(globalErrorHandler);

// ─── Start Server ────────────────────────────────────────────────────────────

logger.info({ port: config.port }, 'Mirror AI backend starting');

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    logger.info({ port: info.port, version: APP_VERSION }, 'Mirror AI backend running');
  }
);

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');

  // Disconnect Redis before closing the server
  try {
    await disconnectRedis();
  } catch (err) {
    logger.error({ err }, 'Error disconnecting Redis during shutdown');
  }

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force close after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
