import SwiftUI

struct AddItemView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedImage: UIImage?
    @State private var showImagePicker = false
    @State private var imageSourceType: UIImagePickerController.SourceType = .camera

    // AI-populated fields
    @State private var itemName = ""
    @State private var category = ""
    @State private var color = ""
    @State private var brand = ""
    @State private var selectedSeasons: Set<String> = []
    @State private var selectedOccasions: Set<String> = []

    @State private var isAnalyzing = false
    @State private var isSaving = false
    @State private var showSourcePicker = false

    private let allSeasons = ["Spring", "Summer", "Fall", "Winter"]
    private let allOccasions = ["Casual", "Work", "Formal", "Date Night", "Party", "Sports", "Beach"]
    private let allCategories = ["Tops", "Bottoms", "Dresses", "Outerwear", "Shoes", "Accessories"]

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    // Photo section
                    photoSection

                    if selectedImage != nil && !isAnalyzing {
                        // Item details
                        detailsSection

                        // Seasons
                        seasonsSection

                        // Occasions
                        occasionsSection

                        // Save button
                        saveButton
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Add Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
            .confirmationDialog("Choose Photo Source", isPresented: $showSourcePicker) {
                Button("Camera") {
                    imageSourceType = .camera
                    showImagePicker = true
                }
                Button("Photo Library") {
                    imageSourceType = .photoLibrary
                    showImagePicker = true
                }
                Button("Cancel", role: .cancel) { }
            }
            .sheet(isPresented: $showImagePicker) {
                ImagePicker(image: $selectedImage, sourceType: imageSourceType)
            }
            .onChange(of: selectedImage) { _, newImage in
                if newImage != nil {
                    analyzeImage()
                }
            }
        }
    }

    // MARK: - Photo Section

    private var photoSection: some View {
        ZStack {
            if let selectedImage {
                ZStack {
                    Image(uiImage: selectedImage)
                        .resizable()
                        .scaledToFill()
                        .frame(height: 300)
                        .clipShape(RoundedRectangle(cornerRadius: 20))

                    if isAnalyzing {
                        RoundedRectangle(cornerRadius: 20)
                            .fill(.ultraThinMaterial)
                            .frame(height: 300)

                        VStack(spacing: 16) {
                            ProgressView()
                                .controlSize(.large)
                                .tint(MirrorTheme.purple)

                            Text("Analyzing...")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(MirrorTheme.gradientPrimary)

                            Text("Identifying garment details")
                                .font(.system(size: 13))
                                .foregroundStyle(.secondary)
                        }
                    }

                    // Retake button
                    if !isAnalyzing {
                        VStack {
                            HStack {
                                Spacer()
                                Button {
                                    showSourcePicker = true
                                } label: {
                                    Image(systemName: "arrow.triangle.2.circlepath.camera.fill")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .padding(10)
                                        .background(
                                            Circle()
                                                .fill(.ultraThinMaterial)
                                        )
                                }
                                .padding(12)
                            }
                            Spacer()
                        }
                    }
                }
                .frame(height: 300)
            } else {
                Button {
                    showSourcePicker = true
                } label: {
                    VStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(MirrorTheme.purple.opacity(0.12))
                                .frame(width: 80, height: 80)

                            Image(systemName: "camera.fill")
                                .font(.system(size: 32))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                        }

                        VStack(spacing: 4) {
                            Text("Add a Photo")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(.primary)

                            Text("Take a photo or choose from library")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 260)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(MirrorTheme.surfaceColor)
                            .overlay(
                                RoundedRectangle(cornerRadius: 20)
                                    .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [8]))
                                    .foregroundStyle(MirrorTheme.borderColor)
                            )
                    )
                }
            }
        }
    }

    // MARK: - Details Section

    private var detailsSection: some View {
        VStack(spacing: 16) {
            Text("Item Details")
                .font(.system(size: 18, weight: .bold))
                .frame(maxWidth: .infinity, alignment: .leading)

            // Name
            fieldRow(title: "Name", text: $itemName, placeholder: "Item name")

            // Category picker
            VStack(alignment: .leading, spacing: 8) {
                Text("Category")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(allCategories, id: \.self) { cat in
                            Button {
                                let impactFeedback = UIImpactFeedbackGenerator(style: .light)
                                impactFeedback.impactOccurred()
                                category = cat
                            } label: {
                                Text(cat)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(category == cat ? .white : .primary)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(
                                        Capsule()
                                            .fill(category == cat ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(MirrorTheme.surfaceColor))
                                    )
                            }
                        }
                    }
                }
            }

            // Color
            fieldRow(title: "Color", text: $color, placeholder: "Color")

            // Brand
            fieldRow(title: "Brand", text: $brand, placeholder: "Brand (optional)")
        }
    }

    private func fieldRow(title: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.secondary)

            TextField(placeholder, text: text)
                .font(.system(size: 16))
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(UIColor.secondarySystemBackground))
                )
        }
    }

    // MARK: - Seasons Section

    private var seasonsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Seasons")
                .font(.system(size: 18, weight: .bold))

            HStack(spacing: 10) {
                ForEach(allSeasons, id: \.self) { season in
                    Button {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
                        impactFeedback.impactOccurred()
                        if selectedSeasons.contains(season) {
                            selectedSeasons.remove(season)
                        } else {
                            selectedSeasons.insert(season)
                        }
                    } label: {
                        Text(season)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(selectedSeasons.contains(season) ? .white : .primary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .fill(selectedSeasons.contains(season) ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(MirrorTheme.surfaceColor))
                                    .overlay(
                                        Capsule()
                                            .strokeBorder(selectedSeasons.contains(season) ? Color.clear : MirrorTheme.borderColor, lineWidth: 1)
                                    )
                            )
                    }
                }
            }
        }
    }

    // MARK: - Occasions Section

    private var occasionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Occasions")
                .font(.system(size: 18, weight: .bold))

            FlowLayout(spacing: 10) {
                ForEach(allOccasions, id: \.self) { occasion in
                    Button {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
                        impactFeedback.impactOccurred()
                        if selectedOccasions.contains(occasion) {
                            selectedOccasions.remove(occasion)
                        } else {
                            selectedOccasions.insert(occasion)
                        }
                    } label: {
                        Text(occasion)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(selectedOccasions.contains(occasion) ? .white : .primary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .fill(selectedOccasions.contains(occasion) ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(MirrorTheme.surfaceColor))
                                    .overlay(
                                        Capsule()
                                            .strokeBorder(selectedOccasions.contains(occasion) ? Color.clear : MirrorTheme.borderColor, lineWidth: 1)
                                    )
                            )
                    }
                }
            }
        }
    }

    // MARK: - Save Button

    private var saveButton: some View {
        Button {
            saveItem()
        } label: {
            HStack(spacing: 8) {
                if isSaving {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                }

                Text("Save to Wardrobe")
                    .font(.system(size: 17, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                    .fill(canSave ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.gray.opacity(0.3)))
            )
        }
        .disabled(!canSave || isSaving)
    }

    private var canSave: Bool {
        selectedImage != nil && !itemName.isEmpty && !category.isEmpty
    }

    // MARK: - Actions

    private func analyzeImage() {
        guard let image = selectedImage else { return }
        isAnalyzing = true

        Task {
            do {
                let aiService = AIService.shared
                let identification = try await aiService.identifyGarment(image: image)

                withAnimation(.spring(response: 0.3)) {
                    itemName = identification.nameSuggestion
                    category = identification.category
                    color = identification.color
                    brand = identification.brandGuess
                    selectedSeasons = Set(identification.season)
                    selectedOccasions = Set(identification.occasions)
                    isAnalyzing = false
                }

                let notificationFeedback = UINotificationFeedbackGenerator()
                notificationFeedback.notificationOccurred(.success)
            } catch {
                isAnalyzing = false
                // Silently fail - user can manually fill fields
            }
        }
    }

    private func saveItem() {
        guard let image = selectedImage else { return }
        isSaving = true

        Task {
            let result = await appState.addWardrobeItem(
                image: image,
                name: itemName,
                category: category
            )

            isSaving = false

            if result != nil {
                let notificationFeedback = UINotificationFeedbackGenerator()
                notificationFeedback.notificationOccurred(.success)
                dismiss()
            }
        }
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if currentX + size.width > maxWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            positions.append(CGPoint(x: currentX, y: currentY))
            lineHeight = max(lineHeight, size.height)
            currentX += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: currentY + lineHeight), positions)
    }
}
