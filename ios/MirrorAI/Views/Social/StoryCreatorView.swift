import SwiftUI

struct StoryCreatorView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedImage: UIImage?
    @State private var caption = ""
    @State private var showImagePicker = false
    @State private var showCamera = false
    @State private var isPosting = false
    @State private var imageSourceSelection = false

    var body: some View {
        NavigationStack {
            ZStack {
                // Background
                Color(UIColor.systemBackground)
                    .ignoresSafeArea()

                VStack(spacing: 24) {
                    // Image preview / picker
                    imageSection

                    // Caption input
                    if selectedImage != nil {
                        captionSection
                    }

                    Spacer()

                    // Post button
                    if selectedImage != nil {
                        postButton
                            .padding(.horizontal, 20)
                            .padding(.bottom, 20)
                    }
                }
            }
            .navigationTitle("New Story")
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
            .confirmationDialog("Choose Source", isPresented: $imageSourceSelection) {
                Button("Camera") {
                    showCamera = true
                }
                Button("Photo Library") {
                    showImagePicker = true
                }
                Button("Cancel", role: .cancel) {}
            }
            .overlay {
                if isPosting {
                    LoadingOverlay()
                }
            }
        }
    }

    // MARK: - Image Section

    private var imageSection: some View {
        Group {
            if let image = selectedImage {
                ZStack(alignment: .topTrailing) {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(9/16, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: MirrorTheme.cardRadius))
                        .shadow(color: MirrorTheme.purple.opacity(0.3), radius: 20)
                        .padding(.horizontal, 40)

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
                    .padding(.trailing, 48)
                    .padding(.top, 8)
                }
                .transition(.scale.combined(with: .opacity))
            } else {
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .medium)
                    impact.impactOccurred()
                    imageSourceSelection = true
                } label: {
                    VStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(MirrorTheme.purple.opacity(0.15))
                                .frame(width: 80, height: 80)

                            Image(systemName: "camera.fill")
                                .font(.system(size: 32))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                        }

                        Text("Add a Photo")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.primary)

                        Text("Share your outfit of the day")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 300)
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
                    .padding(.horizontal, 20)
                }
            }
        }
        .padding(.top, 12)
    }

    // MARK: - Caption Section

    private var captionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Caption")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.secondary)

            TextField("Add a caption...", text: $caption, axis: .vertical)
                .font(.system(size: 15))
                .lineLimit(3)
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(MirrorTheme.surfaceColor)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                        )
                )
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Post Button

    private var postButton: some View {
        Button {
            postStory()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16))

                Text("Share Story")
                    .font(.system(size: 17, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                    .fill(MirrorTheme.gradientPrimary)
            )
            .shadow(color: MirrorTheme.purple.opacity(0.4), radius: 12, y: 6)
        }
        .disabled(isPosting)
    }

    // MARK: - Post Story

    private func postStory() {
        guard let image = selectedImage else { return }
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        isPosting = true

        Task {
            // In production, upload image first and get URL
            // For now, convert to base64 data URL as placeholder
            if let imageData = image.jpegData(compressionQuality: 0.8) {
                let base64 = imageData.base64EncodedString()
                let imageUrl = "data:image/jpeg;base64,\(base64.prefix(100))"
                await appState.createStory(
                    imageUrl: imageUrl,
                    caption: caption.isEmpty ? nil : caption
                )
            }

            isPosting = false

            let notification = UINotificationFeedbackGenerator()
            notification.notificationOccurred(.success)

            dismiss()
        }
    }
}
