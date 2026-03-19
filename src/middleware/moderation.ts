import type { Context, Next } from 'hono';
import type { AppVariables } from '../types/index.js';
import { checkTextContent } from '../services/contentModeration.js';

/**
 * Middleware that checks text content in the request body for profanity.
 * Rejects requests with a 400 status if offensive content is detected.
 *
 * Expects the request body to have a `caption`, `content`, or `description` field.
 */
export async function moderationMiddleware(
  c: Context<{ Variables: AppVariables }>,
  next: Next
): Promise<Response | void> {
  // Only check POST/PUT/PATCH requests with a body
  if (!['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    return next();
  }

  try {
    // Clone the request to read body without consuming it
    const body = await c.req.json();

    // Check all text fields that could contain user content
    const textFields = ['caption', 'content', 'description', 'name'];
    const allFlaggedWords: string[] = [];

    for (const field of textFields) {
      const value = body[field];
      if (typeof value === 'string' && value.trim().length > 0) {
        const result = checkTextContent(value);
        if (!result.passed) {
          allFlaggedWords.push(...result.flaggedWords);
        }
      }
    }

    if (allFlaggedWords.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Content contains inappropriate language and cannot be posted',
        },
        400
      );
    }
  } catch {
    // If body parsing fails, let the route handler deal with it
  }

  return next();
}
