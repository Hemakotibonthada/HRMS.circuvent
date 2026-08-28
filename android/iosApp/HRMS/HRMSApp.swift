import SwiftUI
import Shared

// ═══════════════════════════════════════════════════════════════
// CIRCUVENT HRMS — iOS
// ═══════════════════════════════════════════════════════════════
//
// The other half of a single application built in native languages. Every
// decision this app makes about the product — whether leave overlaps, whether
// a punch is inside the geofence, how many working days a request costs — is
// taken by the `Shared` framework, which is the same Kotlin the Android app
// runs. Nothing in this target reimplements a rule.
//
// What this target owns is the part that should not be shared: how it looks
// and feels on an iPhone. SwiftUI navigation, the system back gesture, Dynamic
// Type, VoiceOver and the iOS date picker are all what users expect here, and
// a cross-platform UI layer imitating them is the thing people notice
// immediately and cannot name.

@main
struct HRMSApp: App {
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .task { await session.restore() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        switch session.state {
        case .unknown:
            // Shown while the Keychain is read. Without this the sign-in
            // screen flashes for anyone already signed in, which reads as
            // having been signed out.
            ProgressView().controlSize(.large)

        case .signedOut:
            SignInScreen()

        case .signedIn:
            HomeTabs()
        }
    }
}

struct HomeTabs: View {
    var body: some View {
        // Home / Leave / Inbox / Team / Me, matching Android.
        //
        // Pay and People gave up their tabs. Both are still one tap away under
        // Me, and the two that replaced them had been unreachable: approvals
        // were split across screens by the kind of thing being approved, and
        // "who is away today" had nowhere to live at all. Five is the platform
        // limit worth keeping to — a sixth becomes a "More" tab that hides the
        // thing somebody wanted.
        TabView {
            TodayScreen()
                .tabItem { Label("Home", systemImage: "house") }

            LeaveScreen()
                .tabItem { Label("Leave", systemImage: "calendar") }

            InboxScreen()
                .tabItem { Label("Inbox", systemImage: "tray") }

            TeamScreen()
                .tabItem { Label("Team", systemImage: "person.2") }

            MoreScreen()
                .tabItem { Label("Me", systemImage: "person.crop.circle") }
        }
    }
}
