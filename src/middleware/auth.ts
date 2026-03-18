import type { Context, Next } from 'hono';
import { supabaseAdmin } from '../services/supabase.js';
import type { AppVariables } from '../types/index.js';

/**
 * Hono middleware that verifies the Supabase JWT from the Authorization header
 * and injects the authenticated user's ID into the request context.
 */
export async function authMiddleware(
  c: Context<{ Variables: AppVariables }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing or malformed Authorization header' }, 401);
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  if (!token) {
    return c.json({ success: false, error: 'Missing access token' }, 401);
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return c.json(
      { success: false, error: 'Invalid or expired access token' },
      401
    );
  }

  c.set('userId', user.id);

  await next();
}
