import SwiftUI

struct TryOnHistoryView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedResult: VTONHistoryModel?
    @State private var isFullscreen = false
    @State private var appearAnimation = false

    private let columns = [
        GridItem(.flexible(), spacing: 8),
        GridItem(.flexible(), spacing: 8)
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                if appState.vtonHistory.isEmpty {
                    EmptyStateView(
                        icon: "clock.arrow.circlepath",
                        title: "No History",
                        description: "Your virtual try-on results will appear here."
                    )
                } else {
                    ScrollView(showsIndicators: false) {
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(Array(appState.vtonHistory.enumerated()), id: \.element.id) { index, result in
                                historyCard(result)
                                    .accessibilityElement(children: .combine)
                                    .accessibilityLabel("Try-on result from \(formatDate(result.createdAt)), \(result.creditsUsed) credit\(result.creditsUsed == 1 ? "" : "s") used")
                                    .accessibilityHint("Double tap to view full screen")
                                    .accessibilityAddTraits([.isButton, .isImage])
                                    .opacity(appearAnimation ? 1 : 0)
                                    .scaleEffect(appearAnimation ? 1 : 0.9)
                                    .animation(
                                        .spring(response: 0.5, dampingFraction: 0.8)
                                            .delay(Double(index) * 0.05),
                                        value: appearAnimation
                                    )
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .padding(.bottom, 40)
                    }
                }
            }
            .navigationTitle("Try-On History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .refreshable {
                await appState.loadVTONHistory()
            }
            .fullScreenCover(item: $selectedResult) { result in
                fullscreenResult(result)
            }
            .task {
                withAnimation(.easeOut(duration: 0.3)) {
                    appearAnimation = true
                }
            }
        }
    }

    // MARK: - History Card

    private func historyCard(_ result: VTONHistoryModel) -> some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            selectedResult = result
        } label: {
            VStack(spacing: 0) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(MirrorTheme.surfaceColor)
                        .aspectRatio(3/4, contentMode: .fit)

                    CachedAsyncImage(url: URL(string: result.resultImageUrl)) {
                        VStack(spacing: 8) {
                            Image(systemName: "photo")
                                .font(.system(size: 24))
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                    // Overlay info
                    VStack {
                        Spacer()

                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(formatDate(result.createdAt))
                                    .font(.system(size: 10, weight: .medium))

                                HStack(spacing: 3) {
                                    Image(systemName: "bolt.fill")
                                        .font(.system(size: 9))
                                    Text("\(result.creditsUsed) credit\(result.creditsUsed == 1 ? "" : "s")")
                                        .font(.system(size: 10))
                                }
                            }

                            Spacer()

                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .padding(10)
                        .background(
                            UnevenRoundedRectangle(
                                topLeadingRadius: 0,
                                bottomLeadingRadius: 16,
                                bottomTrailingRadius: 16,
                                topTrailingRadius: 0
                            )
                            .fill(.ultraThinMaterial)
                        )
                    }
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                )
            }
        }
    }

    // MARK: - Fullscreen Result

    private func fullscreenResult(_ result: VTONHistoryModel) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()

            CachedAsyncImage(url: URL(string: result.resultImageUrl), contentMode: .fit) {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
            }
            .ignoresSafeArea()

            // Close button
            VStack {
                HStack {
                    Spacer()

                    Button {
                        selectedResult = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(.white.opacity(0.85))
                            .background(Circle().fill(.black.opacity(0.3)))
                    }
                    .padding(20)
                    .accessibilityLabel("Close full screen view")
                    .accessibilityHint("Returns to the history grid")
                }
                Spacer()
            }

            // Bottom info
            VStack {
                Spacer()

                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(formatDate(result.createdAt))
                            .font(.system(size: 14, weight: .medium))
                        Text("\(result.creditsUsed) credit\(result.creditsUsed == 1 ? "" : "s") used")
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.85))
                    }

                    Spacer()

                    Button {
                        saveToPhotos(url: result.resultImageUrl)
                    } label: {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(.ultraThinMaterial))
                    }
                    .accessibilityLabel("Save to photos")
                    .accessibilityHint("Saves this try-on result to your photo library")
                }
                .foregroundStyle(.white)
                .padding(20)
                .background(
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.6)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            }
        }
    }

    // MARK: - Helpers

    private func formatDate(_ dateString: String) -> String {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = isoFormatter.date(from: dateString) else { return dateString }

        let displayFormatter = DateFormatter()
        displayFormatter.dateStyle = .medium
        displayFormatter.timeStyle = .short
        return displayFormatter.string(from: date)
    }

    private func saveToPhotos(url: String) {
        Task {
            guard let imageUrl = URL(string: url) else { return }
            do {
                let (data, _) = try await URLSession.pinned().data(from: imageUrl)
                if let image = UIImage(data: data) {
                    UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                    let success = UINotificationFeedbackGenerator()
                    success.notificationOccurred(.success)
                }
            } catch {
                let feedback = UINotificationFeedbackGenerator()
                feedback.notificationOccurred(.error)
            }
        }
    }
}
