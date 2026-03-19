import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var showDeleteAlert = false
    @State private var showDeleteConfirmation = false
    @State private var deleteConfirmText = ""
    @State private var showLogoutAlert = false
    @State private var notificationsEnabled = true
    @State private var hapticFeedback = true
    @State private var darkMode = true
    @State private var isDeletingAccount = false
    @State private var showDeleteError = false
    @State private var deleteErrorMessage = ""

    var body: some View {
        NavigationStack {
            List {
                // Account
                Section {
                    settingsRow(icon: "person.fill", color: MirrorTheme.purple, title: "Account Info") {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(appState.currentUser?.name ?? "")
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                            Text(appState.currentUser?.email ?? "")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                    }

                    settingsRow(icon: "crown.fill", color: Color(hex: "FFD700"), title: "Subscription") {
                        Text(appState.subscriptionPlan.capitalized)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(MirrorTheme.purple)
                    }
                } header: {
                    Text("Account")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )

                // Preferences
                Section {
                    Toggle(isOn: $notificationsEnabled) {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "bell.fill", color: MirrorTheme.pink)
                            Text("Push Notifications")
                                .font(.system(size: 15))
                        }
                    }
                    .tint(MirrorTheme.purple)
                    .accessibilityLabel("Push Notifications")
                    .accessibilityValue(notificationsEnabled ? "On" : "Off")
                    .accessibilityHint("Toggle push notifications")

                    Toggle(isOn: $hapticFeedback) {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "hand.tap.fill", color: MirrorTheme.indigo)
                            Text("Haptic Feedback")
                                .font(.system(size: 15))
                        }
                    }
                    .tint(MirrorTheme.purple)
                    .accessibilityLabel("Haptic Feedback")
                    .accessibilityValue(hapticFeedback ? "On" : "Off")
                    .accessibilityHint("Toggle haptic feedback")

                    Toggle(isOn: .constant(true)) {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "moon.fill", color: .purple)
                            Text("Dark Mode")
                                .font(.system(size: 15))
                        }
                    }
                    .tint(MirrorTheme.purple)
                    .disabled(true)
                    .accessibilityLabel("Dark Mode")
                    .accessibilityValue("On")
                    .accessibilityHint("Dark mode is always on")
                } header: {
                    Text("App Preferences")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )

                // Support
                Section {
                    Button {
                        clearImageCache()
                    } label: {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "arrow.triangle.2.circlepath", color: .teal)
                            Text("Clear Image Cache")
                                .font(.system(size: 15))
                                .foregroundStyle(.primary)
                            Spacer()
                        }
                    }
                    .accessibilityLabel("Clear Image Cache")
                    .accessibilityHint("Removes all cached images to free up storage")

                    Button {
                        exportUserData()
                    } label: {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "square.and.arrow.up.fill", color: .cyan)
                            Text("Export My Data")
                                .font(.system(size: 15))
                                .foregroundStyle(.primary)
                            Spacer()
                        }
                    }
                    .accessibilityLabel("Export My Data")
                    .accessibilityHint("Downloads your personal data as a file")

                    Button {
                        reportBug()
                    } label: {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "ladybug.fill", color: .red)
                            Text("Report a Bug")
                                .font(.system(size: 15))
                                .foregroundStyle(.primary)
                            Spacer()
                        }
                    }
                    .accessibilityLabel("Report a Bug")
                    .accessibilityHint("Opens email to send a bug report")
                } header: {
                    Text("Support")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )

                // About
                Section {
                    settingsRow(icon: "info.circle.fill", color: .blue, title: "Version") {
                        Text("\(appVersion) (\(buildNumber))")
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                    }

                    settingsRow(icon: "doc.text.fill", color: .gray, title: "Terms of Service") {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.tertiary)
                    }

                    settingsRow(icon: "lock.shield.fill", color: .green, title: "Privacy Policy") {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.tertiary)
                    }
                } header: {
                    Text("About")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )

                // Danger zone
                Section {
                    Button {
                        showLogoutAlert = true
                    } label: {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "rectangle.portrait.and.arrow.right", color: .orange)
                            Text("Log Out")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(.primary)
                            Spacer()
                        }
                    }
                    .accessibilityLabel("Log Out")
                    .accessibilityHint("Signs you out of your account")

                    Button {
                        showDeleteAlert = true
                    } label: {
                        HStack(spacing: 12) {
                            settingsIcon(icon: "trash.fill", color: .red)
                            Text("Delete Account")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(.red)
                            Spacer()
                        }
                    }
                    .accessibilityLabel("Delete Account")
                    .accessibilityHint("Permanently deletes your account and all data")
                }
                .listRowBackground(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                )
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color(UIColor.systemBackground))
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .alert("Log Out", isPresented: $showLogoutAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Log Out", role: .destructive) {
                    let impact = UINotificationFeedbackGenerator()
                    impact.notificationOccurred(.warning)
                    appState.logout()
                    dismiss()
                }
            } message: {
                Text("Are you sure you want to log out?")
            }
            .alert("Delete Account", isPresented: $showDeleteAlert) {
                Button("Cancel", role: .cancel) {}
                Button("Continue", role: .destructive) {
                    let impact = UIImpactFeedbackGenerator(style: .heavy)
                    impact.impactOccurred()
                    showDeleteConfirmation = true
                }
            } message: {
                Text("This will permanently delete your account, wardrobe, outfits, style data, social posts, and all associated content. This action cannot be undone.")
            }
            .alert("Confirm Deletion", isPresented: $showDeleteConfirmation) {
                TextField("Type DELETE to confirm", text: $deleteConfirmText)
                Button("Cancel", role: .cancel) {
                    deleteConfirmText = ""
                }
                Button("Permanently Delete", role: .destructive) {
                    guard deleteConfirmText == "DELETE" else {
                        deleteConfirmText = ""
                        return
                    }
                    deleteConfirmText = ""
                    performAccountDeletion()
                }
            } message: {
                Text("Type DELETE in all caps to confirm you want to permanently delete your account.")
            }
            .alert("Deletion Failed", isPresented: $showDeleteError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(deleteErrorMessage)
            }
            .overlay {
                if isDeletingAccount {
                    ZStack {
                        Color.black.opacity(0.5)
                            .ignoresSafeArea()
                        VStack(spacing: 16) {
                            ProgressView()
                                .tint(.white)
                                .scaleEffect(1.3)
                            Text("Deleting account...")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(.white)
                        }
                        .padding(32)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(.ultraThinMaterial)
                        )
                    }
                }
            }
        }
    }

    // MARK: - Computed Properties

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }

    // MARK: - Support Actions

    private func clearImageCache() {
        URLCache.shared.removeAllCachedResponses()
        ImageCache.shared.removeAll()
        DiskImageCache.shared.removeAll()
        let impact = UINotificationFeedbackGenerator()
        impact.notificationOccurred(.success)
    }

    private func exportUserData() {
        Task {
            do {
                guard let token = appState.authToken,
                      let url = URL(string: "\(APIConfig.baseURL)/api/user/export-data") else { return }

                var request = URLRequest(url: url)
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

                let (data, _) = try await URLSession.pinned().data(for: request)

                // Share the JSON data
                let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("mirror_ai_export.json")
                try data.write(to: tempURL)

                await MainActor.run {
                    let activityVC = UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
                    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                       let rootVC = windowScene.windows.first?.rootViewController {
                        rootVC.present(activityVC, animated: true)
                    }
                }
            } catch {
                appState.errorMessage = "Failed to export data. Please try again."
            }
        }
    }

    private func reportBug() {
        let email = "support@mirrorai.app"
        let subject = "Bug Report - Mirror AI v\(appVersion)"
        let urlString = "mailto:\(email)?subject=\(subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
        if let url = URL(string: urlString) {
            UIApplication.shared.open(url)
        }
    }

    // MARK: - Account Deletion

    private func performAccountDeletion() {
        isDeletingAccount = true
        let impact = UINotificationFeedbackGenerator()

        Task {
            do {
                let url = URL(string: "\(APIConfig.baseURL)/api/user/delete")!
                var request = URLRequest(url: url)
                request.httpMethod = "DELETE"
                if let token = appState.authToken {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }

                let (_, response) = try await URLSession.pinned().data(for: request)
                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    throw URLError(.badServerResponse)
                }

                await MainActor.run {
                    isDeletingAccount = false
                    impact.notificationOccurred(.success)
                    appState.logout()
                    dismiss()
                }
            } catch {
                await MainActor.run {
                    isDeletingAccount = false
                    impact.notificationOccurred(.error)
                    deleteErrorMessage = "Failed to delete account. Please try again or contact support at privacy@mirrorai.app."
                    showDeleteError = true
                }
            }
        }
    }

    // MARK: - Helpers

    private func settingsRow<Trailing: View>(
        icon: String,
        color: Color,
        title: String,
        @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        HStack(spacing: 12) {
            settingsIcon(icon: icon, color: color)
            Text(title)
                .font(.system(size: 15))
            Spacer()
            trailing()
        }
    }

    private func settingsIcon(icon: String, color: Color) -> some View {
        Image(systemName: icon)
            .font(.system(size: 14))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(RoundedRectangle(cornerRadius: 8).fill(color))
    }
}
