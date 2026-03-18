import SwiftUI

struct TryOnResultView: View {
    @Environment(\.dismiss) private var dismiss

    let resultImageUrl: String
    let garmentItem: WardrobeItemModel

    @State private var showBeforeAfter = false
    @State private var savedToPhotos = false
    @State private var resultImage: UIImage?
    @State private var scaleEffect: CGFloat = 0.9
    @State private var opacity: Double = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 24) {
                        // Result image
                        resultImageView
                            .scaleEffect(scaleEffect)
                            .opacity(opacity)
                            .onAppear {
                                withAnimation(.spring(response: 0.6, dampingFraction: 0.8)) {
                                    scaleEffect = 1.0
                                    opacity = 1.0
                                }
                            }

                        // Before / After toggle
                        beforeAfterToggle

                        // Garment info
                        garmentInfo

                        // Actions
                        actionButtons
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 40)
                }
            }
            .navigationTitle("Try-On Result")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    // MARK: - Result Image

    private var resultImageView: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20)
                .fill(MirrorTheme.surfaceColor)
                .aspectRatio(3/4, contentMode: .fit)

            if showBeforeAfter {
                // Before: garment only
                CachedAsyncImage(url: URL(string: garmentItem.imageUrl)) {
                    ProgressView()
                        .controlSize(.large)
                        .tint(MirrorTheme.purple)
                }
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .transition(.opacity)
            } else {
                // After: result
                CachedAsyncImage(url: URL(string: resultImageUrl)) {
                    ProgressView()
                        .controlSize(.large)
                        .tint(MirrorTheme.purple)
                }
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .transition(.opacity)
            }

            // Label overlay
            VStack {
                HStack {
                    Text(showBeforeAfter ? "BEFORE" : "AFTER")
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            Capsule()
                                .fill(showBeforeAfter ? Color.gray.opacity(0.7) : MirrorTheme.purple.opacity(0.85))
                        )
                        .padding(12)

                    Spacer()
                }
                Spacer()
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
        )
    }

    // MARK: - Before/After Toggle

    private var beforeAfterToggle: some View {
        HStack(spacing: 0) {
            toggleButton(title: "Result", isActive: !showBeforeAfter) {
                withAnimation(.easeInOut(duration: 0.3)) {
                    showBeforeAfter = false
                }
            }

            toggleButton(title: "Garment", isActive: showBeforeAfter) {
                withAnimation(.easeInOut(duration: 0.3)) {
                    showBeforeAfter = true
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(MirrorTheme.surfaceColor)
        )
    }

    private func toggleButton(title: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            action()
        } label: {
            Text(title)
                .font(.system(size: 14, weight: isActive ? .bold : .medium))
                .foregroundStyle(isActive ? .white : .secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(isActive ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.clear))
                        .padding(3)
                )
        }
    }

    // MARK: - Garment Info

    private var garmentInfo: some View {
        GlassCard {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(MirrorTheme.surfaceColor)
                        .frame(width: 56, height: 56)

                    CachedAsyncImage(url: URL(string: garmentItem.imageUrl)) {
                        Image(systemName: "tshirt")
                            .font(.system(size: 20))
                            .foregroundStyle(.tertiary)
                    }
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(garmentItem.name)
                        .font(.system(size: 15, weight: .semibold))

                    Text(garmentItem.category)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)

                    if let brand = garmentItem.brand, !brand.isEmpty {
                        Text(brand)
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()
            }
        }
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 12) {
            // Save to photos
            Button {
                saveToPhotos()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: savedToPhotos ? "checkmark.circle.fill" : "square.and.arrow.down.fill")
                        .font(.system(size: 16))
                    Text(savedToPhotos ? "Saved!" : "Save to Photos")
                        .font(.system(size: 16, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(savedToPhotos ? AnyShapeStyle(Color.green) : AnyShapeStyle(MirrorTheme.gradientPrimary))
                )
            }
            .disabled(savedToPhotos)

            HStack(spacing: 12) {
                // Share
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    shareResult()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 15))
                        Text("Share")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(MirrorTheme.purple)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.purple.opacity(0.12))
                            .overlay(
                                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                    .strokeBorder(MirrorTheme.purple.opacity(0.3), lineWidth: 1)
                            )
                    )
                }

                // Try another
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    dismiss()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 15))
                        Text("Try Another")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(
                        RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                            .fill(MirrorTheme.surfaceColor)
                            .overlay(
                                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                    .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                            )
                    )
                }
            }
        }
    }

    // MARK: - Helpers

    private func saveToPhotos() {
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.impactOccurred()

        Task {
            guard let url = URL(string: resultImageUrl) else { return }
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let image = UIImage(data: data) {
                    UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                    withAnimation {
                        savedToPhotos = true
                    }
                    let success = UINotificationFeedbackGenerator()
                    success.notificationOccurred(.success)
                }
            } catch {
                let error = UINotificationFeedbackGenerator()
                error.notificationOccurred(.error)
            }
        }
    }

    private func shareResult() {
        guard let url = URL(string: resultImageUrl) else { return }
        let activityVC = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = windowScene.windows.first?.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }
}
