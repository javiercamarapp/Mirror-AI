import SwiftUI
import CryptoKit

struct CachedAsyncImage<Placeholder: View>: View {
    let url: URL?
    let placeholder: Placeholder
    let contentMode: ContentMode

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: AsyncImagePhase = .empty
    @State private var shimmerPhase: CGFloat = -1

    init(
        url: URL?,
        contentMode: ContentMode = .fill,
        @ViewBuilder placeholder: () -> Placeholder
    ) {
        self.url = url
        self.contentMode = contentMode
        self.placeholder = placeholder()
    }

    var body: some View {
        Group {
            switch phase {
            case .empty:
                shimmerPlaceholder
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.98)))
                    .accessibilityHidden(true)
            case .failure:
                errorView
            @unknown default:
                shimmerPlaceholder
            }
        }
        .task(id: url) {
            await loadImage()
        }
    }

    // MARK: - Shimmer Loading

    private var shimmerPlaceholder: some View {
        ZStack {
            placeholder

            // Shimmer overlay (skip if reduce motion is on)
            if !reduceMotion {
                GeometryReader { geometry in
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0),
                            Color.white.opacity(0.08),
                            Color.white.opacity(0)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: geometry.size.width * 0.6)
                    .offset(x: shimmerPhase * geometry.size.width)
                    .onAppear {
                        withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                            shimmerPhase = 1.5
                        }
                    }
                }
                .clipped()
            }
        }
        .accessibilityHidden(true)
    }

    // MARK: - Error View

    private var errorView: some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 20))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)

            Button {
                phase = .empty
                Task { await loadImage() }
            } label: {
                Text(L10n.retry)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(MirrorTheme.purple)
            }
            .accessibilityLabel(L10n.retry)
            .accessibilityHint("Retries loading the image")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MirrorTheme.surfaceColor)
    }

    // MARK: - Image Loading

    private func loadImage() async {
        guard let url else {
            phase = .failure(URLError(.badURL))
            return
        }

        // Check memory cache
        if let cached = ImageCache.shared.get(for: url) {
            let transition: Animation? = reduceMotion ? nil : .easeOut(duration: 0.2)
            withAnimation(transition) {
                phase = .success(Image(uiImage: cached))
            }
            return
        }

        // Check disk cache (with 24-hour TTL)
        if let diskCached = DiskImageCache.shared.get(for: url, maxAge: 86_400) {
            // Promote to memory cache
            ImageCache.shared.set(diskCached, for: url)
            let transition: Animation? = reduceMotion ? nil : .easeOut(duration: 0.2)
            withAnimation(transition) {
                phase = .success(Image(uiImage: diskCached))
            }
            return
        }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode),
                  let uiImage = UIImage(data: data) else {
                phase = .failure(URLError(.badServerResponse))
                return
            }

            // Cache in memory and disk
            ImageCache.shared.set(uiImage, for: url)
            DiskImageCache.shared.set(data, for: url)

            let transition: Animation? = reduceMotion ? nil : .easeOut(duration: 0.25)
            withAnimation(transition) {
                phase = .success(Image(uiImage: uiImage))
            }
        } catch {
            if !Task.isCancelled {
                phase = .failure(error)
            }
        }
    }
}

// MARK: - Simple In-Memory Cache

final class ImageCache: @unchecked Sendable {
    static let shared = ImageCache()

    private let cache = NSCache<NSURL, UIImage>()

    private init() {
        cache.countLimit = 100
        cache.totalCostLimit = 50 * 1024 * 1024 // 50 MB
    }

    func get(for url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    func set(_ image: UIImage, for url: URL) {
        let cost = image.jpegData(compressionQuality: 1.0)?.count ?? 0
        cache.setObject(image, forKey: url as NSURL, cost: cost)
    }

    func removeAll() {
        cache.removeAllObjects()
    }
}

// MARK: - Disk Image Cache

final class DiskImageCache: @unchecked Sendable {
    static let shared = DiskImageCache()

    private let cacheDirectory: URL
    private let maxDiskCacheSize: Int64 = 200 * 1024 * 1024 // 200 MB
    private let fileManager = FileManager.default
    private let queue = DispatchQueue(label: "com.mirrorai.diskimagecache", qos: .utility)

    private init() {
        let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first!
        cacheDirectory = caches.appendingPathComponent("ImageCache", isDirectory: true)

        // Create cache directory if needed
        try? fileManager.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }

    /// Retrieve an image from the disk cache.
    /// - Parameters:
    ///   - url: The URL used as cache key.
    ///   - maxAge: Maximum age in seconds before the cached entry is considered stale.
    ///            Pass `nil` for no TTL check (default). Pass `86_400` for 24 hours.
    func get(for url: URL, maxAge: TimeInterval? = nil) -> UIImage? {
        let filePath = cacheFilePath(for: url)
        guard fileManager.fileExists(atPath: filePath.path) else { return nil }

        // Check TTL if maxAge is specified
        if let maxAge {
            if let attrs = try? fileManager.attributesOfItem(atPath: filePath.path),
               let creationDate = attrs[.creationDate] as? Date {
                let age = Date().timeIntervalSince(creationDate)
                if age > maxAge {
                    // Cache entry is stale, remove it and return nil to force re-fetch
                    try? fileManager.removeItem(at: filePath)
                    return nil
                }
            }
        }

        // Update access date for LRU tracking
        try? fileManager.setAttributes(
            [.modificationDate: Date()],
            ofItemAtPath: filePath.path
        )

        guard let data = try? Data(contentsOf: filePath),
              let image = UIImage(data: data) else {
            // Remove corrupted cache entry
            try? fileManager.removeItem(at: filePath)
            return nil
        }

        return image
    }

    /// Store image data to the disk cache.
    func set(_ data: Data, for url: URL) {
        let filePath = cacheFilePath(for: url)
        queue.async { [weak self] in
            guard let self else { return }
            try? data.write(to: filePath, options: .atomic)
            self.evictIfNeeded()
        }
    }

    /// Remove all cached files from disk.
    func removeAll() {
        queue.async { [weak self] in
            guard let self else { return }
            try? self.fileManager.removeItem(at: self.cacheDirectory)
            try? self.fileManager.createDirectory(at: self.cacheDirectory, withIntermediateDirectories: true)
        }
    }

    /// Returns the total disk cache size in bytes.
    func totalSize() -> Int64 {
        guard let files = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.fileSizeKey],
            options: .skipsHiddenFiles
        ) else { return 0 }

        return files.reduce(0) { total, fileURL in
            let size = (try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            return total + Int64(size)
        }
    }

    // MARK: - Private Helpers

    /// Creates a cache-safe filename from a URL using SHA-256 hash.
    private func cacheFilePath(for url: URL) -> URL {
        let hash = SHA256.hash(data: Data(url.absoluteString.utf8))
        let hashString = hash.compactMap { String(format: "%02x", $0) }.joined()
        return cacheDirectory.appendingPathComponent(hashString)
    }

    /// Evicts least-recently-used files when cache exceeds the max size.
    private func evictIfNeeded() {
        let currentSize = totalSize()
        guard currentSize > maxDiskCacheSize else { return }

        guard let files = try? fileManager.contentsOfDirectory(
            at: cacheDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
            options: .skipsHiddenFiles
        ) else { return }

        // Sort by modification date (oldest first) for LRU eviction
        let sortedFiles = files.compactMap { url -> (URL, Date, Int64)? in
            guard let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]),
                  let date = values.contentModificationDate,
                  let size = values.fileSize else { return nil }
            return (url, date, Int64(size))
        }.sorted { $0.1 < $1.1 }

        var freedSize: Int64 = 0
        let targetSize = maxDiskCacheSize / 2 // Evict down to 50% to avoid thrashing
        let bytesToFree = currentSize - targetSize

        for (fileURL, _, fileSize) in sortedFiles {
            guard freedSize < bytesToFree else { break }
            try? fileManager.removeItem(at: fileURL)
            freedSize += fileSize
        }
    }
}

// MARK: - Async Image Phase

private enum AsyncImagePhase {
    case empty
    case success(Image)
    case failure(Error)
}

// MARK: - Convenience init without placeholder

extension CachedAsyncImage where Placeholder == EmptyView {
    init(url: URL?, contentMode: ContentMode = .fill) {
        self.url = url
        self.contentMode = contentMode
        self.placeholder = EmptyView()
    }
}
