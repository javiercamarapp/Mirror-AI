import SwiftUI

struct AvatarCustomizerView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedStyle = "realistic"
    @State private var selectedHair = "Natural"
    @State private var selectedSkin = "Medium"
    @State private var selectedBody = "Average"
    @State private var isSaving = false
    @State private var showBeforeAfter = false
    @State private var activeTab = 0

    private let styleOptions: [(id: String, name: String, icon: String)] = [
        ("realistic", "Realistic", "person.fill"),
        ("anime", "Anime", "sparkles"),
        ("cartoon", "Cartoon", "face.smiling.inverse"),
        ("3d", "3D", "cube.fill"),
        ("sketch", "Sketch", "pencil.and.outline")
    ]

    private let hairOptions = ["Natural", "Short", "Long", "Curly", "Wavy", "Braided", "Buzz Cut", "Ponytail"]
    private let skinOptions = ["Light", "Fair", "Medium", "Olive", "Tan", "Brown", "Dark", "Deep"]
    private let bodyOptions = ["Slim", "Athletic", "Average", "Curvy", "Muscular", "Plus Size"]

    private let tabs = ["Style", "Hair", "Skin", "Body"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Preview section
                previewSection

                // Tab selector
                tabSelector

                // Options for current tab
                optionsSection

                Spacer()

                // Save button
                saveButton
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Customize Avatar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            showBeforeAfter.toggle()
                        }
                    } label: {
                        Text(showBeforeAfter ? "After" : "Before")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(MirrorTheme.purple)
                    }
                }
            }
        }
    }

    // MARK: - Preview

    private var previewSection: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 24)
                .fill(MirrorTheme.surfaceColor)
                .frame(height: 280)
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .strokeBorder(MirrorTheme.borderColor, lineWidth: 1)
                )

            if let avatarUrl = appState.currentUser?.avatarUrl, !avatarUrl.isEmpty {
                CachedAsyncImage(url: URL(string: avatarUrl)) {
                    avatarPreviewPlaceholder
                }
                .frame(height: 272)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .opacity(showBeforeAfter ? 0.5 : 1)
            } else {
                avatarPreviewPlaceholder
            }

            // Before/After label
            VStack {
                HStack {
                    Text(showBeforeAfter ? "BEFORE" : "PREVIEW")
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            Capsule()
                                .fill(showBeforeAfter ? Color.gray.opacity(0.7) : MirrorTheme.purple.opacity(0.85))
                        )
                    Spacer()
                }
                .padding(16)
                Spacer()
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private var avatarPreviewPlaceholder: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.fill")
                .font(.system(size: 48))
                .foregroundStyle(MirrorTheme.gradientPrimary)
            Text("Avatar Preview")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Tab Selector

    private var tabSelector: some View {
        HStack(spacing: 0) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    withAnimation(.spring(response: 0.3)) {
                        activeTab = index
                    }
                } label: {
                    VStack(spacing: 6) {
                        Text(tab)
                            .font(.system(size: 14, weight: activeTab == index ? .bold : .medium))
                            .foregroundStyle(activeTab == index ? .primary : .secondary)

                        Rectangle()
                            .fill(activeTab == index
                                  ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                  : AnyShapeStyle(Color.clear))
                            .frame(height: 3)
                            .clipShape(Capsule())
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    // MARK: - Options

    private var optionsSection: some View {
        ScrollView(showsIndicators: false) {
            switch activeTab {
            case 0: styleOptionsGrid
            case 1: chipOptions(options: hairOptions, selected: $selectedHair)
            case 2: chipOptions(options: skinOptions, selected: $selectedSkin)
            case 3: chipOptions(options: bodyOptions, selected: $selectedBody)
            default: EmptyView()
            }
        }
        .padding(.top, 16)
    }

    private var styleOptionsGrid: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: 12),
                GridItem(.flexible(), spacing: 12),
                GridItem(.flexible(), spacing: 12)
            ],
            spacing: 12
        ) {
            ForEach(styleOptions, id: \.id) { style in
                let isSelected = selectedStyle == style.id

                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    withAnimation(.spring(response: 0.3)) {
                        selectedStyle = style.id
                    }
                } label: {
                    VStack(spacing: 10) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 18)
                                .fill(isSelected
                                      ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                      : AnyShapeStyle(MirrorTheme.surfaceColor))
                                .frame(height: 80)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 18)
                                        .strokeBorder(
                                            isSelected ? Color.clear : MirrorTheme.borderColor,
                                            lineWidth: 1
                                        )
                                )

                            Image(systemName: style.icon)
                                .font(.system(size: 28))
                                .foregroundStyle(isSelected ? .white : .secondary)
                        }

                        Text(style.name)
                            .font(.system(size: 13, weight: isSelected ? .bold : .medium))
                            .foregroundStyle(isSelected ? .primary : .secondary)
                    }
                }
                .scaleEffect(isSelected ? 1.02 : 1.0)
            }
        }
        .padding(.horizontal, 20)
    }

    private func chipOptions(options: [String], selected: Binding<String>) -> some View {
        FlowLayout(spacing: 10) {
            ForEach(options, id: \.self) { option in
                let isSelected = selected.wrappedValue == option

                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    withAnimation(.spring(response: 0.3)) {
                        selected.wrappedValue = option
                    }
                } label: {
                    Text(option)
                        .font(.system(size: 15, weight: isSelected ? .bold : .medium))
                        .foregroundStyle(isSelected ? .white : .primary)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
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
            }
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Save Button

    private var saveButton: some View {
        Button {
            Task { await saveCustomization() }
        } label: {
            HStack(spacing: 10) {
                if isSaving {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                } else {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16))
                }
                Text(isSaving ? "Saving..." : "Save Customization")
                    .font(.system(size: 17, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                    .fill(MirrorTheme.gradientPrimary)
            )
        }
        .disabled(isSaving)
        .padding(.horizontal, 20)
        .padding(.bottom, 20)
    }

    // MARK: - Save

    private func saveCustomization() async {
        isSaving = true
        defer { isSaving = false }

        // In production, call AvatarService to save
        try? await Task.sleep(nanoseconds: 1_500_000_000)

        let success = UINotificationFeedbackGenerator()
        success.notificationOccurred(.success)
        dismiss()
    }
}
