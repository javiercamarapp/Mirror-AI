import SwiftUI

struct WardrobeView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var selectedCategory: String? = nil
    @State private var searchText = ""
    @State private var showAddItem = false
    @State private var selectedItem: WardrobeItemModel?
    @State private var animateGrid = false

    private let columns = [
        GridItem(.flexible(), spacing: 14),
        GridItem(.flexible(), spacing: 14)
    ]

    private var categories: [String] {
        let cats = Set(appState.wardrobeItems.map { $0.category })
        return [L10n.wardrobeTitle == "Wardrobe" ? "All" : "All"] + cats.sorted()
    }

    private var filteredItems: [WardrobeItemModel] {
        var items = appState.wardrobeItems

        if let category = selectedCategory, category != "All" {
            items = items.filter { $0.category == category }
        }

        if !searchText.isEmpty {
            items = items.filter {
                $0.name.localizedCaseInsensitiveContains(searchText) ||
                $0.category.localizedCaseInsensitiveContains(searchText) ||
                $0.color.localizedCaseInsensitiveContains(searchText) ||
                ($0.brand ?? "").localizedCaseInsensitiveContains(searchText)
            }
        }

        return items
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if appState.wardrobeItems.isEmpty && !appState.wardrobeLoading {
                emptyState
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 16) {
                        // Search bar
                        searchBar

                        // Category filter pills
                        categoryPills

                        // Item count
                        HStack {
                            Text(L10n.wardrobeItems(filteredItems.count))
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                        .accessibilityLabel("\(filteredItems.count) items in wardrobe")

                        // Grid
                        LazyVGrid(columns: columns, spacing: 14) {
                            ForEach(Array(filteredItems.enumerated()), id: \.element.id) { index, item in
                                wardrobeItemCard(item, index: index)
                                    .onTapGesture {
                                        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
                                        impactFeedback.impactOccurred()
                                        selectedItem = item
                                    }
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 100)
                }
            }

            // Floating add button
            addButton
                .padding(.trailing, 20)
                .padding(.bottom, 20)
        }
        .background(Color(UIColor.systemBackground))
        .navigationTitle(L10n.wardrobeTitle)
        .navigationBarTitleDisplayMode(.large)
        .sheet(isPresented: $showAddItem) {
            AddItemView()
        }
        .sheet(item: $selectedItem) { item in
            ItemDetailView(item: item)
        }
        .refreshable {
            await appState.loadWardrobe()
        }
        .overlay {
            if appState.wardrobeLoading {
                LoadingOverlay(message: L10n.wardrobeLoading)
            }
        }
        .onAppear {
            if reduceMotion {
                animateGrid = true
            } else {
                withAnimation(.easeOut(duration: 0.5).delay(0.1)) {
                    animateGrid = true
                }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility5)
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)

            TextField(L10n.wardrobeSearchPlaceholder, text: $searchText)
                .font(.body)

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel(L10n.a11yClearSearch)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(UIColor.secondarySystemBackground))
        )
    }

    // MARK: - Category Pills

    private var categoryPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(categories, id: \.self) { category in
                    Button {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
                        impactFeedback.impactOccurred()
                        if reduceMotion {
                            selectedCategory = category == "All" ? nil : category
                        } else {
                            withAnimation(.spring(response: 0.3)) {
                                selectedCategory = category == "All" ? nil : category
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            if category != "All" {
                                Text(categoryEmoji(category))
                                    .font(.caption)
                            }

                            Text(category)
                                .font(.caption)
                                .fontWeight(.semibold)
                        }
                        .foregroundStyle(isSelectedCategory(category) ? .white : .primary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .background(
                            Capsule()
                                .fill(isSelectedCategory(category) ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(MirrorTheme.surfaceColor))
                                .overlay(
                                    Capsule()
                                        .strokeBorder(isSelectedCategory(category) ? Color.clear : MirrorTheme.borderColor, lineWidth: 1)
                                )
                        )
                    }
                    .accessibilityLabel(category)
                    .accessibilityAddTraits(isSelectedCategory(category) ? [.isSelected, .isButton] : .isButton)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func isSelectedCategory(_ category: String) -> Bool {
        if category == "All" { return selectedCategory == nil }
        return selectedCategory == category
    }

    private func categoryEmoji(_ category: String) -> String {
        switch category.lowercased() {
        case "tops", "top": return "👕"
        case "bottoms", "bottom", "pants": return "👖"
        case "shoes", "footwear": return "👟"
        case "outerwear", "jackets": return "🧥"
        case "dresses", "dress": return "👗"
        case "accessories": return "👜"
        default: return "🏷️"
        }
    }

    // MARK: - Item Card

    private func wardrobeItemCard(_ item: WardrobeItemModel, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topTrailing) {
                // Image
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(MirrorTheme.surfaceColor)

                    CachedAsyncImage(url: URL(string: item.imageNoBgUrl ?? item.imageUrl)) {
                        Image(systemName: "tshirt.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.tertiary)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .accessibilityLabel(L10n.clothingImage(item.name))
                }
                .frame(height: 180)

                // Favorite indicator
                if item.isFavorite {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.red)
                        .padding(8)
                        .background(
                            Circle()
                                .fill(.ultraThinMaterial)
                        )
                        .padding(8)
                        .accessibilityLabel(L10n.a11yFavorited)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                HStack(spacing: 6) {
                    Text(item.category)
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundStyle(MirrorTheme.purple)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            Capsule()
                                .fill(MirrorTheme.purple.opacity(0.12))
                        )

                    Circle()
                        .fill(colorFromName(item.color))
                        .frame(width: 12, height: 12)
                        .overlay(
                            Circle()
                                .strokeBorder(Color.white.opacity(0.4), lineWidth: 1)
                        )
                        .accessibilityLabel(item.color)
                }
            }
            .padding(.horizontal, 4)
        }
        .opacity(animateGrid ? 1 : 0)
        .offset(y: animateGrid ? 0 : 20)
        .animation(reduceMotion ? nil : .spring(response: 0.4).delay(Double(index) * 0.05), value: animateGrid)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens item details")
    }

    private func colorFromName(_ name: String) -> Color {
        switch name.lowercased() {
        case "black": return .black
        case "white": return .white
        case "red": return .red
        case "blue": return .blue
        case "green": return .green
        case "yellow": return .yellow
        case "orange": return .orange
        case "purple": return .purple
        case "pink": return .pink
        case "brown": return .brown
        case "gray", "grey": return .gray
        case "navy": return Color(hex: "1E3A5F")
        case "beige": return Color(hex: "F5F0DC")
        default: return .gray
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        EmptyStateView(
            icon: "tshirt.fill",
            title: L10n.wardrobeEmptyTitle,
            description: L10n.wardrobeEmptyDescription,
            actionTitle: L10n.wardrobeAddFirstItem
        ) {
            showAddItem = true
        }
    }

    // MARK: - Add Button

    private var addButton: some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
            impactFeedback.impactOccurred()
            showAddItem = true
        } label: {
            ZStack {
                Circle()
                    .fill(MirrorTheme.gradientPrimary)
                    .frame(width: 60, height: 60)
                    .shadow(color: MirrorTheme.purple.opacity(0.4), radius: 12, y: 4)

                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .accessibilityLabel(L10n.a11yAddButton)
        .accessibilityHint("Opens the add clothing item screen")
    }
}
