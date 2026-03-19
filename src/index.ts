import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { supabaseAdmin } from './services/supabase.js';
import { logger } from './services/logger.js';
import { isRedisHealthy, disconnectRedis } from './services/redis.js';
import { requestLogger } from './middleware/requestLogger.js';
import { rateLimiter } from './middleware/rateLimiter.js';
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

// ─── Request Body Size Limits ────────────────────────────────────────────────
// Global limit: reject any request body larger than 10 MB.
// Image-upload endpoints have their own per-route validation; this is a safety net.
app.use('*', async (c, next) => {
  const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
  const GLOBAL_MAX = 10 * 1024 * 1024; // 10 MB

  if (contentLength > GLOBAL_MAX) {
    return c.json({ success: false, error: 'Request body too large (max 10 MB)' }, 413);
  }

  // For non-image endpoints, enforce a tighter 1 MB limit.
  const path = c.req.path;
  const isImageEndpoint =
    path.includes('/images/') ||
    path.includes('/avatar') ||
    path.includes('/vton') ||
    path.includes('/ai/analyze-outfit') ||
    path.includes('/ai/analyze-colors') ||
    path.includes('/ai/identify-garment') ||
    path.includes('/outfits/daily');

  const STRICT_MAX = 1 * 1024 * 1024; // 1 MB
  if (!isImageEndpoint && contentLength > STRICT_MAX) {
    return c.json({ success: false, error: 'Request body too large (max 1 MB for this endpoint)' }, 413);
  }

  await next();
});

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

  // Check Gemini API connectivity
  const geminiStart = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generation_config: { max_output_tokens: 1 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    checks.gemini = {
      status: response.ok ? 'ok' : 'degraded',
      latency: Date.now() - geminiStart,
    };
    if (!response.ok) allHealthy = false;
  } catch {
    checks.gemini = { status: 'down', latency: Date.now() - geminiStart };
    allHealthy = false;
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
