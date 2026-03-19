import SwiftUI

struct VirtualTryOnView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedCategory = "All"
    @State private var selectedItem: WardrobeItemModel?
    @State private var isGenerating = false
    @State private var resultImageUrl: String?
    @State private var showResult = false
    @State private var showHistory = false
    @State private var showPaywall = false
    @State private var animateCredits = false
    @State private var showError = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var errorMessage = ""

    private let categories = ["All", "Tops", "Bottoms", "Dresses", "Outerwear", "Shoes"]

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
                    // Credits display
                    creditsBar

                    // Category selector
                    categorySelector

                    // Wardrobe grid
                    if filteredItems.isEmpty {
                        EmptyStateView(
                            icon: "tshirt",
                            title: "No Items",
                            description: "Add items to your wardrobe to try them on virtually."
                        )
                    } else {
                        wardrobeGrid
                    }

                    // Try On button
                    if selectedItem != nil {
                        tryOnButton
                    }
                }

                if isGenerating {
                    LoadingOverlay(message: "Generating your virtual try-on...")
                }
            }
            .navigationTitle("Virtual Try-On")
            .navigationBarTitleDisplayMode(.inline)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showHistory = true
                    } label: {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 16))
                    }
                }
            }
            .sheet(isPresented: $showResult) {
                if let resultUrl = resultImageUrl, let garment = selectedItem {
                    TryOnResultView(
                        resultImageUrl: resultUrl,
                        garmentItem: garment
                    )
                }
            }
            .sheet(isPresented: $showHistory) {
                TryOnHistoryView()
            }
            .sheet(isPresented: $showPaywall) {
                PaywallView()
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
            .task {
                await appState.loadVTONCredits()
            }
        }
    }

    // MARK: - Credits Bar

    private var creditsBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "bolt.circle.fill")
                .font(.system(size: 20))
                .foregroundStyle(MirrorTheme.gradientPrimary)
                .symbolEffect(.bounce, value: animateCredits)

            Text("\(appState.vtonCredits)")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .contentTransition(.numericText())

            Text("credits remaining")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)

            Spacer()

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
                showPaywall = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 13))
                    Text("Get More")
                        .font(.system(size: 13, weight: .bold))
                }
                .foregroundStyle(MirrorTheme.purple)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(
                    Capsule()
                        .fill(MirrorTheme.purple.opacity(0.12))
                )
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundStyle(MirrorTheme.borderColor),
                    alignment: .bottom
                )
        )
    }

    // MARK: - Category Selector

    private var categorySelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(categories, id: \.self) { category in
                    Button {
                        let impact = UIImpactFeedbackGenerator(style: .light)
                        impact.impactOccurred()
                        withAnimation(.spring(response: 0.3)) {
                            selectedCategory = category
                            selectedItem = nil
                        }
                    } label: {
                        Text(category)
                            .font(.system(size: 14, weight: selectedCategory == category ? .bold : .medium))
                            .foregroundStyle(selectedCategory == category ? .white : .secondary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 9)
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
            .padding(.vertical, 12)
        }
    }

    // MARK: - Wardrobe Grid

    private var wardrobeGrid: some View {
        ScrollView(showsIndicators: false) {
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ],
                spacing: 12
            ) {
                ForEach(filteredItems) { item in
                    garmentCard(item)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, selectedItem != nil ? 100 : 40)
        }
    }

    private func garmentCard(_ item: WardrobeItemModel) -> some View {
        let isSelected = selectedItem?.id == item.id

        return Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                selectedItem = isSelected ? nil : item
            }
        } label: {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(MirrorTheme.surfaceColor)
                        .aspectRatio(1, contentMode: .fit)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(
                                    isSelected ? MirrorTheme.purple : Color.clear,
                                    lineWidth: 2.5
                                )
                        )

                    CachedAsyncImage(url: URL(string: item.imageNoBgUrl ?? item.imageUrl)) {
                        Image(systemName: "tshirt")
                            .font(.system(size: 22))
                            .foregroundStyle(.tertiary)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                    if isSelected {
                        VStack {
                            HStack {
                                Spacer()
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 22))
                                    .foregroundStyle(MirrorTheme.purple)
                                    .background(Circle().fill(Color(UIColor.systemBackground)).frame(width: 18, height: 18))
                                    .padding(6)
                            }
                            Spacer()
                        }
                    }
                }
                .scaleEffect(isSelected ? 0.95 : 1.0)

                Text(item.name)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Try On Button

    private var tryOnButton: some View {
        VStack(spacing: 0) {
            Divider()

            Button {
                isGenerating = true
                Task { await performTryOn() }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "person.fill.viewfinder")
                        .font(.system(size: 18))

                    Text("Try On")
                        .font(.system(size: 17, weight: .bold))

                    Text("(1 credit)")
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.7))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(appState.vtonCredits > 0 && !isGenerating
                              ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                              : AnyShapeStyle(Color.gray.opacity(0.4)))
                )
            }
            .disabled(appState.vtonCredits <= 0 || isGenerating)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(.ultraThinMaterial)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Try On

    private func performTryOn() async {
        guard let item = selectedItem else {
            isGenerating = false
            return
        }

        if appState.vtonCredits <= 0 {
            isGenerating = false
            showPaywall = true
            return
        }

        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        defer { isGenerating = false }

        let garmentUrl = item.imageNoBgUrl ?? item.imageUrl
        if let resultUrl = await appState.tryVirtualTryOn(garmentUrl: garmentUrl, category: item.category) {
            resultImageUrl = resultUrl
            withAnimation { animateCredits.toggle() }

            let success = UINotificationFeedbackGenerator()
            success.notificationOccurred(.success)
            showResult = true
        } else {
            let feedback = UINotificationFeedbackGenerator()
            feedback.notificationOccurred(.error)
            errorMessage = "Virtual try-on failed. Please try again."
            showError = true
        }
    }
}
