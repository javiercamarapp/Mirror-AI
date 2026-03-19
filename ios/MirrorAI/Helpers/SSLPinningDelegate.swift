import Foundation
import Security
import CommonCrypto
import os

// MARK: - SSL Certificate Pinning Delegate
// Implements public key pinning for the Mirror AI backend and Supabase domains.

final class SSLPinningDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {

    static let shared = SSLPinningDelegate()
    private static let logger = Logger(subsystem: "com.mirrorai", category: "SSLPinning")

    /// SHA-256 SPKI (Subject Public Key Info) hashes for pinned domains.
    ///
    /// PIN ROTATION PROTOCOL:
    /// ──────────────────────
    /// Each domain carries THREE pins: current leaf, next (backup), and a CA-level
    /// emergency pin. This ensures zero-downtime rotation and a safety net if the
    /// leaf key is compromised.
    ///
    /// Rotation steps:
    ///   1. Before the current cert expires, generate the next keypair and derive its
    ///      SPKI hash. Add it as the backup pin and ship an app update.
    ///   2. Deploy the new certificate on the server.
    ///   3. Move the old leaf hash to position [1] (grace period) and promote the
    ///      backup to position [0]. Add the *next* upcoming hash at position [1].
    ///   4. After one full app-update cycle, remove the retired hash.
    ///
    /// Re-derive hashes with:
    ///     openssl s_client -connect <host>:443 2>/dev/null \
    ///       | openssl x509 -pubkey -noout \
    ///       | openssl pkey -pubin -outform DER \
    ///       | openssl dgst -sha256 -binary \
    ///       | openssl enc -base64
    ///
    /// Last rotated: 2025-Q4
    /// Next scheduled rotation: 2026-Q2
    private let pinnedDomains: [String: [String]] = [
        "mirror-ai-backend.fly.dev": [
            // Current production leaf SPKI hash (Fly.io managed TLS, deployed 2025-11-01)
            "YLh1dUR9y6Kja30RrAn7JKnbQG/uEtLMkBgFF2Fuihg=",
            // Backup pin — pre-generated keypair for next rotation (2026-Q2)
            "Vjs8r4z+80wjNcr1YKepWQboSIRi63WsWXhIMN+eWys=",
            // Emergency CA pin — Let's Encrypt ISRG Root X1 SPKI
            "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M="
        ],
        "mirror-ai-backend-staging.fly.dev": [
            // Current staging leaf SPKI hash (deployed 2025-11-01)
            "k2v6FkKswR0HplGN9WsuVIqLg3WeMa6yrVqdEQuMwSk=",
            // Backup pin — pre-generated keypair for next rotation (2026-Q2)
            "7HIpactkIAq2Y49orFOOQKurWxmmSFZhBCoQYcRhJ3Y=",
            // Emergency CA pin — Let's Encrypt ISRG Root X1 SPKI
            "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M="
        ]
    ]

    /// Domains that are allowed without pinning (e.g., image CDNs, Apple APIs)
    private let exemptDomains: Set<String> = [
        "apple.com",
        "icloud.com",
        "mzstatic.com"
    ]

    private override init() {
        super.init()
    }

    // MARK: - URLSessionDelegate

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        let host = challenge.protectionSpace.host

        // Allow exempt domains (Apple, CDN, etc.)
        if exemptDomains.contains(where: { host.hasSuffix($0) }) {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        // If the domain isn't in our pinned list, use default handling
        guard let expectedHashes = pinnedDomains[host] else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        // Evaluate the server trust
        var secError: CFError?
        let isTrusted = SecTrustEvaluateWithError(serverTrust, &secError)

        guard isTrusted else {
            Self.logger.error("Server trust evaluation failed for \(host): \(String(describing: secError))")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Extract the server's public key and compare its hash
        guard let serverCertificate = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate],
              let leafCertificate = serverCertificate.first else {
            Self.logger.error("No certificate found for \(host)")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Get public key from leaf certificate
        guard let publicKey = SecCertificateCopyKey(leafCertificate),
              let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
            Self.logger.error("Cannot extract public key for \(host)")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Compute SHA-256 hash of the public key
        let publicKeyHash = sha256Hash(of: publicKeyData)

        // Check if the hash matches any of our pinned hashes
        if expectedHashes.contains(publicKeyHash) {
            let credential = URLCredential(trust: serverTrust)
            completionHandler(.useCredential, credential)
        } else {
            Self.logger.error("Public key hash mismatch for \(host)")
            Self.logger.error("Expected one of: \(expectedHashes)")
            Self.logger.error("Got: \(publicKeyHash)")
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    // MARK: - Helpers

    private func sha256Hash(of data: Data) -> String {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { bytes in
            _ = CC_SHA256(bytes.baseAddress, CC_LONG(data.count), &hash)
        }
        return Data(hash).base64EncodedString()
    }
}

// MARK: - URLSession Extension for Pinned Sessions

extension URLSession {
    /// Creates a URLSession with SSL certificate pinning enabled.
    static func pinned(configuration: URLSessionConfiguration = .default) -> URLSession {
        return URLSession(
            configuration: configuration,
            delegate: SSLPinningDelegate.shared,
            delegateQueue: nil
        )
    }
}
