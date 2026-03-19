import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
  createChildLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock('../../config.js', () => ({
  config: {
    apnsBundleId: 'com.mirrorai.app',
  },
}));

// Since verifyTransaction/verifySignedPayload depend on jose JWS verification
// and crypto X509Certificate chain verification (which are hard to mock at the
// native module level), we test the exported functions by mocking jose and
// relying on the catch-all error handling for certificate chain failures.
vi.mock('jose', () => ({
  decodeProtectedHeader: vi.fn(),
  jwtVerify: vi.fn(),
  importX509: vi.fn(),
}));

const jose = await import('jose');

const { verifyTransaction, verifySignedPayload } = await import('../appstore.js');

describe('App Store Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── verifyTransaction ─────────────────────────────────────────────────

  describe('verifyTransaction', () => {
    it('should return invalid when x5c chain is missing', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({ x5c: [] });

      const result = await verifyTransaction('no-x5c-transaction');

      expect(result.isValid).toBe(false);
      expect(result.productId).toBeNull();
      expect(result.transactionId).toBeNull();
    });

    it('should return invalid when x5c is undefined', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({});

      const result = await verifyTransaction('no-x5c');

      expect(result.isValid).toBe(false);
    });

    it('should return invalid when JWS verification throws', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1', 'cert2'],
      });
      // importX509 is called for the root CA and certificate chain
      // The certificate chain verification uses crypto.X509Certificate
      // which will throw in test environment, so verifyTransaction should
      // catch the error and return invalid
      (jose.importX509 as any).mockRejectedValue(new Error('Invalid certificate'));

      const result = await verifyTransaction('bad-cert-transaction');

      expect(result.isValid).toBe(false);
    });

    it('should return invalid when decodeProtectedHeader throws', async () => {
      (jose.decodeProtectedHeader as any).mockImplementation(() => {
        throw new Error('Malformed JWS');
      });

      const result = await verifyTransaction('malformed-jws');

      expect(result.isValid).toBe(false);
      expect(result.productId).toBeNull();
    });

    it('should return all null fields on invalid result', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({ x5c: [] });

      const result = await verifyTransaction('invalid-transaction');

      expect(result).toEqual({
        isValid: false,
        productId: null,
        expiresDate: null,
        transactionId: null,
        originalTransactionId: null,
      });
    });

    it('should return the correct VerifyTransactionResult shape', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({ x5c: [] });

      const result = await verifyTransaction('test');

      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('productId');
      expect(result).toHaveProperty('expiresDate');
      expect(result).toHaveProperty('transactionId');
      expect(result).toHaveProperty('originalTransactionId');
    });

    it('should catch errors from certificate chain verification', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert-base64'],
      });
      // importX509 will be called for root CA, which should work,
      // but then crypto.X509Certificate constructor will fail
      // because we're in a test environment without real certs
      (jose.importX509 as any).mockResolvedValue({ type: 'public' });

      const result = await verifyTransaction('chain-fail-transaction');

      // Should gracefully return invalid
      expect(result.isValid).toBe(false);
    });

    it('should handle empty string input', async () => {
      (jose.decodeProtectedHeader as any).mockImplementation(() => {
        throw new Error('Invalid compact JWS');
      });

      const result = await verifyTransaction('');

      expect(result.isValid).toBe(false);
    });
  });

  // ── verifySignedPayload ───────────────────────────────────────────────

  describe('verifySignedPayload', () => {
    it('should return null when x5c is missing', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({ x5c: [] });

      const result = await verifySignedPayload('no-x5c-payload');

      expect(result).toBeNull();
    });

    it('should return null when x5c is undefined', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({});

      const result = await verifySignedPayload('no-x5c');

      expect(result).toBeNull();
    });

    it('should return null when signature verification fails', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1'],
      });
      (jose.importX509 as any).mockRejectedValue(new Error('Invalid cert'));

      const result = await verifySignedPayload('invalid-signature-payload');

      expect(result).toBeNull();
    });

    it('should return null when decodeProtectedHeader throws', async () => {
      (jose.decodeProtectedHeader as any).mockImplementation(() => {
        throw new Error('Malformed JWS');
      });

      const result = await verifySignedPayload('malformed-jws');

      expect(result).toBeNull();
    });

    it('should catch errors from certificate chain and return null', async () => {
      (jose.decodeProtectedHeader as any).mockReturnValue({
        x5c: ['cert1', 'cert2'],
      });
      (jose.importX509 as any).mockResolvedValue({ type: 'public' });
      // Certificate chain will fail because X509Certificate uses real crypto

      const result = await verifySignedPayload('chain-fail-payload');

      expect(result).toBeNull();
    });

    it('should handle empty string input', async () => {
      (jose.decodeProtectedHeader as any).mockImplementation(() => {
        throw new Error('Invalid compact JWS');
      });

      const result = await verifySignedPayload('');

      expect(result).toBeNull();
    });

    it('should return null on any unexpected error', async () => {
      (jose.decodeProtectedHeader as any).mockImplementation(() => {
        throw new TypeError('Unexpected type error');
      });

      const result = await verifySignedPayload('unexpected-error');

      expect(result).toBeNull();
    });

    it('should return correct shape for VerifyTransactionResult', async () => {
      // The verifyTransaction function should always return an object
      // with the correct shape, even on failure
      (jose.decodeProtectedHeader as any).mockReturnValue({ x5c: [] });

      const txnResult = await verifyTransaction('shape-test');

      expect(typeof txnResult.isValid).toBe('boolean');
      expect(txnResult.productId === null || typeof txnResult.productId === 'string').toBe(true);
      expect(txnResult.expiresDate === null || typeof txnResult.expiresDate === 'string').toBe(true);
      expect(txnResult.transactionId === null || typeof txnResult.transactionId === 'string').toBe(true);
      expect(txnResult.originalTransactionId === null || typeof txnResult.originalTransactionId === 'string').toBe(true);
    });
  });
});
