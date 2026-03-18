import SwiftUI

struct ItemDetailView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let item: WardrobeItemModel

    @State private var showDeleteConfirmation = false
    @State private var isDeleting = false
    @State private var isEditing = false
    @State private var editName: String = ""
    @State private var editCategory: String = ""
    @State private var editColor: String = ""
    @State private var editBrand: String = ""

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    // Hero image
                    heroImage

                    // Item info
                    itemInfo

                    // Tags
                    tagsSection

                    // Wear tracking
                    wearSection

                    // Actions
                    actionsSection

                    // Danger zone
                    deleteSection
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle(item.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    favoriteButton
                }
            }
            .confirmationDialog(
                "Delete Item",
                isPresented: $showDeleteConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    deleteItem()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("Are you sure you want to remove \"\(item.name)\" from your wardrobe? This cannot be undone.")
            }
            .onAppear {
                editName = item.name
                editCategory = item.category
                editColor = item.color
                editBrand = item.brand ?? ""
            }
        }
    }

    // MARK: - Hero Image

    private var heroImage: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 24)
                .fill(MirrorTheme.surfaceColor)

            CachedAsyncImage(url: URL(string: item.imageNoBgUrl ?? item.imageUrl)) {
                Image(systemName: "tshirt.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.tertiary)
            }
            .clipShape(RoundedRectangle(cornerRadius: 24))
        }
        .frame(height: 340)
    }

    // MARK: - Item Info

    private var itemInfo: some View {
        VStack(spacing: 16) {
            if isEditing {
                editFields
            } else {
                displayFields
            }

            Button {
                withAnimation(.spring(response: 0.3)) {
                    if isEditing {
                        // Save edits
                        saveEdits()
                    }
                    isEditing.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isEditing ? "checkmark" : "pencil")
                        .font(.system(size: 13, weight: .semibold))

                    Text(isEditing ? "Save Changes" : "Edit Details")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundStyle(MirrorTheme.purple)
            }
        }
    }

    private var displayFields: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name)
                        .font(.system(size: 24, weight: .bold))

                    HStack(spacing: 8) {
                        Text(item.category)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(MirrorTheme.purple)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(
                                Capsule()
                                    .fill(MirrorTheme.purple.opacity(0.12))
                            )

                        HStack(spacing: 4) {
                            Circle()
                                .fill(colorFromName(item.color))
                                .frame(width: 14, height: 14)
                                .overlay(
                                    Circle()
                                        .strokeBorder(Color.white.opacity(0.3), lineWidth: 1)
                                )
                            Text(item.color)
                                .font(.system(size: 13))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer()
            }

            if let brand = item.brand, !brand.isEmpty {
                HStack {
                    Image(systemName: "tag.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                    Text(brand)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            }
        }
    }

    private var editFields: some View {
        VStack(spacing: 14) {
            editField(title: "Name", text: $editName)
            editField(title: "Category", text: $editCategory)
            editField(title: "Color", text: $editColor)
            editField(title: "Brand", text: $editBrand)
        }
    }

    private func editField(title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            TextField(title, text: text)
                .font(.system(size: 16))
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(UIColor.secondarySystemBackground))
                )
        }
    }

    // MARK: - Tags Section

    private var tagsSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let seasons = item.season, !seasons.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Seasons")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.secondary)

                    HStack(spacing: 8) {
                        ForEach(seasons, id: \.self) { season in
                            Text(season)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(.primary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(
                                    Capsule()
                                        .fill(MirrorTheme.surfaceColor)
                                        .overlay(
                                            Capsule()
                                                .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                                        )
                                )
                        }
                    }
                }
            }

            if let occasions = item.occasions, !occasions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Occasions")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.secondary)

                    FlowLayout(spacing: 8) {
                        ForEach(occasions, id: \.self) { occasion in
                            Text(occasion)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(.primary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(
                                    Capsule()
                                        .fill(MirrorTheme.surfaceColor)
                                        .overlay(
                                            Capsule()
                                                .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                                        )
                                )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Wear Section

    private var wearSection: some View {
        GlassCard {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 16))
                            .foregroundStyle(MirrorTheme.purple)

                        Text("Wear Count")
                            .font(.system(size: 15, weight: .semibold))
                    }

                    HStack(spacing: 4) {
                        Text("\(item.wearCount)")
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .foregroundStyle(MirrorTheme.gradientPrimary)

                        Text("times worn")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    }

                    if let lastWorn = item.lastWorn {
                        Text("Last worn: \(formatDate(lastWorn))")
                            .font(.system(size: 12))
                            .foregroundStyle(.tertiary)
                    }
                }

                Spacer()

                Button {
                    let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                    impactFeedback.impactOccurred()
                    logWear()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 28))

                        Text("Log Wear")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(MirrorTheme.purple.opacity(0.12))
                    )
                }
            }
        }
    }

    // MARK: - Actions Section

    private var actionsSection: some View {
        HStack(spacing: 12) {
            Button {
                // Navigate to VTON with this item
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "person.fill.viewfinder")
                        .font(.system(size: 16))

                    Text("Try On")
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(MirrorTheme.gradientPrimary)
                )
            }

            ShareLink(item: item.name) {
                HStack(spacing: 8) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 16))

                    Text("Share")
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(MirrorTheme.purple)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(MirrorTheme.purple.opacity(0.12))
                )
            }
        }
    }

    // MARK: - Delete Section

    private var deleteSection: some View {
        Button {
            showDeleteConfirmation = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "trash.fill")
                    .font(.system(size: 14))

                Text("Remove from Wardrobe")
                    .font(.system(size: 15, weight: .medium))
            }
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.red.opacity(0.08))
            )
        }
    }

    // MARK: - Favorite Button

    private var favoriteButton: some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            Task {
                await appState.toggleFavorite(item.id)
            }
        } label: {
            Image(systemName: item.isFavorite ? "heart.fill" : "heart")
                .font(.system(size: 18))
                .foregroundStyle(item.isFavorite ? .red : .primary)
                .symbolEffect(.bounce, value: item.isFavorite)
        }
    }

    // MARK: - Helpers

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

    private func formatDate(_ dateString: String) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: dateString) else { return dateString }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter.string(from: date)
    }

    private func logWear() {
        Task {
            await appState.logWear(item.id)
        }
    }

    private func saveEdits() {
        Task {
            await appState.updateProfile([
                // Would need a dedicated update item endpoint
                // For now this is a placeholder
            ])
        }
    }

    private func deleteItem() {
        isDeleting = true
        Task {
            await appState.removeWardrobeItem(item.id)
            let notificationFeedback = UINotificationFeedbackGenerator()
            notificationFeedback.notificationOccurred(.success)
            dismiss()
        }
    }
}
