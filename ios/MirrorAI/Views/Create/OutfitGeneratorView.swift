import SwiftUI

struct OutfitGeneratorView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedOccasion: String?
    @State private var selectedSeason: String?
    @State private var selectedMood: String?
    @State private var isGenerating = false
    @State private var generatedOutfit: OutfitSuggestionModel?
    @State private var showResult = false
    @State private var pulseAnimation = false
    @State private var showError = false
    @State private var errorMessage = ""

    private let occasions = [
        ("briefcase.fill", "Work"),
        ("figure.walk", "Casual"),
        ("wineglass.fill", "Date Night"),
        ("party.popper.fill", "Party"),
        ("sportscourt.fill", "Sport"),
        ("building.columns.fill", "Formal"),
        ("airplane", "Travel"),
        ("house.fill", "Lounge"),
    ]

    private let seasons = [
        ("sun.max.fill", "Summer", Color.orange),
        ("leaf.fill", "Autumn", Color(hex: "CD7F32")),
        ("snowflake", "Winter", Color.cyan),
        ("flower.fill", "Spring", Color.green),
    ]

    private let moods = [
        "Confident", "Relaxed", "Bold", "Minimal", "Creative", "Elegant"
    ]

    var body: some View {
        NavigationStack {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 28) {
                    // Header illustration
                    headerSection

                    // Occasion picker
                    occasionSection

                    // Season picker
                    seasonSection

                    // Mood picker
                    moodSection

                    // Generate button
                    generateButton
                        .padding(.horizontal, 20)

                    // Wardrobe count info
                    wardrobeInfo
                        .padding(.horizontal, 20)
                }
                .padding(.bottom, 40)
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Generate Outfit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationDestination(isPresented: $showResult) {
                if let outfit = generatedOutfit {
                    OutfitResultView(outfit: outfit)
                }
            }
            .overlay {
                if isGenerating {
                    generatingOverlay
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        ZStack {
            // Animated gradient blob
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            MirrorTheme.purple.opacity(0.3),
                            MirrorTheme.pink.opacity(0.1),
                            Color.clear
                        ],
                        center: .center,
                        startRadius: 20,
                        endRadius: 120
                    )
                )
                .frame(width: 200, height: 200)
                .scaleEffect(pulseAnimation ? 1.1 : 0.9)
                .animation(.easeInOut(duration: 2).repeatForever(autoreverses: true), value: pulseAnimation)

            VStack(spacing: 8) {
                Image(systemName: "wand.and.stars")
                    .font(.system(size: 44))
                    .foregroundStyle(MirrorTheme.gradientPrimary)
                    .symbolEffect(.variableColor, options: .repeating.speed(0.3))

                Text("AI Outfit Generator")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 12)
        .onAppear {
            pulseAnimation = true
        }
    }

    // MARK: - Occasion Section

    private var occasionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("What's the Occasion?", icon: "calendar")

            LazyVGrid(columns: [
                GridItem(.flexible(), spacing: 10),
                GridItem(.flexible(), spacing: 10),
                GridItem(.flexible(), spacing: 10),
                GridItem(.flexible(), spacing: 10),
            ], spacing: 10) {
                ForEach(occasions, id: \.1) { icon, name in
                    occasionChip(icon: icon, name: name)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private func occasionChip(icon: String, name: String) -> some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            withAnimation(.spring(response: 0.3)) {
                selectedOccasion = selectedOccasion == name ? nil : name
            }
        } label: {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundStyle(
                        selectedOccasion == name
                            ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                            : AnyShapeStyle(Color.secondary)
                    )

                Text(name)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(selectedOccasion == name ? .primary : .secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(
                        selectedOccasion == name
                            ? MirrorTheme.purple.opacity(0.12)
                            : MirrorTheme.surfaceColor
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(
                                selectedOccasion == name
                                    ? MirrorTheme.purple.opacity(0.5)
                                    : MirrorTheme.borderColor,
                                lineWidth: selectedOccasion == name ? 1.5 : 1
                            )
                    )
            )
            .scaleEffect(selectedOccasion == name ? 1.02 : 1.0)
        }
    }

    // MARK: - Season Section

    private var seasonSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Season", icon: "cloud.sun.fill")

            HStack(spacing: 10) {
                ForEach(seasons, id: \.1) { icon, name, color in
                    seasonChip(icon: icon, name: name, color: color)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private func seasonChip(icon: String, name: String, color: Color) -> some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            withAnimation(.spring(response: 0.3)) {
                selectedSeason = selectedSeason == name ? nil : name
            }
        } label: {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundStyle(selectedSeason == name ? color : .secondary)

                Text(name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(selectedSeason == name ? .primary : .secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(
                        selectedSeason == name
                            ? color.opacity(0.1)
                            : MirrorTheme.surfaceColor
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(
                                selectedSeason == name
                                    ? color.opacity(0.5)
                                    : MirrorTheme.borderColor,
                                lineWidth: selectedSeason == name ? 1.5 : 1
                            )
                    )
            )
            .scaleEffect(selectedSeason == name ? 1.04 : 1.0)
        }
    }

    // MARK: - Mood Section

    private var moodSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Mood", icon: "face.smiling.fill")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(moods, id: \.self) { mood in
                        Button {
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred()
                            withAnimation(.spring(response: 0.3)) {
                                selectedMood = selectedMood == mood ? nil : mood
                            }
                        } label: {
                            Text(mood)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(selectedMood == mood ? .white : .secondary)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 10)
                                .background(
                                    Capsule()
                                        .fill(
                                            selectedMood == mood
                                                ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                                                : AnyShapeStyle(MirrorTheme.surfaceColor)
                                        )
                                        .overlay(
                                            Capsule()
                                                .strokeBorder(
                                                    selectedMood == mood
                                                        ? Color.clear
                                                        : MirrorTheme.borderColor,
                                                    lineWidth: 1
                                                )
                                        )
                                )
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    // MARK: - Generate Button

    private var generateButton: some View {
        Button {
            generate()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.system(size: 18))

                Text("Generate Outfit")
                    .font(.system(size: 18, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(
                RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                    .fill(
                        selectedOccasion != nil
                            ? AnyShapeStyle(MirrorTheme.gradientPrimary)
                            : AnyShapeStyle(Color.gray.opacity(0.3))
                    )
            )
            .shadow(
                color: selectedOccasion != nil ? MirrorTheme.purple.opacity(0.4) : Color.clear,
                radius: 16,
                y: 8
            )
        }
        .disabled(selectedOccasion == nil || isGenerating)
    }

    // MARK: - Wardrobe Info

    private var wardrobeInfo: some View {
        HStack(spacing: 8) {
            Image(systemName: "tshirt.fill")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)

            Text("\(appState.wardrobeItems.count) items in your wardrobe")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)

            Spacer()
        }
    }

    // MARK: - Generating Overlay

    private var generatingOverlay: some View {
        ZStack {
            Color.black.opacity(0.6)
                .ignoresSafeArea()

            GlassCard {
                VStack(spacing: 20) {
                    ZStack {
                        Circle()
                            .fill(MirrorTheme.purple.opacity(0.15))
                            .frame(width: 80, height: 80)

                        Image(systemName: "wand.and.stars")
                            .font(.system(size: 36))
                            .foregroundStyle(MirrorTheme.gradientPrimary)
                            .symbolEffect(.variableColor, options: .repeating)
                    }

                    Text("Creating your look...")
                        .font(.system(size: 18, weight: .bold))

                    Text("Our AI is styling the perfect outfit")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    ProgressView()
                        .tint(MirrorTheme.purple)
                }
                .frame(maxWidth: 280)
            }
            .transition(.scale.combined(with: .opacity))
        }
        .transition(.opacity)
    }

    // MARK: - Section Header

    private func sectionHeader(_ title: String, icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(MirrorTheme.purple)

            Text(title)
                .font(.system(size: 16, weight: .bold))
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Generate Action

    private func generate() {
        guard let occasion = selectedOccasion else { return }

        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred()

        withAnimation(.spring(response: 0.3)) {
            isGenerating = true
        }

        Task {
            let result = await appState.generateOutfit(
                occasion: occasion,
                weather: selectedSeason?.lowercased(),
                mood: selectedMood?.lowercased()
            )

            withAnimation(.spring(response: 0.3)) {
                isGenerating = false
            }

            if let outfit = result {
                generatedOutfit = outfit
                let notification = UINotificationFeedbackGenerator()
                notification.notificationOccurred(.success)

                // Small delay for visual transition
                try? await Task.sleep(for: .milliseconds(200))
                showResult = true
            } else {
                let notification = UINotificationFeedbackGenerator()
                notification.notificationOccurred(.error)
                errorMessage = "Failed to generate outfit. Please try again."
                showError = true
            }
        }
    }
}
