import Foundation
import os

// MARK: - API Error

enum APIError: LocalizedError {
    case invalidURL
    case noAuthToken
    case encodingFailed
    case decodingFailed(Error)
    case httpError(statusCode: Int, message: String?)
    case rateLimited(retryAfter: TimeInterval)
    case serverError(String)
    case networkError(Error)
    case noData
    case apiResponseError(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .noAuthToken:
            return "Not authenticated. Please sign in."
        case .encodingFailed:
            return "Failed to encode request body"
        case .decodingFailed(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .httpError(let code, let message):
            return "HTTP \(code): \(message ?? "Unknown error")"
        case .rateLimited(let retryAfter):
            return "Rate limited. Retry after \(Int(retryAfter)) seconds."
        case .serverError(let message):
            return "Server error: \(message)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .noData:
            return "No data received"
        case .apiResponseError(let message):
            return message
        }
    }
}

// MARK: - Network Service

actor NetworkService {
    static let shared = NetworkService()
    private static let logger = Logger(subsystem: "com.mirrorai", category: "NetworkService")

    private var authToken: String?
    private let session: URLSession
    private let jsonEncoder: JSONEncoder
    private let jsonDecoder: JSONDecoder

    private let maxRetries = 3
    private let baseRetryDelay: TimeInterval = 1.0

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        self.session = URLSession.pinned(configuration: config)

        self.jsonEncoder = JSONEncoder()
        self.jsonEncoder.keyEncodingStrategy = .convertToSnakeCase

        self.jsonDecoder = JSONDecoder()
        self.jsonDecoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    // MARK: - Auth Token

    func setAuthToken(_ token: String?) {
        self.authToken = token
    }

    func getAuthToken() -> String? {
        return authToken
    }

    // MARK: - Generic Request

    func request<T: Decodable>(
        _ endpoint: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        queryParams: [String: String]? = nil
    ) async throws -> T {
        let urlRequest = try buildRequest(endpoint, method: method, body: body, queryParams: queryParams)
        let data = try await executeWithRetry(urlRequest)

        do {
            let decoded = try jsonDecoder.decode(T.self, from: data)
            return decoded
        } catch {
            throw APIError.decodingFailed(error)
        }
    }

    // MARK: - API Request (unwraps APIResponse<T>)

    func apiRequest<T: Decodable>(
        _ endpoint: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        queryParams: [String: String]? = nil
    ) async throws -> T {
        let response: APIResponse<T> = try await request(
            endpoint,
            method: method,
            body: body,
            queryParams: queryParams
        )

        guard response.success else {
            throw APIError.apiResponseError(response.error ?? "Unknown API error")
        }

        guard let data = response.data else {
            throw APIError.noData
        }

        return data
    }

    // MARK: - Convenience Methods

    func get<T: Decodable>(_ endpoint: String, queryParams: [String: String]? = nil) async throws -> T {
        var fullEndpoint = endpoint
        if let params = queryParams, !params.isEmpty {
            let queryString = params.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
            fullEndpoint += "?\(queryString)"
        }
        return try await apiRequest(fullEndpoint)
    }

    func post<T: Decodable>(_ endpoint: String, body: [String: Any]) async throws -> T {
        let encodableBody = body.mapValues { AnyCodable($0) }
        return try await apiRequest(endpoint, method: "POST", body: encodableBody)
    }

    func patch<T: Decodable>(_ endpoint: String, body: [String: Any]) async throws -> T {
        let encodableBody = body.mapValues { AnyCodable($0) }
        return try await apiRequest(endpoint, method: "PATCH", body: encodableBody)
    }

    func delete<T: Decodable>(_ endpoint: String) async throws -> T {
        return try await apiRequest(endpoint, method: "DELETE")
    }

    // MARK: - Upload Image as Base64

    func uploadImageBase64(
        _ endpoint: String,
        imageData: Data,
        additionalFields: [String: Any]? = nil
    ) async throws -> [String: Any] {
        guard let token = authToken else {
            throw APIError.noAuthToken
        }

        guard let url = URL(string: APIConfig.baseURL + endpoint) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let base64String = imageData.base64EncodedString()

        var bodyDict: [String: Any] = ["image": base64String]
        if let fields = additionalFields {
            for (key, value) in fields {
                bodyDict[key] = value
            }
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: bodyDict)

        let data = try await executeWithRetry(request)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError.decodingFailed(
                NSError(domain: "NetworkService", code: 0,
                        userInfo: [NSLocalizedDescriptionKey: "Response is not a JSON object"])
            )
        }

        if let success = json["success"] as? Bool, !success {
            let message = json["error"] as? String ?? "Unknown error"
            throw APIError.apiResponseError(message)
        }

        return json
    }

    // MARK: - Multipart Upload

    func uploadMultipart<T: Decodable>(
        _ endpoint: String,
        imageData: Data,
        fileName: String = "image.jpg",
        mimeType: String = "image/jpeg",
        additionalFields: [String: String]? = nil
    ) async throws -> T {
        guard let token = authToken else {
            throw APIError.noAuthToken
        }

        guard let url = URL(string: APIConfig.baseURL + endpoint) else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        var bodyData = Data()

        // Add image field
        bodyData.append("--\(boundary)\r\n".data(using: .utf8)!)
        bodyData.append("Content-Disposition: form-data; name=\"image\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        bodyData.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        bodyData.append(imageData)
        bodyData.append("\r\n".data(using: .utf8)!)

        // Add additional fields
        if let fields = additionalFields {
            for (key, value) in fields {
                bodyData.append("--\(boundary)\r\n".data(using: .utf8)!)
                bodyData.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
                bodyData.append("\(value)\r\n".data(using: .utf8)!)
            }
        }

        bodyData.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = bodyData

        let data = try await executeWithRetry(request)

        do {
            let decoded = try jsonDecoder.decode(T.self, from: data)
            return decoded
        } catch {
            throw APIError.decodingFailed(error)
        }
    }

    // MARK: - Raw Data Request

    func requestData(
        _ endpoint: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        queryParams: [String: String]? = nil
    ) async throws -> Data {
        let urlRequest = try buildRequest(endpoint, method: method, body: body, queryParams: queryParams)
        return try await executeWithRetry(urlRequest)
    }

    // MARK: - Private Helpers

    private func buildRequest(
        _ endpoint: String,
        method: String,
        body: (any Encodable)?,
        queryParams: [String: String]?
    ) throws -> URLRequest {
        guard let token = authToken else {
            throw APIError.noAuthToken
        }

        var urlString = APIConfig.baseURL + endpoint

        if let queryParams = queryParams, !queryParams.isEmpty {
            var components = URLComponents(string: urlString)
            components?.queryItems = queryParams.map { URLQueryItem(name: $0.key, value: $0.value) }
            if let fullURL = components?.string {
                urlString = fullURL
            }
        }

        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body = body {
            do {
                request.httpBody = try jsonEncoder.encode(AnyEncodable(body))
            } catch {
                throw APIError.encodingFailed
            }
        }

        return request
    }

    private func executeWithRetry(_ request: URLRequest, attempt: Int = 0) async throws -> Data {
        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError("Invalid response type")
            }

            switch httpResponse.statusCode {
            case 200...299:
                return data

            case 401:
                throw APIError.httpError(statusCode: 401, message: "Your session has expired. Please sign in again.")

            case 429:
                if attempt < maxRetries {
                    let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After")
                        .flatMap { Double($0) } ?? (baseRetryDelay * pow(2.0, Double(attempt)))
                    try await Task.sleep(nanoseconds: UInt64(retryAfter * 1_000_000_000))
                    return try await executeWithRetry(request, attempt: attempt + 1)
                }
                throw APIError.rateLimited(retryAfter: baseRetryDelay * pow(2.0, Double(attempt)))

            case 500...599:
                if attempt < maxRetries {
                    let delay = baseRetryDelay * pow(2.0, Double(attempt))
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    return try await executeWithRetry(request, attempt: attempt + 1)
                }
                let message = extractErrorMessage(from: data)
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: message)

            default:
                let message = extractErrorMessage(from: data)
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: message)
            }
        } catch let error as APIError {
            throw error
        } catch let error as URLError {
            if error.code == .notConnectedToInternet {
                throw APIError.networkError(NSError(domain: "", code: -1, userInfo: [NSLocalizedDescriptionKey: "No internet connection. Please check your network settings."]))
            }
            if attempt < maxRetries && error.code == .timedOut {
                let delay = baseRetryDelay * pow(2.0, Double(attempt))
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                return try await executeWithRetry(request, attempt: attempt + 1)
            }
            throw APIError.networkError(error)
        } catch {
            throw APIError.networkError(error)
        }
    }

    private func extractErrorMessage(from data: Data) -> String? {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return json["error"] as? String ?? json["message"] as? String
        }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - Offline Data Cache

/// Simple UserDefaults-based cache for offline access to recent feed posts and wardrobe items.
final class OfflineDataCache: @unchecked Sendable {
    static let shared = OfflineDataCache()
    private static let logger = Logger(subsystem: "com.mirrorai", category: "OfflineDataCache")

    private let defaults = UserDefaults.standard
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private let feedPostsKey = "mirror_ai_cached_feed_posts"
    private let wardrobeItemsKey = "mirror_ai_cached_wardrobe_items"
    private let feedTimestampKey = "mirror_ai_cached_feed_ts"
    private let wardrobeTimestampKey = "mirror_ai_cached_wardrobe_ts"

    private init() {
        encoder.keyEncodingStrategy = .convertToSnakeCase
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    // MARK: - Feed Posts

    func cacheFeedPosts(_ posts: [SocialPostModel]) {
        do {
            let data = try encoder.encode(posts)
            defaults.set(data, forKey: feedPostsKey)
            defaults.set(Date().timeIntervalSince1970, forKey: feedTimestampKey)
            Self.logger.info("Cached \(posts.count) feed posts for offline access")
        } catch {
            Self.logger.error("Failed to cache feed posts: \(error.localizedDescription)")
        }
    }

    func loadCachedFeedPosts() -> (posts: [SocialPostModel], isCached: Bool)? {
        guard let data = defaults.data(forKey: feedPostsKey) else { return nil }
        do {
            let posts = try decoder.decode([SocialPostModel].self, from: data)
            Self.logger.info("Loaded \(posts.count) cached feed posts")
            return (posts, true)
        } catch {
            Self.logger.error("Failed to decode cached feed posts: \(error.localizedDescription)")
            return nil
        }
    }

    var feedCacheAge: TimeInterval? {
        let ts = defaults.double(forKey: feedTimestampKey)
        guard ts > 0 else { return nil }
        return Date().timeIntervalSince1970 - ts
    }

    // MARK: - Wardrobe Items

    func cacheWardrobeItems(_ items: [WardrobeItemModel]) {
        do {
            let data = try encoder.encode(items)
            defaults.set(data, forKey: wardrobeItemsKey)
            defaults.set(Date().timeIntervalSince1970, forKey: wardrobeTimestampKey)
            Self.logger.info("Cached \(items.count) wardrobe items for offline access")
        } catch {
            Self.logger.error("Failed to cache wardrobe items: \(error.localizedDescription)")
        }
    }

    func loadCachedWardrobeItems() -> (items: [WardrobeItemModel], isCached: Bool)? {
        guard let data = defaults.data(forKey: wardrobeItemsKey) else { return nil }
        do {
            let items = try decoder.decode([WardrobeItemModel].self, from: data)
            Self.logger.info("Loaded \(items.count) cached wardrobe items")
            return (items, true)
        } catch {
            Self.logger.error("Failed to decode cached wardrobe items: \(error.localizedDescription)")
            return nil
        }
    }

    var wardrobeCacheAge: TimeInterval? {
        let ts = defaults.double(forKey: wardrobeTimestampKey)
        guard ts > 0 else { return nil }
        return Date().timeIntervalSince1970 - ts
    }

    // MARK: - Clear

    func clearAll() {
        defaults.removeObject(forKey: feedPostsKey)
        defaults.removeObject(forKey: wardrobeItemsKey)
        defaults.removeObject(forKey: feedTimestampKey)
        defaults.removeObject(forKey: wardrobeTimestampKey)
        Self.logger.info("Cleared all offline caches")
    }
}

// MARK: - AnyEncodable Wrapper

private struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void

    init(_ wrapped: any Encodable) {
        _encode = { encoder in
            try wrapped.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
