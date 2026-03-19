import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock contentModeration service ─────────────────────────────────────────
const mockCheckTextContent = vi.fn();

vi.mock('../../services/contentModeration.js', () => ({
  checkTextContent: (...args: any[]) => mockCheckTextContent(...args),
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// ─── Import after mocks ────────────────────────────────────────────────────
const { moderationMiddleware } = await import('../../middleware/moderation.js');

function createApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('/api/*', moderationMiddleware);
  app.post('/api/post', async (c) => {
    const body = await c.req.json();
    return c.json({ success: true, data: body });
  });
  app.put('/api/post', async (c) => {
    const body = await c.req.json();
    return c.json({ success: true, data: body });
  });
  app.patch('/api/post', async (c) => {
    const body = await c.req.json();
    return c.json({ success: true, data: body });
  });
  app.get('/api/post', (c) => c.json({ success: true }));
  return app;
}

function postReq(app: ReturnType<typeof createApp>, body: any, method = 'POST') {
  return app.request('http://localhost/api/post', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('moderationMiddleware', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('should allow clean content through', async () => {
    mockCheckTextContent.mockReturnValue({ passed: true, flaggedWords: [] });

    const res = await postReq(app, { caption: 'Nice outfit today!' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('should reject content with profanity in caption', async () => {
    mockCheckTextContent.mockReturnValue({ passed: false, flaggedWords: ['badword'] });

    const res = await postReq(app, { caption: 'This has badword in it' });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('inappropriate');
  });

  it('should reject content with profanity in description field', async () => {
    mockCheckTextContent.mockReturnValue({ passed: false, flaggedWords: ['offensive'] });

    const res = await postReq(app, { description: 'Contains offensive language' });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('should reject content with profanity in content field', async () => {
    mockCheckTextContent.mockReturnValue({ passed: false, flaggedWords: ['slur'] });

    const res = await postReq(app, { content: 'Has a slur here' });
    expect(res.status).toBe(400);
  });

  it('should reject content with profanity in name field', async () => {
    mockCheckTextContent.mockReturnValue({ passed: false, flaggedWords: ['vulgar'] });

    const res = await postReq(app, { name: 'vulgar name' });
    expect(res.status).toBe(400);
  });

  it('should check multiple text fields and aggregate flagged words', async () => {
    // First field clean, second field flagged
    mockCheckTextContent
      .mockReturnValueOnce({ passed: true, flaggedWords: [] })
      .mockReturnValueOnce({ passed: false, flaggedWords: ['word1'] })
      .mockReturnValueOnce({ passed: false, flaggedWords: ['word2'] });

    const res = await postReq(app, {
      caption: 'clean caption',
      content: 'bad content word1',
      description: 'bad description word2',
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('inappropriate');
  });

  it('should skip GET requests (no body moderation needed)', async () => {
    const res = await app.request('http://localhost/api/post', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    // checkTextContent should not be called for GET
    expect(mockCheckTextContent).not.toHaveBeenCalled();
  });

  it('should handle PUT requests with moderation', async () => {
    mockCheckTextContent.mockReturnValue({ passed: false, flaggedWords: ['badword'] });

    const res = await postReq(app, { caption: 'PUT with badword' }, 'PUT');
    expect(res.status).toBe(400);
  });

  it('should handle PATCH requests with moderation', async () => {
    mockCheckTextContent.mockReturnValue({ passed: false, flaggedWords: ['badword'] });

    const res = await postReq(app, { caption: 'PATCH with badword' }, 'PATCH');
    expect(res.status).toBe(400);
  });

  it('should skip empty string fields', async () => {
    mockCheckTextContent.mockReturnValue({ passed: true, flaggedWords: [] });

    const res = await postReq(app, { caption: '', content: '   ' });
    expect(res.status).toBe(200);
    // Empty and whitespace-only strings should not trigger checkTextContent
    expect(mockCheckTextContent).not.toHaveBeenCalled();
  });

  it('should skip non-string fields without error', async () => {
    mockCheckTextContent.mockReturnValue({ passed: true, flaggedWords: [] });

    const res = await postReq(app, { caption: 123, description: null, name: true });
    expect(res.status).toBe(200);
    // Non-string fields should be skipped
    expect(mockCheckTextContent).not.toHaveBeenCalled();
  });

  it('should allow through if body parsing fails (e.g., no body)', async () => {
    // Request with invalid JSON body - the middleware catch block handles it
    const res = await app.request('http://localhost/api/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{',
    });

    // Should not return 400 from moderation - lets route handler deal with it
    // The middleware catches the parse error and calls next()
    expect(mockCheckTextContent).not.toHaveBeenCalled();
  });

  it('should allow content when all fields pass moderation', async () => {
    mockCheckTextContent.mockReturnValue({ passed: true, flaggedWords: [] });

    const res = await postReq(app, {
      caption: 'Great look!',
      content: 'Love this style',
      description: 'Summer vibes',
      name: 'Beach outfit',
    });

    expect(res.status).toBe(200);
    expect(mockCheckTextContent).toHaveBeenCalledTimes(4);
  });
});
