import SwiftUI

struct PostCreatorView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    var prefilledImageUrl: String? = nil
    var prefilledOccasion: String? = nil

    @State private var selectedImage: UIImage?
    @State private var caption = ""
    @State private var occasionTag = ""
    @State private var showImagePicker = false
    @State private var showCamera = false
    @State private var imageSourceSelection = false
    @State private var isPostingAsPost = false
    @State private var isPostingAsStory = false
    @State private var characterCount = 0

    private let maxCaptionLength = 500

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 24) {
                    // Image preview
                    imageSection

                    // Caption field
                    captionSection

                    // Occasion tag
                    occasionSection

                    Spacer(minLength: 20)

                    // Post buttons
                    actionButtons

                    Spacer(minLength: 40)
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(UIColor.systemBackground))
            .navigationTitle("New Post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundStyle(.secondary)
                }
            }
            .sheet(isPresented: $showImagePicker) {
                ImagePicker(image: $selectedImage, sourceType: .photoLibrary)
            }
            .sheet(isPresented: $showCamera) {
                ImagePicker(image: $selectedImage, sourceType: .camera)
            }
            .confirmationDialog("Choose Photo", isPresented: $imageSourceSelection) {
                Button("Camera") {
                    showCamera = true
                }
                Button("Photo Library") {
                    showImagePicker = true
                }
                Button("Cancel", role: .cancel) {}
            }
            .onAppear {
                if let occasion = prefilledOccasion {
                    occasionTag = occasion
                }
            }
            .overlay {
                if isPostingAsPost || isPostingAsStory {
                    LoadingOverlay()
                }
            }
        }
    }

    // MARK: - Image Section

    private var imageSection: some View {
        Group {
            if let image = selectedImage {
                selectedImagePreview(image)
            } else if let urlStr = prefilledImageUrl, let url = URL(string: urlStr) {
                prefilledImagePreview(url)
            } else {
                imagePlaceholder
            }
        }
    }

    private func selectedImagePreview(_ image: UIImage) -> some View {
        ZStack(alignment: .topTrailing) {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(1, contentMode: .fill)
                .frame(maxWidth: .infinity)
                .frame(height: 340)
                .clipShape(RoundedRectangle(cornerRadius: MirrorTheme.cardRadius))
                .shadow(color: MirrorTheme.purple.opacity(0.2), radius: 16, y: 8)

            Button {
                withAnimation(.spring(response: 0.3)) {
                    selectedImage = nil
                }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.5), radius: 4)
            }
            .padding(12)
        }
        .transition(.scale.combined(with: .opacity))
    }

    private func prefilledImagePreview(_ url: URL) -> some View {
        ZStack(alignment: .bottomTrailing) {
            CachedAsyncImage(url: url) {
                RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                    .fill(MirrorTheme.surfaceColor)
                    .overlay {
                        ProgressView()
                            .tint(MirrorTheme.purple)
                    }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 340)
            .clipShape(RoundedRectangle(cornerRadius: MirrorTheme.cardRadius))
            .shadow(color: MirrorTheme.purple.opacity(0.2), radius: 16, y: 8)

            // Change photo button
            Button {
                imageSourceSelection = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "photo.fill")
                        .font(.system(size: 12))
                    Text("Change")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    Capsule()
                        .fill(.ultraThinMaterial)
                )
            }
            .padding(12)
        }
    }

    private var imagePlaceholder: some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            imageSourceSelection = true
        } label: {
            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(MirrorTheme.purple.opacity(0.12))
                        .frame(width: 72, height: 72)

                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 30))
                        .foregroundStyle(MirrorTheme.gradientPrimary)
                }

                Text("Add Photo")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.primary)

                Text("Choose from library or take a photo")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 260)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                    .fill(.ultraThinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: MirrorTheme.cardRadius)
                            .strokeBorder(
                                MirrorTheme.borderColor,
                                style: StrokeStyle(lineWidth: 2, dash: [10, 8])
                            )
                    )
            )
        }
    }

    // MARK: - Caption Section

    private var captionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Caption")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)

                Spacer()

                Text("\(caption.count)/\(maxCaptionLength)")
                    .font(.system(size: 12))
                    .foregroundStyle(caption.count > maxCaptionLength ? .red : .tertiary)
            }

            TextField("Write a caption...", text: $caption, axis: .vertical)
                .font(.system(size: 15))
                .lineLimit(5)
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(MirrorTheme.surfaceColor)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                        )
                )
                .onChange(of: caption) { _, newValue in
                    if newValue.count > maxCaptionLength {
                        caption = String(newValue.prefix(maxCaptionLength))
                    }
                }
        }
    }

    // MARK: - Occasion Section

    private var occasionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "tag.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(MirrorTheme.purple)

                Text("Occasion Tag")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.secondary)
            }

            let suggestions = ["Work", "Casual", "Date Night", "Party", "Formal", "Sport"]

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(suggestions, id: \.self) { tag in
                        Button {
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred()
                            withAnimation(.spring(response: 0.3)) {
                                occasionTag = occasionTag == tag ? "" : tag
                            }
                        } label: {
                            Text(tag)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(occasionTag == tag ? .white : .secondary)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(
                                    Capsule()
                                        .fill(
                                            occasionTag == tag
                                                ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                                : AnyShapeStyle(MirrorTheme.surfaceColor)
                                        )
                                        .overlay(
                                            Capsule()
                                                .strokeBorder(
                                                    occasionTag == tag
                                                        ? Color.clear
                                                        : MirrorTheme.borderColor,
                                                    lineWidth: 1
                                                )
                                        )
                                )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 12) {
            // Post to Feed
            Button {
                createPost()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "square.grid.2x2.fill")
                        .font(.system(size: 16))

                    Text("Post to Feed")
                        .font(.system(size: 17, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(
                            hasContent
                                ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                : AnyShapeStyle(Color.gray.opacity(0.3))
                        )
                )
                .shadow(
                    color: hasContent ? MirrorTheme.purple.opacity(0.4) : Color.clear,
                    radius: 12,
                    y: 6
                )
            }
            .disabled(!hasContent || isPostingAsPost)

            // Share as Story
            Button {
                createStory()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "circle.dashed")
                        .font(.system(size: 16))

                    Text("Share as Story")
                        .font(.system(size: 17, weight: .bold))
                }
                .foregroundStyle(MirrorTheme.purple)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(MirrorTheme.purple.opacity(0.1))
                        .overlay(
                            RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                                .strokeBorder(MirrorTheme.purple.opacity(0.3), lineWidth: 1.5)
                        )
                )
            }
            .disabled(!hasContent || isPostingAsStory)
        }
    }

    // MARK: - Computed

    private var hasContent: Bool {
        selectedImage != nil || prefilledImageUrl != nil
    }

    // MARK: - Actions

    private func createPost() {
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        isPostingAsPost = true

        Task {
            var imageUrl = prefilledImageUrl

            // Upload selected image if present
            if let image = selectedImage {
                do {
                    imageUrl = try await ImageUploadService.shared.uploadImage(image, bucket: "social")
                } catch {
                    isPostingAsPost = false
                    appState.errorMessage = "Failed to upload image. Please try again."
                    return
                }
            }

            guard let finalImageUrl = imageUrl else {
                isPostingAsPost = false
                appState.errorMessage = "No image to upload."
                return
            }

            await appState.createPost(
                type: "outfit",
                imageUrl: finalImageUrl,
                caption: caption,
                occasion: occasionTag.isEmpty ? nil : occasionTag
            )

            isPostingAsPost = false

            let notification = UINotificationFeedbackGenerator()
            notification.notificationOccurred(.success)

            dismiss()
        }
    }

    private func createStory() {
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        isPostingAsStory = true

        Task {
            var imageUrl = prefilledImageUrl

            // Upload selected image if present
            if let image = selectedImage {
                do {
                    imageUrl = try await ImageUploadService.shared.uploadImage(image, bucket: "social")
                } catch {
                    isPostingAsStory = false
                    appState.errorMessage = "Failed to upload image. Please try again."
                    return
                }
            }

            guard let finalImageUrl = imageUrl else {
                isPostingAsStory = false
                appState.errorMessage = "No image to upload."
                return
            }

            await appState.createStory(
                imageUrl: finalImageUrl,
                caption: caption.isEmpty ? nil : caption
            )

            isPostingAsStory = false

            let notification = UINotificationFeedbackGenerator()
            notification.notificationOccurred(.success)

            dismiss()
        }
    }
}
