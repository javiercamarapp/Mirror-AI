import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// Mock jose and crypto before importing the module
vi.mock('jose', () => ({
  decodeProtectedHeader: vi.fn(),
  jwtVerify: vi.fn(),
  importX509: vi.fn(),
}));

// We need to mock crypto.X509Certificate
const mockCheckIssued = vi.fn();
const MockX509Certificate = vi.fn().mockImplementation(() => ({
  checkIssued: mockCheckIssued,
  validFrom: new Date(Date.now() - 86400000).toISOString(),
  validTo: new Date(Date.now() + 365 * 86400000).toISOString(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    default: {
      ...actual,
      X509Certificate: MockX509Certificate,
    },
    X509Certificate: MockX509Certificate,
  };
});

const jose = await import('jose');

const { verifyTransaction, verifySignedPayload } = await import('../../services/appstore.js');

describe('App Store Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckIssued.mockReturnValue(true);
  });

  // ── verifyTransaction ─────────────────────────────────────────────────

  describe('verifyTransaction', () => {
    it('should return valid result for a properly signed transaction', async () => {
      const mockLeafKey = { type: 'public' };
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['leaf-cert-base64', 'intermediate-cert-base64'],
      });
      (jose.importX509 as any).mockResolvedValue(mockLeafKey);
      (jose.jwtVerify as any).mockResolvedValue({
        payload: {
          bundleId: 'com.mirrorai.app',
          environment: 'Sandbox',
          productId: 'com.mirrorai.pro.monthly',
          transactionId: '1000000012345',
          originalTransactionId: '1000000012340',
          expiresDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
          signedDate: Date.now(),
        },
      });

      const result = await verifyTransaction('valid-signed-transaction');

      expect(result.isValid).toBe(true);
      expect(result.productId).toBe('com.mirrorai.pro.monthly');
      expect(result.transactionId).toBe('1000000012345');
      expect(result.originalTransactionId).toBe('1000000012340');
      expect(result.expiresDate).toBeTruthy();
    });

    it('should return invalid when x5c chain is missing', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({ x5c: [] });

      const result = await verifyTransaction('no-x5c-transaction');

      expect(result.isValid).toBe(false);
      expect(result.productId).toBeNull();
    });

    it('should return invalid when bundle ID mismatches', async () => {
      const mockLeafKey = { type: 'public' };
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockResolvedValue(mockLeafKey);
      (jose.jwtVerify as any).mockResolvedValue({
        payload: {
          bundleId: 'com.other.app',
          environment: 'Production',
          productId: 'prod-1',
          transactionId: 'txn-1',
          signedDate: Date.now(),
        },
      });

      const result = await verifyTransaction('wrong-bundle-transaction');

      expect(result.isValid).toBe(false);
    });

    it('should return invalid for disallowed environment', async () => {
      const mockLeafKey = { type: 'public' };
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockResolvedValue(mockLeafKey);
      (jose.jwtVerify as any).mockResolvedValue({
        payload: {
          bundleId: 'com.mirrorai.app',
          environment: 'Xcode',
          signedDate: Date.now(),
        },
      });

      const result = await verifyTransaction('bad-env-transaction');

      expect(result.isValid).toBe(false);
    });

    it('should return invalid when signed date is too far from now', async () => {
      const mockLeafKey = { type: 'public' };
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockResolvedValue(mockLeafKey);
      (jose.jwtVerify as any).mockResolvedValue({
        payload: {
          bundleId: 'com.mirrorai.app',
          environment: 'Production',
          signedDate: Date.now() - 10 * 60 * 1000, // 10 minutes ago (beyond 5min skew)
        },
      });

      const result = await verifyTransaction('stale-transaction');

      expect(result.isValid).toBe(false);
    });

    it('should return invalid when JWS verification throws', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockResolvedValue({ type: 'public' });
      (jose.jwtVerify as any).mockRejectedValue(new Error('Signature verification failed'));

      const result = await verifyTransaction('tampered-transaction');

      expect(result.isValid).toBe(false);
    });

    it('should return null fields when claims are missing', async () => {
      const mockLeafKey = { type: 'public' };
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockResolvedValue(mockLeafKey);
      (jose.jwtVerify as any).mockResolvedValue({
        payload: {
          bundleId: 'com.mirrorai.app',
          signedDate: Date.now(),
        },
      });

      const result = await verifyTransaction('minimal-transaction');

      expect(result.isValid).toBe(true);
      expect(result.productId).toBeNull();
      expect(result.expiresDate).toBeNull();
      expect(result.transactionId).toBeNull();
    });

    it('should handle certificate chain verification failure', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1', 'cert2'],
      });
      mockCheckIssued.mockReturnValue(false);
      (jose.importX509 as any).mockResolvedValue({ type: 'public' });

      const result = await verifyTransaction('bad-chain-transaction');

      expect(result.isValid).toBe(false);
    });
  });

  // ── verifySignedPayload ───────────────────────────────────────────────

  describe('verifySignedPayload', () => {
    it('should return decoded notification payload for valid JWS', async () => {
      const mockLeafKey = { type: 'public' };
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockResolvedValue(mockLeafKey);
      mockCheckIssued.mockReturnValue(true);
      (jose.jwtVerify as any).mockResolvedValue({
        payload: {
          notificationType: 'DID_RENEW',
          subtype: 'AUTO_RENEW',
          data: {
            signedTransactionInfo: 'nested-jws',
            environment: 'Sandbox',
            bundleId: 'com.mirrorai.app',
          },
        },
      });

      const result = await verifySignedPayload('valid-signed-payload');

      expect(result).not.toBeNull();
      expect(result!.notificationType).toBe('DID_RENEW');
      expect(result!.subtype).toBe('AUTO_RENEW');
      expect(result!.data?.signedTransactionInfo).toBe('nested-jws');
    });

    it('should return null when x5c is missing', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({ x5c: [] });

      const result = await verifySignedPayload('no-x5c-payload');

      expect(result).toBeNull();
    });

    it('should return null when notificationType is missing', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockResolvedValue({ type: 'public' });
      mockCheckIssued.mockReturnValue(true);
      (jose.jwtVerify as any).mockResolvedValue({
        payload: { someOtherField: 'value' },
      });

      const result = await verifySignedPayload('missing-type-payload');

      expect(result).toBeNull();
    });

    it('should return null when signature verification fails', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockResolvedValue({ type: 'public' });
      (jose.jwtVerify as any).mockRejectedValue(new Error('Invalid signature'));

      const result = await verifySignedPayload('invalid-signature-payload');

      expect(result).toBeNull();
    });
  });
});
