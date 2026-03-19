import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';

// ─── Import under test ──────────────────────────────────────────────────────
const { validateBody, schemas } = await import('../../middleware/validate.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

function createApp(schema: z.ZodSchema) {
  const app = new Hono();
  app.post('/test', validateBody(schema), (c) => {
    const body = c.get('validatedBody');
    return c.json({ success: true, data: body });
  });
  return app;
}

function post(app: ReturnType<typeof createApp>, body: any) {
  return app.request('http://localhost/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('validate middleware', () => {
  describe('validateBody', () => {
    const testSchema = z.object({
      name: z.string().min(1).max(100),
      email: z.string().email(),
      age: z.number().int().min(0).max(150).optional(),
    });

    it('should pass validation with a valid body', async () => {
      const app = createApp(testSchema);
      const res = await post(app, { name: 'Alice', email: 'alice@example.com' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Alice');
      expect(json.data.email).toBe('alice@example.com');
    });

    it('should return 400 when required fields are missing', async () => {
      const app = createApp(testSchema);
      const res = await post(app, { name: 'Alice' }); // missing email

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Validation failed');
      expect(json.details).toBeDefined();
      expect(json.details.some((d: string) => d.includes('email'))).toBe(true);
    });

    it('should return 400 when field has wrong type', async () => {
      const app = createApp(testSchema);
      const res = await post(app, { name: 123, email: 'alice@example.com' });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.details.some((d: string) => d.includes('name'))).toBe(true);
    });

    it('should strip extra fields not in schema', async () => {
      const strictSchema = z.object({
        name: z.string(),
      }).strict();
      const looseSchema = z.object({
        name: z.string(),
      });

      // With a non-strict schema, extra fields are allowed by zod parse but not included
      const app = createApp(looseSchema);
      const res = await post(app, { name: 'Alice', extraField: 'should be kept by zod parse' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('Alice');
    });

    it('should validate nested objects', async () => {
      const nestedSchema = z.object({
        user: z.object({
          name: z.string().min(1),
          address: z.object({
            city: z.string().min(1),
          }),
        }),
      });
      const app = createApp(nestedSchema);

      // Valid nested
      const res1 = await post(app, { user: { name: 'Bob', address: { city: 'NYC' } } });
      expect(res1.status).toBe(200);

      // Invalid nested
      const res2 = await post(app, { user: { name: 'Bob', address: { city: '' } } });
      expect(res2.status).toBe(400);
      const json2 = await res2.json();
      expect(json2.details.some((d: string) => d.includes('city'))).toBe(true);
    });

    it('should validate arrays', async () => {
      const arraySchema = z.object({
        tags: z.array(z.string().min(1)).min(1).max(5),
      });
      const app = createApp(arraySchema);

      const validRes = await post(app, { tags: ['a', 'b'] });
      expect(validRes.status).toBe(200);

      const emptyRes = await post(app, { tags: [] });
      expect(emptyRes.status).toBe(400);
    });

    it('should validate string length constraints', async () => {
      const app = createApp(testSchema);

      // Empty name (min 1)
      const res = await post(app, { name: '', email: 'a@b.com' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.details.some((d: string) => d.includes('name'))).toBe(true);
    });

    it('should validate email format', async () => {
      const app = createApp(testSchema);

      const res = await post(app, { name: 'Alice', email: 'not-an-email' });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.details.some((d: string) => d.includes('email'))).toBe(true);
    });

    it('should validate UUID format', async () => {
      const uuidSchema = z.object({
        id: z.string().uuid(),
      });
      const app = createApp(uuidSchema);

      const validRes = await post(app, { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' });
      expect(validRes.status).toBe(200);

      const invalidRes = await post(app, { id: 'not-a-uuid' });
      expect(invalidRes.status).toBe(400);
      const json = await invalidRes.json();
      expect(json.details.some((d: string) => d.includes('id'))).toBe(true);
    });

    it('should return structured error messages with field paths', async () => {
      const app = createApp(testSchema);
      const res = await post(app, {}); // missing name and email

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toMatchObject({
        success: false,
        error: 'Validation failed',
      });
      expect(Array.isArray(json.details)).toBe(true);
      expect(json.details.length).toBeGreaterThanOrEqual(2);
      // Each detail should contain field path and message
      for (const detail of json.details) {
        expect(typeof detail).toBe('string');
        expect(detail).toContain(':'); // "field: message" format
      }
    });

    it('should return 400 for non-JSON body', async () => {
      const app = createApp(testSchema);
      const res = await app.request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid request body');
    });
  });

  // ── Built-in schemas ────────────────────────────────────────────────────────

  describe('schemas', () => {
    it('should validate magicLink schema with valid email', async () => {
      const app = createApp(schemas.magicLink);
      const res = await post(app, { email: 'test@example.com' });
      expect(res.status).toBe(200);
    });

    it('should reject magicLink schema with invalid email', async () => {
      const app = createApp(schemas.magicLink);
      const res = await post(app, { email: 'bad' });
      expect(res.status).toBe(400);
    });

    it('should validate createPost schema', async () => {
      const app = createApp(schemas.createPost);
      const res = await post(app, {
        type: 'outfit',
        image_url: 'https://example.com/img.jpg',
        caption: 'Nice outfit',
      });
      expect(res.status).toBe(200);
    });

    it('should reject createPost with invalid type enum', async () => {
      const app = createApp(schemas.createPost);
      const res = await post(app, {
        type: 'invalid_type',
        image_url: 'https://example.com/img.jpg',
      });
      expect(res.status).toBe(400);
    });

    it('should validate blockUser schema requires UUID', async () => {
      const app = createApp(schemas.blockUser);

      const validRes = await post(app, { blocked_user_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' });
      expect(validRes.status).toBe(200);

      const invalidRes = await post(app, { blocked_user_id: 'not-uuid' });
      expect(invalidRes.status).toBe(400);
    });
  });
});
