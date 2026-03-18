/**
 * Apple App Store receipt/transaction verification service.
 *
 * Performs basic JWS decode of signed transactions from StoreKit 2.
 * Full cryptographic verification using Apple's public keys (via `jose`)
 * should be added once the dependency is installed.
 */

const EXPECTED_BUNDLE_ID = 'com.mirrorai.app';

export interface VerifyTransactionResult {
  isValid: boolean;
  productId: string | null;
  expiresDate: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
}

/**
 * Base64url decode (RFC 7515) — handles the URL-safe alphabet and missing padding.
 */
function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Decode and verify an Apple StoreKit 2 signed transaction (JWS).
 *
 * Currently performs structural validation and bundle-ID check.
 * Cryptographic signature verification is deferred until `jose` is available.
 */
export function verifyTransaction(signedTransaction: string): VerifyTransactionResult {
  const invalid: VerifyTransactionResult = {
    isValid: false,
    productId: null,
    expiresDate: null,
    transactionId: null,
    originalTransactionId: null,
  };

  try {
    const parts = signedTransaction.split('.');
    if (parts.length !== 3) {
      return invalid;
    }

    const payloadJson = base64urlDecode(parts[1]!);
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    // Validate bundle ID
    if (payload.bundleId !== EXPECTED_BUNDLE_ID) {
      return invalid;
    }

    return {
      isValid: true,
      productId: (payload.productId as string) ?? null,
      expiresDate: payload.expiresDate
        ? new Date(payload.expiresDate as number).toISOString()
        : null,
      transactionId: payload.transactionId != null ? String(payload.transactionId) : null,
      originalTransactionId: payload.originalTransactionId != null
        ? String(payload.originalTransactionId)
        : null,
    };
  } catch {
    return invalid;
  }
}
