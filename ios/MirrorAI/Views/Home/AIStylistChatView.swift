import SwiftUI

struct AIStylistChatView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var isTyping = false
    @FocusState private var isInputFocused: Bool

    struct ChatMessage: Identifiable {
        let id = UUID()
        let role: String // "user" or "assistant"
        let content: String
        let timestamp = Date()
    }

    private let quickSuggestions = [
        "What should I wear today?",
        "Rate my outfit",
        "Color tips for my skin tone",
        "How to style a blazer?"
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Messages
                messagesScrollView

                // Quick suggestions (only when empty)
                if messages.isEmpty {
                    suggestionsRow
                }

                // Input bar
                inputBar
            }
            .background(Color(UIColor.systemBackground))
            .navigationTitle("AI Stylist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        messages.removeAll()
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 14))
                    }
                    .disabled(messages.isEmpty)
                }
            }
        }
    }

    // MARK: - Messages

    private var messagesScrollView: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 16) {
                    if messages.isEmpty {
                        welcomeMessage
                            .padding(.top, 40)
                    }

                    ForEach(messages) { message in
                        messageBubble(message)
                            .id(message.id)
                    }

                    if isTyping {
                        typingIndicator
                            .id("typing")
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .onChange(of: messages.count) { _, _ in
                withAnimation(.spring(response: 0.3)) {
                    if let lastMessage = messages.last {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }
            .onChange(of: isTyping) { _, typing in
                if typing {
                    withAnimation {
                        proxy.scrollTo("typing", anchor: .bottom)
                    }
                }
            }
        }
    }

    private var welcomeMessage: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(MirrorTheme.purple.opacity(0.12))
                    .frame(width: 72, height: 72)

                Image(systemName: "sparkles")
                    .font(.system(size: 32))
                    .foregroundStyle(MirrorTheme.gradientPrimary)
            }

            VStack(spacing: 6) {
                Text("Mirror AI Stylist")
                    .font(.system(size: 20, weight: .bold))

                Text("Ask me anything about fashion,\nstyling, and your wardrobe!")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func messageBubble(_ message: ChatMessage) -> some View {
        HStack(alignment: .bottom, spacing: 8) {
            if message.role == "user" {
                Spacer(minLength: 60)
            } else {
                // AI avatar
                ZStack {
                    Circle()
                        .fill(MirrorTheme.purple.opacity(0.15))
                        .frame(width: 30, height: 30)

                    Image(systemName: "sparkles")
                        .font(.system(size: 13))
                        .foregroundStyle(MirrorTheme.purple)
                }
            }

            VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .font(.system(size: 15))
                    .foregroundStyle(message.role == "user" ? .white : .primary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        Group {
                            if message.role == "user" {
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(MirrorTheme.gradientPrimary)
                            } else {
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(Color(UIColor.secondarySystemBackground))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .strokeBorder(
                                                MirrorTheme.gradientPrimary,
                                                lineWidth: 1
                                            )
                                    )
                            }
                        }
                    )

                Text(formatTime(message.timestamp))
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }

            if message.role != "user" {
                Spacer(minLength: 60)
            }
        }
    }

    private var typingIndicator: some View {
        HStack(alignment: .bottom, spacing: 8) {
            ZStack {
                Circle()
                    .fill(MirrorTheme.purple.opacity(0.15))
                    .frame(width: 30, height: 30)

                Image(systemName: "sparkles")
                    .font(.system(size: 13))
                    .foregroundStyle(MirrorTheme.purple)
            }

            HStack(spacing: 5) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 7, height: 7)
                        .opacity(0.4)
                        .animation(
                            .easeInOut(duration: 0.6)
                                .repeatForever()
                                .delay(Double(i) * 0.2),
                            value: isTyping
                        )
                        .scaleEffect(isTyping ? 1.0 : 0.5)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color(UIColor.secondarySystemBackground))
            )

            Spacer()
        }
    }

    // MARK: - Suggestions

    private var suggestionsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(quickSuggestions, id: \.self) { suggestion in
                    Button {
                        inputText = suggestion
                        sendMessage()
                    } label: {
                        Text(suggestion)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(MirrorTheme.purple)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .fill(MirrorTheme.purple.opacity(0.1))
                                    .overlay(
                                        Capsule()
                                            .strokeBorder(MirrorTheme.purple.opacity(0.3), lineWidth: 1)
                                    )
                            )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 12) {
            TextField("Ask your stylist...", text: $inputText, axis: .vertical)
                .font(.system(size: 16))
                .lineLimit(1...4)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 22)
                        .fill(Color(UIColor.secondarySystemBackground))
                )
                .focused($isInputFocused)

            Button {
                sendMessage()
            } label: {
                ZStack {
                    Circle()
                        .fill(
                            inputText.trimmingCharacters(in: .whitespaces).isEmpty
                                ? AnyShapeStyle(Color.gray.opacity(0.3))
                                : AnyShapeStyle(MirrorTheme.gradientPrimary)
                        )
                        .frame(width: 40, height: 40)

                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isTyping)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    // MARK: - Actions

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }

        let impactFeedback = UIImpactFeedbackGenerator(style: .light)
        impactFeedback.impactOccurred()

        let userMessage = ChatMessage(role: "user", content: text)
        messages.append(userMessage)
        inputText = ""
        isTyping = true

        let history = messages.map { (role: $0.role, content: $0.content) }

        Task {
            do {
                let aiService = AIService.shared
                let reply = try await aiService.chat(message: text, history: history)

                withAnimation(.spring(response: 0.3)) {
                    isTyping = false
                    messages.append(ChatMessage(role: "assistant", content: reply))
                }

                let notificationFeedback = UINotificationFeedbackGenerator()
                notificationFeedback.notificationOccurred(.success)
            } catch {
                withAnimation {
                    isTyping = false
                    messages.append(ChatMessage(
                        role: "assistant",
                        content: "Sorry, I had trouble processing that. Please try again."
                    ))
                }
            }
        }
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
}
