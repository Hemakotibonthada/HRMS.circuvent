import Foundation
import SwiftUI
import Shared

/// Bridges the shared Kotlin API into something SwiftUI can observe.
///
/// Kotlin suspend functions arrive in Swift as completion handlers, and Kotlin
/// sealed classes arrive as a class hierarchy rather than a Swift enum. This is
/// the one place that translation happens, so no view has to know about it.
@MainActor
final class SessionStore: ObservableObject {

    enum State {
        case unknown
        case signedOut
        case signedIn(Session)
    }

    @Published private(set) var state: State = .unknown
    @Published var signingIn = false
    @Published var error: String?

    /**
     * The signed-in person's employment record, which is not their account.
     *
     * `Session.id` is the login. Everything in HR is keyed by the employee row,
     * and screens that decide "is this mine" — the inbox above all — must
     * compare against this. Null is honest: a service mailbox, or somebody
     * whose login exists before HR created their row.
     */
    var employeeId: String? {
        if case .signedIn(let session) = state { return session.employeeId }
        return nil
    }

    let api: HrmsApi

    init(baseUrl: String = AppConfig.baseUrl) {
        self.api = HrmsApi(baseUrl: baseUrl, tokens: TokenStore(), engineClient: nil)
    }

    /// Restores a session from the Keychain, if there is one.
    func restore() async {
        guard api.tokens.accessToken() != nil else {
            state = .signedOut
            return
        }

        do {
            let result = try await api.me()
            switch onEnum(of: result) {
            case .ok(let ok):
                state = .signedIn(ok.value as! Session)
            default:
                // A stored token that no longer works is not an error worth
                // showing; it just means signing in again.
                state = .signedOut
            }
        } catch {
            state = .signedOut
        }
    }

    func signIn(email: String, password: String) async {
        signingIn = true
        error = nil
        defer { signingIn = false }

        do {
            let result = try await api.signIn(email: email, password: password)
            switch onEnum(of: result) {
            case .ok(let ok):
                state = .signedIn(ok.value as! Session)
            case .unauthorised:
                error = "Incorrect email or password"
            case .offline(let offline):
                error = offline.message
            case .failed(let failed):
                error = failed.message
            }
        } catch {
            error = "Could not sign in"
        }
    }

    func signOut() async {
        try? await api.signOut()
        state = .signedOut
    }
}

enum AppConfig {
    /// Read from the build configuration so a debug build can point at a
    /// local server without a code change, and a release build cannot
    /// accidentally ship pointing at one.
    static var baseUrl: String {
        (Bundle.main.object(forInfoDictionaryKey: "HRMS_BASE_URL") as? String)
            ?? "https://hrms.circuvent.com"
    }
}

/// A small helper mirroring the shared `Result` type into something Swift can
/// switch over exhaustively.
///
/// Kotlin sealed interfaces cross into Swift as a class hierarchy, so the
/// compiler cannot check a `switch` over them. Collapsing them into a Swift
/// enum at the boundary restores that, and means a new case added in Kotlin
/// fails to compile here rather than falling through silently at runtime.
enum ApiOutcome<T> {
    case ok(T)
    case unauthorised
    case offline(String)
    case failed(Int, String)
}

func outcome<T>(_ result: HrmsApiResult) -> ApiOutcome<T> {
    if let ok = result as? HrmsApiResultOk {
        return .ok(ok.value as! T)
    }
    if result is HrmsApiResultUnauthorised {
        return .unauthorised
    }
    if let offline = result as? HrmsApiResultOffline {
        return .offline(offline.message)
    }
    if let failed = result as? HrmsApiResultFailed {
        return .failed(Int(failed.status), failed.message)
    }
    return .failed(0, "Unexpected response")
}
