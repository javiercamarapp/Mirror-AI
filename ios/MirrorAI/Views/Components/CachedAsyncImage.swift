import SwiftUI

struct CachedAsyncImage<Placeholder: View>: View {
    let url: URL?
    let placeholder: Placeholder
    let contentMode: ContentMode

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
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
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

            // Shimmer overlay
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

    // MARK: - Error View

    private var errorView: some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 20))
                .foregroundStyle(.secondary)

            Button {
                phase = .empty
                Task { await loadImage() }
            } label: {
                Text("Retry")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(MirrorTheme.purple)
            }
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
            withAnimation(.easeOut(duration: 0.2)) {
                phase = .success(Image(uiImage: cached))
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

            // Cache the image
            ImageCache.shared.set(uiImage, for: url)

            withAnimation(.easeOut(duration: 0.25)) {
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
