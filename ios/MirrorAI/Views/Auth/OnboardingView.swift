import SwiftUI

struct OnboardingView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var currentStep = 0
    @State private var name = ""
    @State private var selectedGender: String?
    @State private var height: Double = 170
    @State private var selectedBodyShape: String?
    @State private var selectedStyles: Set<String> = []
    @State private var selfieImage: UIImage?
    @State private var showImagePicker = false
    @State private var isSaving = false
    @State private var selectedAgeRange: String?
    @State private var showUnderageMessage = false

    private let totalSteps = 6

    var body: some View {
        ZStack {
            AnimatedGradient()
                .ignoresSafeArea()

            Color.black.opacity(0.5)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Step indicator
                stepIndicator
                    .padding(.top, 16)
                    .padding(.horizontal, 32)

                // Content
                TabView(selection: $currentStep) {
                    ageVerificationStep.tag(0)
                    welcomeStep.tag(1)
                    genderStep.tag(2)
                    bodyStep.tag(3)
                    styleStep.tag(4)
                    selfieStep.tag(5)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(reduceMotion ? .none : .smooth(duration: 0.4), value: currentStep)

                // Navigation buttons
                navigationButtons
                    .padding(.horizontal, 32)
                    .padding(.bottom, 40)
            }
        }
        .sheet(isPresented: $showImagePicker) {
            ImagePicker(image: $selfieImage, sourceType: .camera)
        }
        .overlay {
            if isSaving {
                LoadingOverlay(message: "Setting up your profile...")
            }
        }
    }

    // MARK: - Step Indicator

    private var stepIndicator: some View {
        HStack(spacing: 8) {
            ForEach(0..<totalSteps, id: \.self) { step in
                Capsule()
                    .fill(step <= currentStep ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.white.opacity(0.2)))
                    .frame(height: 4)
                    .animation(reduceMotion ? .none : .spring(response: 0.3), value: currentStep)
            }
        }
    }

    // MARK: - Step 0: Age Verification

    private var ageVerificationStep: some View {
        VStack(spacing: 32) {
            Spacer()

            Image(systemName: "person.badge.shield.checkmark.fill")
                .font(.system(size: 60))
                .foregroundStyle(MirrorTheme.gradientPrimary)
                .symbolEffect(.bounce, options: .nonRepeating)

            VStack(spacing: 12) {
                Text("How old are you?")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)

                Text("We need to verify your age to continue")
                    .font(.system(size: 16))
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }

            VStack(spacing: 14) {
                ageOptionCard(label: "18 or older", value: "18+")
                ageOptionCard(label: "13-17", value: "13-17")
                ageOptionCard(label: "Under 13", value: "Under 13")
            }
            .padding(.horizontal, 16)

            if selectedAgeRange == "Under 13" {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(.yellow)

                    Text("Sorry, Mirror AI is not available for users under 13.")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)

                    Text("This is required by law (COPPA) to protect children's privacy.")
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.6))
                        .multilineTextAlignment(.center)
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.red.opacity(0.15))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .strokeBorder(Color.red.opacity(0.3), lineWidth: 1)
                        )
                )
                .padding(.horizontal, 16)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            if selectedAgeRange == "13-17" {
                VStack(spacing: 8) {
                    Image(systemName: "info.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(MirrorTheme.purple)

                    Text("Parental Consent Required")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)

                    Text("By continuing, you confirm that a parent or guardian has given consent for you to use Mirror AI.")
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                }
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(MirrorTheme.purple.opacity(0.1))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .strokeBorder(MirrorTheme.purple.opacity(0.3), lineWidth: 1)
                        )
                )
                .padding(.horizontal, 16)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            Spacer()
            Spacer()
        }
        .padding(.horizontal)
        .animation(reduceMotion ? .none : .easeInOut(duration: 0.3), value: selectedAgeRange)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }

    private func ageOptionCard(label: String, value: String) -> some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            withAnimation(.spring(response: 0.3)) {
                selectedAgeRange = value
            }
        } label: {
            HStack(spacing: 16) {
                Text(label)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)

                Spacer()

                if selectedAgeRange == value {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(.white)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 18)
                    .fill(selectedAgeRange == value ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.white.opacity(0.08)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .strokeBorder(selectedAgeRange == value ? Color.clear : Color.white.opacity(0.12), lineWidth: 1)
                    )
            )
        }
    }

    // MARK: - Step 1: Welcome

    private var welcomeStep: some View {
        VStack(spacing: 32) {
            Spacer()

            Image(systemName: "hand.wave.fill")
                .font(.system(size: 60))
                .foregroundStyle(MirrorTheme.gradientPrimary)
                .symbolEffect(.bounce, options: .nonRepeating)

            VStack(spacing: 12) {
                Text("Welcome to Mirror AI")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)

                Text("Let's personalize your experience.\nWhat should we call you?")
                    .font(.system(size: 16))
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }

            TextField("Your name", text: $name)
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.white)
                .padding()
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.white.opacity(0.1))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .strokeBorder(Color.white.opacity(0.2), lineWidth: 1)
                        )
                )
                .textInputAutocapitalization(.words)
                .padding(.horizontal, 16)

            Spacer()
            Spacer()
        }
        .padding(.horizontal)
    }

    // MARK: - Step 2: Gender

    private var genderStep: some View {
        VStack(spacing: 32) {
            Spacer()

            VStack(spacing: 12) {
                Text("How do you identify?")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)

                Text("This helps us curate better recommendations")
                    .font(.system(size: 16))
                    .foregroundStyle(.white.opacity(0.7))
            }

            VStack(spacing: 14) {
                genderCard(gender: "Male", icon: "figure.stand", description: "Men's fashion")
                genderCard(gender: "Female", icon: "figure.stand.dress", description: "Women's fashion")
                genderCard(gender: "Non-binary", icon: "figure.2", description: "All fashion")
            }
            .padding(.horizontal, 16)

            Spacer()
        }
        .padding(.horizontal)
    }

    private func genderCard(gender: String, icon: String, description: String) -> some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            withAnimation(.spring(response: 0.3)) {
                selectedGender = gender
            }
        } label: {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 28))
                    .foregroundStyle(selectedGender == gender ? .white : MirrorTheme.purple)
                    .frame(width: 44)

                VStack(alignment: .leading, spacing: 2) {
                    Text(gender)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)

                    Text(description)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.6))
                }

                Spacer()

                if selectedGender == gender {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(.white)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 18)
                    .fill(selectedGender == gender ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.white.opacity(0.08)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .strokeBorder(selectedGender == gender ? Color.clear : Color.white.opacity(0.12), lineWidth: 1)
                    )
            )
        }
    }

    // MARK: - Step 3: Body

    private var bodyStep: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 28) {
                VStack(spacing: 12) {
                    Text("Body Information")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Used for accurate try-on and fit recommendations")
                        .font(.system(size: 16))
                        .foregroundStyle(.white.opacity(0.7))
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 32)

                // Height slider
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Height")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)

                        Spacer()

                        Text("\(Int(height)) cm")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(MirrorTheme.purple)
                    }

                    Slider(value: $height, in: 140...220, step: 1)
                        .tint(MirrorTheme.purple)
                        .accessibilityLabel(L10n.a11yHeightSlider)
                        .accessibilityValue(L10n.heightValue(Int(height)))
                }
                .padding(20)
                .background(
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Color.white.opacity(0.08))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18)
                                .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                        )
                )

                // Body shape
                VStack(alignment: .leading, spacing: 14) {
                    Text("Body Shape")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        bodyShapeCard("Rectangle", icon: "rectangle.portrait")
                        bodyShapeCard("Triangle", icon: "triangle")
                        bodyShapeCard("Inverted Triangle", icon: "triangle.fill")
                        bodyShapeCard("Hourglass", icon: "hourglass")
                        bodyShapeCard("Oval", icon: "oval.portrait")
                        bodyShapeCard("Athletic", icon: "figure.run")
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 120)
        }
        .padding(.horizontal)
    }

    private func bodyShapeCard(_ shape: String, icon: String) -> some View {
        Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            withAnimation(.spring(response: 0.3)) {
                selectedBodyShape = shape
            }
        } label: {
            VStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 28))
                    .foregroundStyle(selectedBodyShape == shape ? .white : MirrorTheme.purple)

                Text(shape)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(selectedBodyShape == shape ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.white.opacity(0.08)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(selectedBodyShape == shape ? Color.clear : Color.white.opacity(0.12), lineWidth: 1)
                    )
            )
        }
    }

    // MARK: - Step 4: Style Preferences

    private var styleStep: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 24) {
                VStack(spacing: 12) {
                    Text("Your Style DNA")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Select all that resonate with you")
                        .font(.system(size: 16))
                        .foregroundStyle(.white.opacity(0.7))
                }
                .padding(.top, 32)

                let styles = [
                    ("Casual", "tshirt.fill"),
                    ("Streetwear", "shoe.fill"),
                    ("Minimalist", "square"),
                    ("Bohemian", "leaf.fill"),
                    ("Classic", "briefcase.fill"),
                    ("Sporty", "figure.run"),
                    ("Elegant", "sparkles"),
                    ("Grunge", "guitars.fill"),
                    ("Preppy", "graduationcap.fill"),
                    ("Vintage", "clock.fill"),
                    ("Avant-Garde", "paintbrush.fill"),
                    ("Romantic", "heart.fill")
                ]

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(styles, id: \.0) { style in
                        styleChip(name: style.0, icon: style.1)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 120)
        }
        .padding(.horizontal)
    }

    private func styleChip(name: String, icon: String) -> some View {
        let isSelected = selectedStyles.contains(name)
        return Button {
            let impactFeedback = UIImpactFeedbackGenerator(style: .light)
            impactFeedback.impactOccurred()
            withAnimation(.spring(response: 0.3)) {
                if isSelected {
                    selectedStyles.remove(name)
                } else {
                    selectedStyles.insert(name)
                }
            }
        } label: {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundStyle(isSelected ? .white : MirrorTheme.purple)

                Text(name)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(isSelected ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.white.opacity(0.08)))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(isSelected ? Color.clear : Color.white.opacity(0.12), lineWidth: 1)
                    )
            )
            .scaleEffect(isSelected ? 1.05 : 1.0)
        }
    }

    // MARK: - Step 5: Selfie

    private var selfieStep: some View {
        VStack(spacing: 32) {
            Spacer()

            VStack(spacing: 12) {
                Text("Color Analysis")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)

                Text("Take a selfie to discover your color season\nand get personalized color recommendations")
                    .font(.system(size: 16))
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }

            if let selfieImage {
                Image(uiImage: selfieImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 180, height: 180)
                    .clipShape(Circle())
                    .overlay(
                        Circle()
                            .strokeBorder(
                                MirrorTheme.gradientPrimary,
                                lineWidth: 3
                            )
                    )
                    .shadow(color: MirrorTheme.purple.opacity(0.4), radius: 20)

                Button {
                    showImagePicker = true
                } label: {
                    Text("Retake")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(MirrorTheme.purple)
                }
            } else {
                Button {
                    showImagePicker = true
                } label: {
                    VStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(Color.white.opacity(0.08))
                                .frame(width: 120, height: 120)

                            Image(systemName: "camera.fill")
                                .font(.system(size: 40))
                                .foregroundStyle(MirrorTheme.gradientPrimary)
                        }

                        Text("Take a Selfie")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }

                Button("Skip for now") {
                    // Allow skipping
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.5))
            }

            Spacer()
            Spacer()
        }
        .padding(.horizontal)
    }

    // MARK: - Navigation Buttons

    private var navigationButtons: some View {
        HStack(spacing: 16) {
            if currentStep > 0 {
                Button {
                    let impactFeedback = UIImpactFeedbackGenerator(style: .light)
                    impactFeedback.impactOccurred()
                    withAnimation { currentStep -= 1 }
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 54, height: 54)
                        .background(
                            Circle()
                                .fill(Color.white.opacity(0.12))
                        )
                }
            }

            Button {
                let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                impactFeedback.impactOccurred()

                if currentStep < totalSteps - 1 {
                    withAnimation { currentStep += 1 }
                } else {
                    saveOnboarding()
                }
            } label: {
                HStack(spacing: 8) {
                    Text(currentStep == totalSteps - 1 ? "Get Started" : "Next")
                        .font(.system(size: 17, weight: .bold))

                    if currentStep < totalSteps - 1 {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 15, weight: .bold))
                    }
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: MirrorTheme.buttonRadius)
                        .fill(canProceed ? AnyShapeStyle(MirrorTheme.gradientPrimary) : AnyShapeStyle(Color.white.opacity(0.15)))
                )
            }
            .disabled(!canProceed)
        }
    }

    // MARK: - Validation

    private var canProceed: Bool {
        switch currentStep {
        case 0: return selectedAgeRange != nil && selectedAgeRange != "Under 13"
        case 1: return !name.trimmingCharacters(in: .whitespaces).isEmpty
        case 2: return selectedGender != nil
        case 3: return true // body info optional
        case 4: return !selectedStyles.isEmpty
        case 5: return true // selfie optional
        default: return true
        }
    }

    // MARK: - Save

    private func saveOnboarding() {
        isSaving = true
        var data: [String: Any] = [
            "name": name,
            "height": height,
            "style_preferences": Array(selectedStyles),
            "onboarding_completed": true
        ]

        if let gender = selectedGender {
            data["gender"] = gender.lowercased()
        }
        if let bodyShape = selectedBodyShape {
            data["body_shape"] = bodyShape.lowercased()
        }
        if let ageRange = selectedAgeRange {
            data["age_range"] = ageRange.lowercased()
        }

        Task {
            await appState.saveOnboarding(data)
            isSaving = false
        }
    }
}
