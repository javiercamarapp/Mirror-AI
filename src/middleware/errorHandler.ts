import type { Context } from 'hono';
import { logger } from '../services/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * Consistent error response shape returned by the API.
 */
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

/**
 * Map common HTTP status codes to error code strings.
 */
function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMITED';
    case 502:
      return 'BAD_GATEWAY';
    case 504:
      return 'GATEWAY_TIMEOUT';
    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}

/**
 * Global error handler for Hono's app.onError.
 *
 * - Handles custom AppError instances with proper status codes
 * - Logs full error details with structured logger
 * - Sanitizes error messages in production (no stack traces leaked)
 * - Returns consistent error response format with error code field
 */
export function globalErrorHandler(err: Error, c: Context): Response {
  const requestId = (c.get('requestId' as never) as string) || 'unknown';

  // Determine status code and error code from AppError or fallback
  let status: number;
  let errorCode: string;

  if (err instanceof AppError) {
    status = err.statusCode;
    errorCode = err.code;
  } else {
    status = 'status' in err ? (err as { status: number }).status : 500;
    errorCode = statusToCode(status);
  }

  // Log the full error with stack trace for debugging
  logger.error(
    {
      err,
      requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      errorCode,
    },
    `Unhandled error: ${err.message}`
  );

  // Sanitize message in production
  const isProduction = process.env.NODE_ENV === 'production';
  const message =
    isProduction && status >= 500
      ? 'Internal server error'
      : err.message || 'An unexpected error occurred';

  const body: ErrorResponse = {
    success: false,
    error: {
      code: errorCode,
      message,
      requestId,
    },
  };

  return c.json(body, status >= 400 && status < 600 ? (status as 500) : 500);
}

/**
 * 404 Not Found handler for Hono's app.notFound.
 */
export function notFoundHandler(c: Context): Response {
  const requestId = (c.get('requestId' as never) as string) || 'unknown';

  const body: ErrorResponse = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${c.req.method} ${c.req.path} not found`,
      requestId,
    },
  };

  return c.json(body, 404);
}
