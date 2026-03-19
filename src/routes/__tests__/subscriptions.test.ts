import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppVariables } from '../../types/index.js';

// ─── Mock Supabase ─────────────────────────────────────────────────────────
const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
};

vi.mock('../../services/supabase.js', () => ({
  supabaseAdmin: mockSupabase,
}));

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: vi.fn(async (c: any, next: any) => {
    const userId = c.req.header('X-Test-User-Id');
    if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
    c.set('userId', userId);
    await next();
  }),
}));

vi.mock('../../services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../services/appstore.js', () => ({
  verifyTransaction: vi.fn(),
  verifySignedPayload: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

// Helper to build chainable query mock
function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in', 'single', 'maybeSingle', 'order', 'limit', 'range'];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

const { subscriptionRoutes } = await import('../../routes/subscriptions.js');
const { verifyTransaction, verifySignedPayload } = await import('../../services/appstore.js');

const app = new Hono<{ Variables: AppVariables }>();
app.route('/subscriptions', subscriptionRoutes);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/subscriptions${path}`, init);
}

const AUTH_HEADERS = { 'X-Test-User-Id': 'user-sub-1' };

describe('Subscription Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Webhook ────────────────────────────────────────────────────────────

  describe('POST /subscriptions/webhooks/appstore', () => {
    it('should return 400 when signedPayload is missing', async () => {
      const res = await req('POST', '/webhooks/appstore', {});
      expect(res.status).toBe(400);
    });

    it('should return 403 when signature verification fails', async () => {
      (verifySignedPayload as any).mockResolvedValue(null);

      const res = await req('POST', '/webhooks/appstore', { signedPayload: 'invalid-jws' });
      expect(res.status).toBe(403);
    });

    it('should handle DID_RENEW notification type', async () => {
      (verifySignedPayload as any).mockResolvedValue({
        notificationType: 'DID_RENEW',
        data: { signedTransactionInfo: 'signed-txn' },
      });
      (verifyTransaction as any).mockReturnValue({
        isValid: true,
        originalTransactionId: 'orig-txn-1',
        transactionId: 'txn-renew-1',
        expiresDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const subChain = chainMock({
        data: { id: 'sub-1', user_id: 'user-1', product_id: 'com.mirrorai.pro.monthly', plan: 'basic' },
        error: null,
      });
      const insertChain = chainMock({ data: null, error: null });
      const updateChain = chainMock({ data: null, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return subChain;
        if (callIdx === 2) return insertChain;
        return updateChain;
      });

      const res = await req('POST', '/webhooks/appstore', { signedPayload: 'valid-jws' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('should handle EXPIRED notification type and downgrade user', async () => {
      (verifySignedPayload as any).mockResolvedValue({
        notificationType: 'EXPIRED',
        data: { signedTransactionInfo: 'signed-txn' },
      });
      (verifyTransaction as any).mockReturnValue({
        isValid: true,
        originalTransactionId: 'orig-txn-2',
        transactionId: 'txn-exp-1',
      });

      const subChain = chainMock({
        data: { id: 'sub-2', user_id: 'user-2', plan: 'basic' },
        error: null,
      });
      const updateChain = chainMock({ data: null, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return subChain;
        return updateChain;
      });

      const res = await req('POST', '/webhooks/appstore', { signedPayload: 'valid-jws' });
      expect(res.status).toBe(200);
    });

    it('should handle REFUND notification type', async () => {
      (verifySignedPayload as any).mockResolvedValue({
        notificationType: 'REFUND',
        data: { signedTransactionInfo: 'signed-txn' },
      });
      (verifyTransaction as any).mockReturnValue({
        isValid: true,
        transactionId: 'txn-refund-1',
      });

      const subChain = chainMock({
        data: { id: 'sub-3', user_id: 'user-3', plan: 'premium' },
        error: null,
      });
      const updateChain = chainMock({ data: null, error: null });
      mockSupabase.from.mockImplementation(() => {
        return subChain;
      });

      const res = await req('POST', '/webhooks/appstore', { signedPayload: 'valid-jws' });
      expect(res.status).toBe(200);
    });

    it('should handle DID_FAIL_TO_RENEW notification', async () => {
      (verifySignedPayload as any).mockResolvedValue({
        notificationType: 'DID_FAIL_TO_RENEW',
        data: { signedTransactionInfo: 'signed-txn' },
      });
      (verifyTransaction as any).mockReturnValue({
        isValid: true,
        originalTransactionId: 'orig-txn-fail',
      });

      const subChain = chainMock({
        data: { id: 'sub-fail', user_id: 'user-fail' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(subChain);

      const res = await req('POST', '/webhooks/appstore', { signedPayload: 'valid-jws' });
      expect(res.status).toBe(200);
    });

    it('should reject webhook with invalid nested transaction', async () => {
      (verifySignedPayload as any).mockResolvedValue({
        notificationType: 'DID_RENEW',
        data: { signedTransactionInfo: 'bad-nested' },
      });
      (verifyTransaction as any).mockReturnValue({ isValid: false });

      const res = await req('POST', '/webhooks/appstore', { signedPayload: 'valid-outer' });
      expect(res.status).toBe(400);
    });

    it('should acknowledge unknown notification types', async () => {
      (verifySignedPayload as any).mockResolvedValue({
        notificationType: 'SOME_FUTURE_TYPE',
        data: {},
      });

      const res = await req('POST', '/webhooks/appstore', { signedPayload: 'valid-jws' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  // ── Verify Subscription ───────────────────────────────────────────────

  describe('POST /subscriptions/verify', () => {
    it('should verify receipt and activate subscription', async () => {
      (verifyTransaction as any).mockReturnValue({
        isValid: true,
        transactionId: 'txn-v-1',
        expiresDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      // Check duplicate: not found; insert history; update profile
      const noExistingChain = chainMock({ data: null, error: { code: 'PGRST116' } });
      const insertChain = chainMock({ data: null, error: null });
      const profileChain = chainMock({ data: { subscription_plan: 'basic', vton_credits: 15 }, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return noExistingChain;
        if (callIdx === 2) return insertChain;
        return profileChain;
      });

      const res = await req('POST', '/verify', {
        receipt_data: 'valid-receipt',
        product_id: 'com.mirrorai.pro.monthly',
      }, AUTH_HEADERS);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.plan).toBe('basic');
    });

    it('should return 400 when receipt_data is missing', async () => {
      const res = await req('POST', '/verify', { product_id: 'x' }, AUTH_HEADERS);
      expect(res.status).toBe(400);
    });

    it('should return 400 when product_id is missing', async () => {
      const res = await req('POST', '/verify', { receipt_data: 'x' }, AUTH_HEADERS);
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid product_id', async () => {
      (verifyTransaction as any).mockReturnValue({ isValid: true, transactionId: 't1' });

      const res = await req('POST', '/verify', {
        receipt_data: 'receipt',
        product_id: 'com.invalid.product',
      }, AUTH_HEADERS);
      expect(res.status).toBe(400);
    });

    it('should return 400 when transaction verification fails', async () => {
      (verifyTransaction as any).mockReturnValue({ isValid: false });

      const res = await req('POST', '/verify', {
        receipt_data: 'bad-receipt',
        product_id: 'com.mirrorai.pro.monthly',
      }, AUTH_HEADERS);
      expect(res.status).toBe(400);
    });

    it('should return 409 for duplicate transaction', async () => {
      (verifyTransaction as any).mockReturnValue({ isValid: true, transactionId: 'dup-txn' });

      const dupChain = chainMock({ data: { id: 'existing-sub' }, error: null });
      mockSupabase.from.mockReturnValue(dupChain);

      const res = await req('POST', '/verify', {
        receipt_data: 'receipt',
        product_id: 'com.mirrorai.pro.monthly',
      }, AUTH_HEADERS);
      expect(res.status).toBe(409);
    });
  });

  // ── Subscription Status ───────────────────────────────────────────────

  describe('GET /subscriptions/status', () => {
    it('should return current subscription status', async () => {
      const profileChain = chainMock({
        data: { subscription_plan: 'premium', vton_credits: 42 },
        error: null,
      });
      const subChain = chainMock({
        data: { id: 'sub-active', expires_at: new Date(Date.now() + 86400000).toISOString(), status: 'active' },
        error: null,
      });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? profileChain : subChain;
      });

      const res = await req('GET', '/status', undefined, AUTH_HEADERS);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.plan).toBe('premium');
      expect(json.data.vton_credits_remaining).toBe(42);
    });

    it('should return 404 when profile not found', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/status', undefined, AUTH_HEADERS);
      expect(res.status).toBe(404);
    });
  });

  // ── Trial ──────────────────────────────────────────────────────────────

  describe('POST /subscriptions/trial/start', () => {
    it('should start a 7-day trial', async () => {
      const profileChain = chainMock({ data: { trial_end_date: null }, error: null });
      const updateChain = chainMock({ data: null, error: null });
      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? profileChain : updateChain;
      });

      const res = await req('POST', '/trial/start', {}, AUTH_HEADERS);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.is_trial_active).toBe(true);
      expect(json.data.trial_days_remaining).toBe(7);
    });

    it('should reject trial if already used', async () => {
      const chain = chainMock({
        data: { trial_end_date: '2025-01-01T00:00:00Z' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/trial/start', {}, AUTH_HEADERS);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('already been used');
    });
  });

  describe('GET /subscriptions/trial/status', () => {
    it('should return active trial status', async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const chain = chainMock({
        data: { trial_end_date: futureDate, subscription_plan: 'basic', created_at: '2025-01-01' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/trial/status', undefined, AUTH_HEADERS);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.is_trial_active).toBe(true);
      expect(json.data.trial_days_remaining).toBeGreaterThan(0);
    });

    it('should return expired trial status', async () => {
      const chain = chainMock({
        data: { trial_end_date: '2020-01-01T00:00:00Z', subscription_plan: 'free', created_at: '2019-12-25' },
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('GET', '/trial/status', undefined, AUTH_HEADERS);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.is_trial_active).toBe(false);
      expect(json.data.trial_days_remaining).toBe(0);
    });
  });

  // ── Credit Purchase ───────────────────────────────────────────────────

  describe('POST /subscriptions/purchases/credits', () => {
    it('should purchase credits successfully', async () => {
      const packChain = chainMock({
        data: { id: 'pack-1', product_id: 'com.mirrorai.credits.10', credits: 10, active: true },
        error: null,
      });
      const profileChain = chainMock({ data: { vton_credits: 5 }, error: null });
      const updateChain = chainMock({ data: null, error: null });
      const purchaseChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return packChain;
        if (callIdx === 2) return profileChain;
        if (callIdx === 3) return updateChain;
        return purchaseChain;
      });

      const res = await req('POST', '/purchases/credits', {
        product_id: 'com.mirrorai.credits.10',
        receipt_data: 'receipt',
        transaction_id: 'txn-credit-1',
      }, AUTH_HEADERS);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.credits_added).toBe(10);
      expect(json.data.credits_total).toBe(15);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await req('POST', '/purchases/credits', { product_id: 'x' }, AUTH_HEADERS);
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid credit pack', async () => {
      const chain = chainMock({ data: null, error: { code: 'PGRST116' } });
      mockSupabase.from.mockReturnValue(chain);

      const res = await req('POST', '/purchases/credits', {
        product_id: 'invalid-pack',
        receipt_data: 'r',
        transaction_id: 't',
      }, AUTH_HEADERS);
      expect(res.status).toBe(400);
    });
  });
});
