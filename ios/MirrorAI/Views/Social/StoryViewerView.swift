import SwiftUI

struct StoryViewerView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let storyGroup: StoryGroupModel

    @State private var currentIndex = 0
    @State private var progress: [CGFloat] = []
    @State private var timer: Timer?
    @State private var isPaused = false
    @State private var dragOffset: CGSize = .zero
    @State private var elapsedTime: CGFloat = 0

    private let storyDuration: CGFloat = 5.0
    private let tickInterval: CGFloat = 0.05

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background
                Color.black.ignoresSafeArea()

                // Story image
                storyContent(in: geometry)

                // Overlay UI
                VStack(spacing: 0) {
                    // Progress bars
                    progressBars
                        .padding(.horizontal, 8)
                        .padding(.top, geometry.safeAreaInsets.top + 8)

                    // User info header
                    storyHeader
                        .padding(.horizontal, 16)
                        .padding(.top, 10)

                    Spacer()

                    // Caption
                    if let caption = currentStory?.caption, !caption.isEmpty {
                        Text(caption)
                            .font(.system(size: 15))
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.5), radius: 4)
                            .padding(.horizontal, 20)
                            .padding(.bottom, geometry.safeAreaInsets.bottom + 20)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        dragOffset = value.translation
                        if abs(value.translation.height) > 10 {
                            pauseTimer()
                        }
                    }
                    .onEnded { value in
                        if value.translation.height > 100 {
                            dismiss()
                        } else {
                            withAnimation(.spring(response: 0.3)) {
                                dragOffset = .zero
                            }
                            resumeTimer()
                        }
                    }
            )
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.2)
                    .onChanged { _ in
                        pauseTimer()
                    }
            )
            .onTapGesture { location in
                let tapX = location.x
                let midpoint = geometry.size.width / 2

                if tapX < midpoint {
                    goToPrevious()
                } else {
                    goToNext()
                }
            }
            .offset(y: max(0, dragOffset.height))
            .opacity(1.0 - Double(max(0, dragOffset.height)) / 400.0)
        }
        .ignoresSafeArea()
        .statusBarHidden()
        .onAppear {
            setupProgress()
            startTimer()
            markCurrentStoryViewed()
        }
        .onDisappear {
            stopTimer()
        }
    }

    // MARK: - Current Story

    private var currentStory: StoryModel? {
        guard currentIndex < storyGroup.stories.count else { return nil }
        return storyGroup.stories[currentIndex]
    }

    // MARK: - Story Content

    private func storyContent(in geometry: GeometryProxy) -> some View {
        Group {
            if let story = currentStory {
                CachedAsyncImage(url: URL(string: story.imageUrl), contentMode: .fit) {
                    ZStack {
                        Color.black
                        ProgressView()
                            .tint(.white)
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .clipped()
                .transition(.opacity)
                .id(story.id)
            }
        }
    }

    // MARK: - Progress Bars

    private var progressBars: some View {
        HStack(spacing: 4) {
            ForEach(0..<storyGroup.stories.count, id: \.self) { index in
                GeometryReader { barGeo in
                    ZStack(alignment: .leading) {
                        // Background
                        Capsule()
                            .fill(Color.white.opacity(0.3))

                        // Fill
                        Capsule()
                            .fill(Color.white)
                            .frame(width: barGeo.size.width * progressValue(for: index))
                    }
                }
                .frame(height: 2.5)
            }
        }
    }

    private func progressValue(for index: Int) -> CGFloat {
        if index < currentIndex {
            return 1.0
        } else if index == currentIndex {
            return min(elapsedTime / storyDuration, 1.0)
        } else {
            return 0.0
        }
    }

    // MARK: - Story Header

    private var storyHeader: some View {
        HStack(spacing: 10) {
            // Avatar
            if let avatarUrl = storyGroup.user?.avatarUrl,
               let url = URL(string: avatarUrl) {
                CachedAsyncImage(url: url) {
                    Circle()
                        .fill(Color.white.opacity(0.2))
                }
                .frame(width: 36, height: 36)
                .clipShape(Circle())
            } else {
                Circle()
                    .fill(Color.white.opacity(0.2))
                    .frame(width: 36, height: 36)
                    .overlay {
                        Image(systemName: "person.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(.white.opacity(0.7))
                    }
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(storyGroup.user?.username ?? storyGroup.user?.fullName ?? "User")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)

                if let story = currentStory {
                    Text(relativeTime(from: story.createdAt))
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }

            Spacer()

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(8)
                    .background(Circle().fill(Color.white.opacity(0.15)))
            }
            .accessibilityLabel(L10n.a11yCloseButton)
        }
    }

    // MARK: - Timer Management

    private func setupProgress() {
        progress = Array(repeating: 0, count: storyGroup.stories.count)
        // Skip to first unviewed story
        if let firstUnviewed = storyGroup.stories.firstIndex(where: { $0.isViewed != true }) {
            currentIndex = firstUnviewed
        }
    }

    private func startTimer() {
        elapsedTime = 0
        timer = Timer.scheduledTimer(withTimeInterval: tickInterval, repeats: true) { _ in
            guard !isPaused else { return }
            Task { @MainActor in
                elapsedTime += tickInterval
                if elapsedTime >= storyDuration {
                    goToNext()
                }
            }
        }
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func pauseTimer() {
        isPaused = true
    }

    private func resumeTimer() {
        isPaused = false
    }

    private func resetTimer() {
        elapsedTime = 0
    }

    // MARK: - Navigation

    private func goToNext() {
        if currentIndex < storyGroup.stories.count - 1 {
            withAnimation(.easeInOut(duration: 0.15)) {
                currentIndex += 1
            }
            resetTimer()
            markCurrentStoryViewed()
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
        } else {
            dismiss()
        }
    }

    private func goToPrevious() {
        if currentIndex > 0 {
            withAnimation(.easeInOut(duration: 0.15)) {
                currentIndex -= 1
            }
            resetTimer()
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
        } else {
            resetTimer()
        }
    }

    private func markCurrentStoryViewed() {
        guard let story = currentStory else { return }
        Task {
            try? await SocialService.shared.viewStory(id: story.id)
        }
    }

    // MARK: - Helpers

    private func relativeTime(from dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else {
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: dateString) else { return "" }
            return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
        }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: Date())
    }
}
