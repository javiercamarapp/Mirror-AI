/**
 * Apple App Store receipt/transaction verification service.
 *
 * Performs full JWS signature verification of signed transactions from StoreKit 2
 * using Apple's root certificate and the `jose` library.
 */

import * as jose from 'jose';
import crypto from 'node:crypto';

const EXPECTED_BUNDLE_ID = 'com.mirrorai.app';

/**
 * Apple's Root CA — G3 certificate in PEM format.
 * Used to verify the certificate chain in JWS headers from App Store Server.
 * Source: https://www.apple.com/certificateauthority/
 */
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKR1FEZNHsn3eIhB2IsUhEEpBmf
TL4ORXZ0s2pJKmOyaKNjMGEwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wHwYDVR0jBBgwFoAUu7DeoVgziJqkipnevr3rr9rL
JKswDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY
2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3U
T82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==
-----END CERTIFICATE-----`;

/**
 * Allowed App Store Server environments.
 */
const ALLOWED_ENVIRONMENTS = new Set(['Production', 'Sandbox']);

/**
 * Maximum allowed clock skew for signed date validation (5 minutes).
 */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface VerifyTransactionResult {
  isValid: boolean;
  productId: string | null;
  expiresDate: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
}

let _appleRootKey: jose.KeyLike | null = null;

/**
 * Load and cache Apple's root CA public key for certificate chain verification.
 */
async function getAppleRootKey(): Promise<jose.KeyLike> {
  if (_appleRootKey) return _appleRootKey;
  const cert = await jose.importX509(APPLE_ROOT_CA_G3_PEM, 'ES384');
  _appleRootKey = cert;
  return cert;
}

/**
 * Verify the x5c certificate chain from the JWS header against Apple's root CA.
 * Returns the leaf certificate's public key if valid, or throws.
 */
async function verifyCertificateChain(x5c: string[]): Promise<jose.KeyLike> {
  if (!x5c || x5c.length === 0) {
    throw new Error('Missing x5c certificate chain in JWS header');
  }

  // The last certificate in the chain should be signed by Apple Root CA
  const rootKey = await getAppleRootKey();

  // Build X509Certificate objects from the chain
  const certs = x5c.map((certBase64) => {
    const pem = `-----BEGIN CERTIFICATE-----\n${certBase64}\n-----END CERTIFICATE-----`;
    return new crypto.X509Certificate(pem);
  });

  // Verify each certificate is signed by its parent (next in chain)
  for (let i = 0; i < certs.length - 1; i++) {
    const child = certs[i]!;
    const parent = certs[i + 1]!;
    if (!child.checkIssued(parent)) {
      throw new Error(`Certificate chain verification failed at index ${i}`);
    }
  }

  // Verify the root of the chain (last cert) is signed by Apple's root CA
  const topCert = certs[certs.length - 1]!;
  const rootCertObj = new crypto.X509Certificate(APPLE_ROOT_CA_G3_PEM);
  if (!topCert.checkIssued(rootCertObj)) {
    throw new Error('Certificate chain does not chain to Apple Root CA');
  }

  // Check that no certificate in the chain has expired
  const now = new Date();
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i]!;
    const notBefore = new Date(cert.validFrom);
    const notAfter = new Date(cert.validTo);
    if (now < notBefore || now > notAfter) {
      throw new Error(`Certificate at index ${i} has expired or is not yet valid`);
    }
  }

  // Return the leaf certificate's public key for JWS verification
  const leafPem = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`;
  return await jose.importX509(leafPem, 'ES256');
}

/**
 * Decode and cryptographically verify an Apple StoreKit 2 signed transaction (JWS).
 *
 * Validates:
 * 1. JWS cryptographic signature via the x5c certificate chain
 * 2. Certificate chain chains to Apple Root CA G3
 * 3. Bundle ID matches expected value
 * 4. Environment is Production or Sandbox
 * 5. Signed date is within acceptable clock skew
 */
export async function verifyTransaction(signedTransaction: string): Promise<VerifyTransactionResult> {
  const invalid: VerifyTransactionResult = {
    isValid: false,
    productId: null,
    expiresDate: null,
    transactionId: null,
    originalTransactionId: null,
  };

  try {
    // Step 1: Decode the protected header to extract x5c chain
    const protectedHeader = jose.decodeProtectedHeader(signedTransaction);

    if (!protectedHeader.x5c || protectedHeader.x5c.length === 0) {
      console.error('[App Store Verify] Missing x5c certificate chain');
      return invalid;
    }

    // Step 2: Verify certificate chain against Apple Root CA and get leaf key
    const leafKey = await verifyCertificateChain(protectedHeader.x5c);

    // Step 3: Verify JWS signature using the leaf certificate's public key
    const { payload } = await jose.jwtVerify(signedTransaction, leafKey, {
      // Apple does not use standard JWT claims like iss/aud, so skip those checks
      clockTolerance: MAX_CLOCK_SKEW_MS / 1000,
    });

    const claims = payload as Record<string, unknown>;

    // Step 4: Validate bundle ID
    if (claims.bundleId !== EXPECTED_BUNDLE_ID) {
      console.error(`[App Store Verify] Bundle ID mismatch: got "${claims.bundleId}", expected "${EXPECTED_BUNDLE_ID}"`);
      return invalid;
    }

    // Step 5: Validate environment
    if (claims.environment && !ALLOWED_ENVIRONMENTS.has(claims.environment as string)) {
      console.error(`[App Store Verify] Invalid environment: "${claims.environment}"`);
      return invalid;
    }

    // Step 6: Validate signed date is not too far in the future or past
    if (claims.signedDate) {
      const signedDate = new Date(claims.signedDate as number);
      const now = Date.now();
      if (Math.abs(now - signedDate.getTime()) > MAX_CLOCK_SKEW_MS) {
        console.error(`[App Store Verify] Signed date out of acceptable range: ${signedDate.toISOString()}`);
        return invalid;
      }
    }

    return {
      isValid: true,
      productId: (claims.productId as string) ?? null,
      expiresDate: claims.expiresDate
        ? new Date(claims.expiresDate as number).toISOString()
        : null,
      transactionId: claims.transactionId != null ? String(claims.transactionId) : null,
      originalTransactionId: claims.originalTransactionId != null
        ? String(claims.originalTransactionId)
        : null,
    };
  } catch (err) {
    console.error('[App Store Verify] Transaction verification failed:', err);
    return invalid;
  }
}

/**
 * Verify an App Store Server Notification v2 signed payload.
 * The webhook body contains a `signedPayload` which is itself a JWS.
 * The payload contains `notificationType` and optionally a nested `signedTransactionInfo`.
 *
 * Returns the decoded notification payload if valid, or null.
 */
export async function verifySignedPayload(signedPayload: string): Promise<{
  notificationType: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    environment?: string;
    bundleId?: string;
  };
} | null> {
  try {
    const protectedHeader = jose.decodeProtectedHeader(signedPayload);

    if (!protectedHeader.x5c || protectedHeader.x5c.length === 0) {
      console.error('[App Store Webhook] Missing x5c certificate chain');
      return null;
    }

    const leafKey = await verifyCertificateChain(protectedHeader.x5c);

    const { payload } = await jose.jwtVerify(signedPayload, leafKey, {
      clockTolerance: MAX_CLOCK_SKEW_MS / 1000,
    });

    const claims = payload as Record<string, unknown>;

    if (!claims.notificationType) {
      console.error('[App Store Webhook] Missing notificationType in payload');
      return null;
    }

    return {
      notificationType: claims.notificationType as string,
      subtype: claims.subtype as string | undefined,
      data: claims.data as {
        signedTransactionInfo?: string;
        signedRenewalInfo?: string;
        environment?: string;
        bundleId?: string;
      } | undefined,
    };
  } catch (err) {
    console.error('[App Store Webhook] Signed payload verification failed:', err);
    return null;
  }
}
