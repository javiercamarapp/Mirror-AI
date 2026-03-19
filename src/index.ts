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
import { geminiBreaker, fashnBreaker, fireworksBreaker } from './services/circuit-breaker.js';
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

// ─── Prometheus-Style Metrics Collector ──────────────────────────────────────

const metrics = {
  requestCount: new Map<string, number>(),
  requestDurations: [] as number[],
  activeConnections: 0,
};

/** Increment a counter by key. */
function incCounter(key: string): void {
  metrics.requestCount.set(key, (metrics.requestCount.get(key) ?? 0) + 1);
}

/** Record a request duration sample (seconds). */
function recordDuration(seconds: number): void {
  metrics.requestDurations.push(seconds);
  // Keep a rolling window of the last 10 000 samples to bound memory
  if (metrics.requestDurations.length > 10_000) {
    metrics.requestDurations.splice(0, metrics.requestDurations.length - 10_000);
  }
}

/** Build histogram buckets from duration samples. */
function buildHistogram(samples: number[]): Record<string, number> {
  const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, Infinity];
  const counts: Record<string, number> = {};
  for (const b of buckets) {
    const label = b === Infinity ? '+Inf' : String(b);
    counts[label] = samples.filter((s) => s <= b).length;
  }
  return counts;
}

// ─── Active Connection Tracking Middleware ────────────────────────────────────

let isShuttingDown = false;

app.use('*', async (c, next) => {
  if (isShuttingDown) {
    return c.json({ success: false, error: 'Server is shutting down' }, 503);
  }
  metrics.activeConnections++;
  const start = Date.now();
  try {
    await next();
  } finally {
    metrics.activeConnections--;
    const durationSec = (Date.now() - start) / 1000;
    recordDuration(durationSec);
    const key = `${c.req.method}|${c.req.routePath || c.req.path}|${c.res.status}`;
    incCounter(key);
  }
});

// ─── Request Timeout Middleware ──────────────────────────────────────────────

app.use('*', async (c, next) => {
  const path = c.req.path;
  const isLongRunning =
    path.includes('/images/') ||
    path.includes('/avatar') ||
    path.includes('/vton') ||
    path.includes('/ai/');

  const timeoutMs = isLongRunning ? 120_000 : 30_000; // 120s for image/AI, 30s default

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Race the handler against the timeout
    await new Promise<void>((resolve, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(new Error('GATEWAY_TIMEOUT'));
      });
      next().then(resolve).catch(reject);
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'GATEWAY_TIMEOUT') {
      return c.json(
        { success: false, error: 'Request timed out', code: 'GATEWAY_TIMEOUT' },
        504
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
});

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

// ─── Prometheus Metrics Endpoint ─────────────────────────────────────────────

app.get('/metrics', (c) => {
  const lines: string[] = [];

  // request_count by method, path, status
  lines.push('# HELP request_count Total number of HTTP requests');
  lines.push('# TYPE request_count counter');
  for (const [key, count] of metrics.requestCount) {
    const [method, path, status] = key.split('|');
    lines.push(`request_count{method="${method}",path="${path}",status="${status}"} ${count}`);
  }

  // request_duration_seconds histogram
  lines.push('# HELP request_duration_seconds Request duration in seconds');
  lines.push('# TYPE request_duration_seconds histogram');
  const histogram = buildHistogram(metrics.requestDurations);
  for (const [bucket, count] of Object.entries(histogram)) {
    lines.push(`request_duration_seconds_bucket{le="${bucket}"} ${count}`);
  }
  const sum = metrics.requestDurations.reduce((a, b) => a + b, 0);
  lines.push(`request_duration_seconds_sum ${sum.toFixed(6)}`);
  lines.push(`request_duration_seconds_count ${metrics.requestDurations.length}`);

  // active_connections gauge
  lines.push('# HELP active_connections Current number of active connections');
  lines.push('# TYPE active_connections gauge');
  lines.push(`active_connections ${metrics.activeConnections}`);

  // circuit_breaker_state by service
  lines.push('# HELP circuit_breaker_state Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)');
  lines.push('# TYPE circuit_breaker_state gauge');
  const stateValue = (state: string): number => {
    if (state === 'CLOSED') return 0;
    if (state === 'HALF_OPEN') return 1;
    return 2; // OPEN
  };
  lines.push(`circuit_breaker_state{service="gemini"} ${stateValue(geminiBreaker.getState())}`);
  lines.push(`circuit_breaker_state{service="fashn"} ${stateValue(fashnBreaker.getState())}`);
  lines.push(`circuit_breaker_state{service="fireworks"} ${stateValue(fireworksBreaker.getState())}`);

  c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return c.text(lines.join('\n') + '\n');
});

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

  // Circuit breaker states
  const circuitBreakers: Record<string, string> = {
    gemini: geminiBreaker.getState(),
    fashn: fashnBreaker.getState(),
    fireworks: fireworksBreaker.getState(),
  };

  // If any breaker is OPEN, mark as degraded
  for (const [name, state] of Object.entries(circuitBreakers)) {
    if (state === 'OPEN') {
      checks[`circuit_breaker_${name}`] = { status: 'OPEN' };
      allHealthy = false;
    }
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
      circuitBreakers,
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

// ─── Graceful Shutdown with Request Draining ─────────────────────────────────

const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');

  // Stop accepting new requests
  isShuttingDown = true;

  // Disconnect Redis before closing the server
  try {
    await disconnectRedis();
  } catch (err) {
    logger.error({ err }, 'Error disconnecting Redis during shutdown');
  }

  // Wait for active connections to drain (check every 500ms, up to 10s)
  const drainDeadline = Date.now() + 10_000;
  while (metrics.activeConnections > 0 && Date.now() < drainDeadline) {
    logger.info({ activeConnections: metrics.activeConnections }, 'Waiting for active requests to drain');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (metrics.activeConnections > 0) {
    logger.warn(
      { activeConnections: metrics.activeConnections },
      'Forcing shutdown with active connections still open'
    );
  }

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force close after 15s (extended from 10s to allow drain time)
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
