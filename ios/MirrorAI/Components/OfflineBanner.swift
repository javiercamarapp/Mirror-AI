import SwiftUI

struct OfflineBanner: View {
    @State private var networkMonitor = NetworkMonitor.shared

    var body: some View {
        if !networkMonitor.isConnected {
            HStack(spacing: 8) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 14))
                Text("No internet connection")
                    .font(.system(size: 14, weight: .medium))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(Color.red.opacity(0.9))
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}
