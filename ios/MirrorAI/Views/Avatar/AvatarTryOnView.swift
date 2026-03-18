import SwiftUI

struct AvatarTryOnView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedItems: Set<String> = []
    @State private var isRendering = false
    @State private var renderResult: String?
    @State private var showGallery = false
    @State private var savedToPhotos = false
    @State private var selectedCategory = "All"

    private let categories = ["All", "Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Accessories"]

    private var filteredItems: [WardrobeItemModel] {
        if selectedCategory == "All" {
            return appState.wardrobeItems
        }
        return appState.wardrobeItems.filter {
            $0.category.localizedCaseInsensitiveContains(selectedCategory)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(UIColor.systemBackground).ignoresSafeArea()

                VStack(spacing: 0) {
                    // Render result or avatar preview
                    previewSection

                    // Category filter
                    categorySelector

                    // Multi-select wardrobe grid
                    wardrobeGrid

                    // Bottom bar
                    bottomBar
                }

                if isRendering {
                    LoadingOverlay(message: "Rendering outfit on avatar...")
                }
            }
            .navigationTitle("Avatar Try-On")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    if !selectedItems.isEmpty {
                        Button("Clear") {
                            withAnimation { selectedItems.removeAll() }
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred()
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(MirrorTheme.purple)
                    }
                }
            }
        }
    }

    // MARK: - Preview

    private var previewSection: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20)
                .fill(MirrorTheme.surfaceColor)
                .frame(height: 220)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                )

            if let renderUrl = renderResult {
                CachedAsyncImage(url: URL(string: renderUrl)) {
                    ProgressView()
                        .tint(MirrorTheme.purple)
                }
                .frame(height: 212)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            } else if let avatarUrl = appState.currentUser?.avatarUrl, !avatarUrl.isEmpty {
                CachedAsyncImage(url: URL(string: avatarUrl)) {
                    avatarPreviewPlaceholder
                }
                .frame(height: 212)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            } else {
                avatarPreviewPlaceholder
            }

            // Selected items overlay
            if !selectedItems.isEmpty && renderResult == nil {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Text("\(selectedItems.count) item\(selectedItems.count == 1 ? "" : "s") selected")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                Capsule()
                                    .fill(MirrorTheme.gradientPrimary)
                            )
                            .padding(12)
                    }
                }
            }

            // Save overlay on rendered result
            if renderResult != nil {
                VStack {
                    HStack {
                        Spacer()

                        HStack(spacing: 8) {
                            Button {
                                saveRenderedImage()
                            } label: {
                                Image(systemName: savedToPhotos ? "checkmark.circle.fill" : "square.and.arrow.down")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 36, height: 36)
                                    .background(Circle().fill(.ultraThinMaterial))
                            }

                            Button {
                                shareRenderedImage()
                            } label: {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 36, height: 36)
                                    .background(Circle().fill(.ultraThinMaterial))
                            }
                        }
                        .padding(10)
                    }
                    Spacer()
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private var avatarPreviewPlaceholder: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.fill")
                .font(.system(size: 40))
                .foregroundStyle(MirrorTheme.gradientPrimary)
            Text("Select items to try on")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Category Selector

    private var categorySelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(categories, id: \.self) { category in
                    Button {
                        let impact = UIImpactFeedbackGenerator(style: .light)
                        impact.impactOccurred()
                        withAnimation(.spring(response: 0.3)) {
                            selectedCategory = category
                        }
                    } label: {
                        Text(category)
                            .font(.system(size: 13, weight: selectedCategory == category ? .bold : .medium))
                            .foregroundStyle(selectedCategory == category ? .white : .secondary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .fill(selectedCategory == category
                                          ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                          : AnyShapeStyle(MirrorTheme.surfaceColor))
                            )
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
        }
    }

    // MARK: - Wardrobe Grid

    private var wardrobeGrid: some View {
        ScrollView(showsIndicators: false) {
            if filteredItems.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "tshirt")
                        .font(.system(size: 32))
                        .foregroundStyle(.tertiary)
                    Text("No items in this category")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
            } else {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10),
                        GridItem(.flexible(), spacing: 10)
                    ],
                    spacing: 10
                ) {
                    ForEach(filteredItems) { item in
                        itemCard(item)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
        }
    }

    private func itemCard(_ item: WardrobeItemModel) -> some View {
        let isSelected = selectedItems.contains(item.id)

        return Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                if isSelected {
                    selectedItems.remove(item.id)
                } else {
                    selectedItems.insert(item.id)
                }
                renderResult = nil
                savedToPhotos = false
            }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(MirrorTheme.surfaceColor)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .strokeBorder(
                                isSelected ? MirrorTheme.purple : Color.clear,
                                lineWidth: 2.5
                            )
                    )

                CachedAsyncImage(url: URL(string: item.imageNoBgUrl ?? item.imageUrl)) {
                    Image(systemName: "tshirt")
                        .font(.system(size: 16))
                        .foregroundStyle(.tertiary)
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))

                if isSelected {
                    VStack {
                        HStack {
                            Spacer()
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 18))
                                .foregroundStyle(MirrorTheme.purple)
                                .background(
                                    Circle()
                                        .fill(Color(UIColor.systemBackground))
                                        .frame(width: 14, height: 14)
                                )
                                .padding(4)
                        }
                        Spacer()
                    }
                }
            }
            .scaleEffect(isSelected ? 0.93 : 1.0)
        }
    }

    // MARK: - Bottom Bar

    private var bottomBar: some View {
        VStack(spacing: 0) {
            Divider()

            Button {
                Task { await renderOutfit() }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "wand.and.stars")
                        .font(.system(size: 18))
                    Text(renderResult != nil ? "Re-Render" : "Render Outfit")
                        .font(.system(size: 17, weight: .bold))

                    if !selectedItems.isEmpty {
                        Text("(\(selectedItems.count))")
                            .font(.system(size: 14))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(selectedItems.isEmpty
                              ? AnyShapeStyle(Color.gray.opacity(0.4))
                              : AnyShapeStyle(MirrorTheme.gradientPrimary))
                )
            }
            .disabled(selectedItems.isEmpty)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(.ultraThinMaterial)
    }

    // MARK: - Render

    private func renderOutfit() async {
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        isRendering = true
        defer { isRendering = false }

        // In production, call AvatarService to render
        try? await Task.sleep(nanoseconds: 2_500_000_000)

        // Simulated result
        renderResult = appState.currentUser?.avatarUrl

        let success = UINotificationFeedbackGenerator()
        success.notificationOccurred(.success)
    }

    private func saveRenderedImage() {
        guard let urlString = renderResult, let url = URL(string: urlString) else { return }
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.impactOccurred()

        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let image = UIImage(data: data) {
                    UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                    withAnimation { savedToPhotos = true }
                    let success = UINotificationFeedbackGenerator()
                    success.notificationOccurred(.success)
                }
            } catch {
                let error = UINotificationFeedbackGenerator()
                error.notificationOccurred(.error)
            }
        }
    }

    private func shareRenderedImage() {
        guard let urlString = renderResult, let url = URL(string: urlString) else { return }
        let activityVC = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = windowScene.windows.first?.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }
}
