import type { Context, Next } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { logger, createChildLogger } from '../services/logger.js';
import type { AppVariables } from '../types/index.js';

/**
 * Structured logging middleware for Hono.
 *
 * Logs every request with:
 * - Request method, path, status code, response time
 * - Unique request ID (UUID v4)
 * - User ID if authenticated
 * - Error details on 4xx/5xx responses
 */
export async function requestLogger(
  c: Context<{ Variables: AppVariables }>,
  next: Next
): Promise<void> {
  const requestId = c.req.header('x-request-id') || uuidv4();
  const start = Date.now();

  // Attach request ID to response headers
  c.header('X-Request-Id', requestId);

  // Store requestId on context for downstream use
  c.set('requestId' as never, requestId);

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;
  const userId = c.get('userId') as string | undefined;

  const logData = {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status,
    duration,
    userAgent: c.req.header('user-agent'),
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    ...(userId ? { userId } : {}),
  };

  if (status >= 500) {
    logger.error(logData, `${c.req.method} ${c.req.path} ${status} ${duration}ms`);
  } else if (status >= 400) {
    logger.warn(logData, `${c.req.method} ${c.req.path} ${status} ${duration}ms`);
  } else {
    logger.info(logData, `${c.req.method} ${c.req.path} ${status} ${duration}ms`);
  }
}
