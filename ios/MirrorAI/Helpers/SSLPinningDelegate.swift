import Foundation
import Security
import CommonCrypto

// MARK: - SSL Certificate Pinning Delegate
// Implements public key pinning for the Mirror AI backend and Supabase domains.

final class SSLPinningDelegate: NSObject, URLSessionDelegate, @unchecked Sendable {

    static let shared = SSLPinningDelegate()

    /// SHA-256 hashes of the public keys for pinned domains.
    /// In production, replace these with actual SPKI (Subject Public Key Info) hashes
    /// obtained from your server certificates.
    private let pinnedDomains: [String: [String]] = [
        "mirror-ai-backend.fly.dev": [
            // Production backend pin (replace with actual SPKI hash)
            // To get the hash: openssl s_client -connect mirror-ai-backend.fly.dev:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | openssl enc -base64
            "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
        ],
        "mirror-ai-backend-staging.fly.dev": [
            // Staging backend pin (replace with actual SPKI hash)
            "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC="
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
            print("[SSLPinning] Server trust evaluation failed for \(host): \(String(describing: secError))")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Extract the server's public key and compare its hash
        guard let serverCertificate = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate],
              let leafCertificate = serverCertificate.first else {
            print("[SSLPinning] No certificate found for \(host)")
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Get public key from leaf certificate
        guard let publicKey = SecCertificateCopyKey(leafCertificate),
              let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
            print("[SSLPinning] Cannot extract public key for \(host)")
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
            print("[SSLPinning] Public key hash mismatch for \(host)")
            print("[SSLPinning] Expected one of: \(expectedHashes)")
            print("[SSLPinning] Got: \(publicKeyHash)")
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
