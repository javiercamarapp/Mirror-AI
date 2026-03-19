import SwiftUI

struct EditProfileView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var gender = ""
    @State private var stylePreferences: [String] = []
    @State private var avatarImage: UIImage?
    @State private var bodyImage: UIImage?
    @State private var showAvatarPicker = false
    @State private var showBodyPicker = false
    @State private var pickerSource: UIImagePickerController.SourceType = .photoLibrary
    @State private var isSaving = false
    @State private var showSourceSheet = false
    @State private var pendingPickerType: PickerType = .avatar

    private enum PickerType { case avatar, body }

    private let genderOptions = ["Male", "Female", "Non-binary", "Prefer not to say"]
    private let styleOptions = [
        "Casual", "Streetwear", "Minimalist", "Bohemian", "Classic",
        "Sporty", "Elegant", "Vintage", "Preppy", "Avant-garde"
    ]

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 28) {
                    // Avatar picker
                    avatarSection

                    // Name field
                    nameSection

                    // Body photo
                    bodyPhotoSection

                    // Gender picker
                    genderSection

                    // Style preferences
                    stylePreferencesSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await saveProfile() }
                    } label: {
                        if isSaving {
                            ProgressView()
                                .controlSize(.small)
                                .tint(MirrorTheme.purple)
                        } else {
                            Text("Save")
                                .fontWeight(.bold)
                                .foregroundStyle(MirrorTheme.purple)
                        }
                    }
                    .disabled(isSaving)
                }
            }
            .onAppear { loadCurrentValues() }
            .sheet(isPresented: $showAvatarPicker) {
                ImagePicker(image: $avatarImage, sourceType: pickerSource)
            }
            .sheet(isPresented: $showBodyPicker) {
                ImagePicker(image: $bodyImage, sourceType: pickerSource)
            }
            .confirmationDialog("Choose Source", isPresented: $showSourceSheet) {
                Button("Camera") {
                    pickerSource = .camera
                    presentPicker()
                }
                Button("Photo Library") {
                    pickerSource = .photoLibrary
                    presentPicker()
                }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    // MARK: - Avatar Section

    private var avatarSection: some View {
        VStack(spacing: 12) {
            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
                pendingPickerType = .avatar
                showSourceSheet = true
            } label: {
                ZStack(alignment: .bottomTrailing) {
                    ZStack {
                        Circle()
                            .fill(MirrorTheme.surfaceColor)
                            .frame(width: 100, height: 100)

                        if let avatarImage {
                            Image(uiImage: avatarImage)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 100, height: 100)
                                .clipShape(Circle())
                        } else if let url = appState.currentUser?.avatarUrl, !url.isEmpty {
                            CachedAsyncImage(url: URL(string: url)) {
                                Image(systemName: "person.fill")
                                    .font(.system(size: 32))
                                    .foregroundStyle(.tertiary)
                            }
                            .frame(width: 100, height: 100)
                            .clipShape(Circle())
                        } else {
                            Image(systemName: "person.fill")
                                .font(.system(size: 32))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                        }
                    }

                    ZStack {
                        Circle()
                            .fill(Color(UIColor.systemBackground))
                            .frame(width: 32, height: 32)

                        Image(systemName: "camera.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(MirrorTheme.gradientPrimary))
                    }
                }
            }

            Text("Change Photo")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(MirrorTheme.purple)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Profile photo")
        .accessibilityHint("Double tap to change your profile photo")
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Name

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Display Name")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.secondary)

            TextField("Your name", text: $name)
                .font(.system(size: 16))
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(MirrorTheme.surfaceColor)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                        )
                )
                .accessibilityLabel("Display name")
                .accessibilityHint("Enter your display name")
        }
    }

    // MARK: - Body Photo

    private var bodyPhotoSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Body Photo")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.secondary)

            Text("Used for virtual try-on and avatar generation")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
                pendingPickerType = .body
                showSourceSheet = true
            } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(MirrorTheme.surfaceColor)
                        .frame(height: 160)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .strokeBorder(MirrorTheme.borderColor, style: StrokeStyle(lineWidth: 1, dash: [6]))
                        )

                    if let bodyImage {
                        Image(uiImage: bodyImage)
                            .resizable()
                            .scaledToFill()
                            .frame(height: 160)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    } else if let url = appState.currentUser?.bodyPhotoUrl, !url.isEmpty {
                        CachedAsyncImage(url: URL(string: url)) {
                            uploadPrompt
                        }
                        .frame(height: 160)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    } else {
                        uploadPrompt
                    }
                }
            }
            .accessibilityLabel("Body photo for virtual try-on")
            .accessibilityHint("Double tap to upload a body photo")
            .accessibilityAddTraits(.isButton)
        }
    }

    private var uploadPrompt: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.crop.rectangle")
                .font(.system(size: 30))
                .foregroundStyle(MirrorTheme.gradientPrimary)

            Text("Tap to upload")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Gender

    private var genderSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Gender")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                ForEach(genderOptions, id: \.self) { option in
                    Button {
                        let impact = UIImpactFeedbackGenerator(style: .light)
                        impact.impactOccurred()
                        withAnimation(.spring(response: 0.3)) {
                            gender = option
                        }
                    } label: {
                        Text(option)
                            .font(.system(size: 13, weight: gender == option ? .bold : .medium))
                            .foregroundStyle(gender == option ? .white : .secondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .background(
                                Capsule()
                                    .fill(gender == option
                                          ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                          : AnyShapeStyle(MirrorTheme.surfaceColor))
                            )
                    }
                    .accessibilityLabel(option)
                    .accessibilityAddTraits(gender == option ? [.isButton, .isSelected] : .isButton)
                }
            }
        }
    }

    // MARK: - Style Prefs

    private var stylePreferencesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Style Preferences")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.secondary)

            FlowLayout(spacing: 8) {
                ForEach(styleOptions, id: \.self) { style in
                    let isSelected = stylePreferences.contains(style)

                    Button {
                        let impact = UIImpactFeedbackGenerator(style: .light)
                        impact.impactOccurred()
                        withAnimation(.spring(response: 0.3)) {
                            if isSelected {
                                stylePreferences.removeAll { $0 == style }
                            } else {
                                stylePreferences.append(style)
                            }
                        }
                    } label: {
                        Text(style)
                            .font(.system(size: 14, weight: isSelected ? .bold : .medium))
                            .foregroundStyle(isSelected ? .white : .primary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(
                                Capsule()
                                    .fill(isSelected
                                          ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                          : AnyShapeStyle(MirrorTheme.surfaceColor))
                                    .overlay(
                                        Capsule()
                                            .strokeBorder(
                                                isSelected ? Color.clear : MirrorTheme.borderColor,
                                                lineWidth: 1
                                            )
                                    )
                            )
                    }
                    .accessibilityLabel(style)
                    .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
                    .accessibilityHint(isSelected ? "Double tap to deselect" : "Double tap to select")
                }
            }
        }
    }

    // MARK: - Helpers

    private func loadCurrentValues() {
        name = appState.currentUser?.name ?? ""
        gender = appState.currentUser?.gender ?? ""
        stylePreferences = appState.currentUser?.stylePreferences ?? []
    }

    private func presentPicker() {
        switch pendingPickerType {
        case .avatar: showAvatarPicker = true
        case .body: showBodyPicker = true
        }
    }

    private func saveProfile() async {
        isSaving = true
        defer { isSaving = false }

        var updates: [String: Any] = [
            "name": name,
            "gender": gender,
            "style_preferences": stylePreferences
        ]

        // Upload avatar image if changed
        if let avatarImage {
            do {
                let avatarUrl = try await ImageUploadService.shared.uploadImage(avatarImage, bucket: "avatars")
                updates["avatar_url"] = avatarUrl
            } catch {
                appState.errorMessage = "Failed to upload avatar image."
                isSaving = false
                return
            }
        }

        // Upload body photo if changed
        if let bodyImage {
            do {
                let bodyUrl = try await ImageUploadService.shared.uploadImage(bodyImage, bucket: "avatars")
                updates["body_photo_url"] = bodyUrl
            } catch {
                appState.errorMessage = "Failed to upload body photo."
                isSaving = false
                return
            }
        }

        await appState.updateProfile(updates)

        let notification = UINotificationFeedbackGenerator()
        notification.notificationOccurred(.success)
        dismiss()
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = computeLayout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = computeLayout(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func computeLayout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}
