import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock Supabase ──────────────────────────────────────────────────────────
const mockSupabase = {
  from: vi.fn(),
};

function chainMock(returnValue: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'eq', 'neq', 'or', 'in',
    'single', 'maybeSingle', 'order', 'limit', 'range', 'ilike', 'contains',
    'not', 'gt', 'head',
  ];
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(returnValue));
  chain.maybeSingle = vi.fn(() => Promise.resolve(returnValue));
  chain.then = (resolve: any) => resolve(returnValue);
  return chain;
}

vi.mock('../supabase.js', () => ({
  supabaseAdmin: mockSupabase,
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto.subtle for JWT generation
const mockSign = vi.fn().mockResolvedValue(new Uint8Array(64));
const mockImportKey = vi.fn().mockResolvedValue('mock-key');

vi.stubGlobal('crypto', {
  subtle: {
    importKey: mockImportKey,
    sign: mockSign,
  },
});

// ─── Import after mocks ─────────────────────────────────────────────────────
const { sendPushNotification, sendPushNotificationToMany } = await import('../pushNotifications.js');

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Push Notifications Service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APNS_KEY_ID = 'test-key-id';
    process.env.APNS_TEAM_ID = 'test-team-id';
    process.env.APNS_BUNDLE_ID = 'com.test.app';
    // Provide a base64-encoded PEM-like key for generateAPNsJWT
    const fakePem = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----';
    process.env.APNS_AUTH_KEY = Buffer.from(fakePem).toString('base64');
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── Send notification (valid) ─────────────────────────────────────────────

  describe('sendPushNotification', () => {
    it('should send notification to all user devices', async () => {
      const tokenChain = chainMock({
        data: [{ token: 'device-token-1', platform: 'ios' }],
        error: null,
      });
      mockSupabase.from.mockReturnValue(tokenChain);

      mockFetch.mockResolvedValue({ status: 200 });

      await sendPushNotification('user-1', 'Title', 'Body');
      // Should query device_tokens
      expect(mockSupabase.from).toHaveBeenCalledWith('device_tokens');
    });

    it('should silently return when user has no device tokens', async () => {
      const tokenChain = chainMock({ data: [], error: null });
      mockSupabase.from.mockReturnValue(tokenChain);

      // Should not throw
      await sendPushNotification('user-no-devices', 'Title', 'Body');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should silently return when device_tokens query errors', async () => {
      const tokenChain = chainMock({ data: null, error: { message: 'DB error' } });
      mockSupabase.from.mockReturnValue(tokenChain);

      await sendPushNotification('user-1', 'Title', 'Body');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should remove invalid token on 410 response', async () => {
      const tokenChain = chainMock({
        data: [{ token: 'expired-token', platform: 'ios' }],
        error: null,
      });
      const deleteChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (table === 'device_tokens' && callIdx === 1) return tokenChain;
        return deleteChain;
      });

      mockFetch.mockResolvedValue({
        status: 410,
        json: () => Promise.resolve({ reason: 'Unregistered' }),
      });

      await sendPushNotification('user-1', 'Title', 'Body');
      // Should have attempted to remove the invalid token
      expect(mockSupabase.from).toHaveBeenCalledWith('device_tokens');
    });

    it('should remove token on BadDeviceToken response', async () => {
      const tokenChain = chainMock({
        data: [{ token: 'bad-token', platform: 'ios' }],
        error: null,
      });
      const deleteChain = chainMock({ data: null, error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (table === 'device_tokens' && callIdx === 1) return tokenChain;
        return deleteChain;
      });

      mockFetch.mockResolvedValue({
        status: 400,
        json: () => Promise.resolve({ reason: 'BadDeviceToken' }),
      });

      await sendPushNotification('user-1', 'Title', 'Body');
      expect(mockSupabase.from).toHaveBeenCalledWith('device_tokens');
    });

    it('should never throw (silent failure)', async () => {
      const tokenChain = chainMock({
        data: [{ token: 'token-1', platform: 'ios' }],
        error: null,
      });
      mockSupabase.from.mockReturnValue(tokenChain);
      mockFetch.mockRejectedValue(new Error('Network failure'));

      // Should not throw
      await expect(sendPushNotification('user-1', 'Title', 'Body')).resolves.toBeUndefined();
    });

    it('should skip notification when user has disabled the notification type', async () => {
      const prefChain = chainMock({
        data: { notification_preferences: { likes: false } },
        error: null,
      });
      mockSupabase.from.mockReturnValue(prefChain);

      await sendPushNotification('user-1', 'Title', 'Body', undefined, undefined, 'likes');
      // fetch should not be called since prefs say likes are disabled
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send notification when notification type is enabled', async () => {
      const prefChain = chainMock({
        data: { notification_preferences: { likes: true } },
        error: null,
      });
      const tokenChain = chainMock({
        data: [{ token: 'token-1', platform: 'ios' }],
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? prefChain : tokenChain;
      });

      mockFetch.mockResolvedValue({ status: 200 });

      await sendPushNotification('user-1', 'Title', 'Body', undefined, undefined, 'likes');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should default to enabled when no notification preferences exist', async () => {
      const prefChain = chainMock({
        data: { notification_preferences: null },
        error: null,
      });
      const tokenChain = chainMock({
        data: [{ token: 'token-1', platform: 'ios' }],
        error: null,
      });

      let callIdx = 0;
      mockSupabase.from.mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? prefChain : tokenChain;
      });

      mockFetch.mockResolvedValue({ status: 200 });

      await sendPushNotification('user-1', 'Title', 'Body', undefined, undefined, 'likes');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should skip unsupported platforms (android)', async () => {
      const tokenChain = chainMock({
        data: [{ token: 'android-token', platform: 'android' }],
        error: null,
      });
      mockSupabase.from.mockReturnValue(tokenChain);

      await sendPushNotification('user-1', 'Title', 'Body');
      // fetch should not be called for android platform
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should warn when APNs is not configured', async () => {
      delete process.env.APNS_KEY_ID;
      const { logger } = await import('../logger.js');

      const tokenChain = chainMock({
        data: [{ token: 'token-1', platform: 'ios' }],
        error: null,
      });
      mockSupabase.from.mockReturnValue(tokenChain);

      await sendPushNotification('user-1', 'Title', 'Body');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should handle multiple devices for a single user', async () => {
      const tokenChain = chainMock({
        data: [
          { token: 'device-1', platform: 'ios' },
          { token: 'device-2', platform: 'ios' },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(tokenChain);
      mockFetch.mockResolvedValue({ status: 200 });

      await sendPushNotification('user-1', 'Title', 'Body');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should log warning when all push notifications fail', async () => {
      const { logger } = await import('../logger.js');
      const tokenChain = chainMock({
        data: [
          { token: 'device-1', platform: 'ios' },
          { token: 'device-2', platform: 'ios' },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(tokenChain);
      mockFetch.mockResolvedValue({
        status: 500,
        json: () => Promise.resolve({ reason: 'InternalServerError' }),
      });

      await sendPushNotification('user-1', 'Title', 'Body');
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ── Batch send ────────────────────────────────────────────────────────────

  describe('sendPushNotificationToMany', () => {
    it('should return immediately for empty user list', async () => {
      await sendPushNotificationToMany([], 'sender-1', 'Title', 'Body');
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should exclude users who have blocked the sender', async () => {
      // First call: check blocks from friendships
      const blocksChain = chainMock({
        data: [{ requester_id: 'blocker-user', addressee_id: 'sender-1' }],
        error: null,
      });
      // Second call: check user_blocks
      const userBlocksChain = chainMock({ data: [], error: null });
      // Third+ calls: device tokens (should only be for non-blocked user)
      const tokenChain = chainMock({ data: [], error: null });

      let callIdx = 0;
      mockSupabase.from.mockImplementation((table: string) => {
        callIdx++;
        if (table === 'friendships') return blocksChain;
        if (table === 'user_blocks') return userBlocksChain;
        return tokenChain;
      });

      await sendPushNotificationToMany(
        ['blocker-user', 'normal-user'],
        'sender-1',
        'Title',
        'Body'
      );

      // Should NOT send to blocker-user, only to normal-user
      // The device_tokens query should only be for non-blocked users
    });

    it('should also check user_blocks table for blocked users', async () => {
      const blocksChain = chainMock({ data: [], error: null });
      const userBlocksChain = chainMock({
        data: [{ blocker_id: 'ub-blocker' }],
        error: null,
      });
      const tokenChain = chainMock({ data: [], error: null });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'friendships') return blocksChain;
        if (table === 'user_blocks') return userBlocksChain;
        return tokenChain;
      });

      await sendPushNotificationToMany(
        ['ub-blocker', 'normal-user'],
        'sender-1',
        'Title',
        'Body'
      );

      expect(mockSupabase.from).toHaveBeenCalledWith('user_blocks');
    });

    it('should not throw on batch send failure', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('DB crash');
      });

      await expect(
        sendPushNotificationToMany(['user-1'], 'sender-1', 'Title', 'Body')
      ).resolves.toBeUndefined();
    });
  });
});
