import CoreLocation
import Foundation
import Shared

/// Date bridging between Swift and the shared Kotlin module.
///
/// `kotlinx.datetime.LocalDate` and Foundation's `Date` are different things:
/// one is a calendar date with no time or zone, the other an instant. Getting
/// this wrong is the classic source of a leave request landing a day early —
/// `Date()` converted in UTC is still yesterday for anyone in IST until 05:30.
/// Both conversions below go through the current calendar deliberately.
extension Date {

    var asKotlinLocalDate: Kotlinx_datetimeLocalDate {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: self)
        return Kotlinx_datetimeLocalDate(
            year: Int32(parts.year ?? 1970),
            monthNumber: Int32(parts.month ?? 1),
            dayOfMonth: Int32(parts.day ?? 1)
        )
    }

    /// `YYYY-MM-DD`, which is what every HRMS endpoint expects.
    var isoDate: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        // Fixed locale: under a Hindi or Arabic locale the default formatter
        // emits non-Arabic numerals, and the API rejects the result with a
        // validation error nobody can reproduce on an English handset.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: self)
    }
}

// MARK: - Kotlin collections and numbers

func kotlinList<T>(_ value: Any?) -> [T] {
    guard let value else { return [] }
    if let typed = value as? [T] { return typed }
    if let array = value as? NSArray {
        return array.compactMap { $0 as? T }
    }
    return []
}

func kotlinDouble(_ value: Double?) -> KotlinDouble? {
    guard let value else { return nil }
    return KotlinDouble(double: value)
}

func swiftDouble(_ value: KotlinDouble?) -> Double? {
    value?.doubleValue
}

// MARK: - Location

/// One location reading, or nothing.
struct LocationReading {
    let latitude: Double
    let longitude: Double
    let accuracy: Double
}

/// Asks iOS where the phone is, once.
///
/// Deliberately one-shot rather than a continuous subscription. Attendance
/// needs a position at the moment somebody taps a button; keeping the radio
/// alive between taps drains the battery and puts the app in the "using your
/// location" list, which employees reasonably object to.
@MainActor
final class LocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {

    private let manager = CLLocationManager()
    private var waiting: CheckedContinuation<LocationReading?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func current() async -> LocationReading? {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            return nil
        case .denied, .restricted:
            // Refused is a settled answer, not a failure to retry.
            return nil
        default:
            break
        }

        return await withCheckedContinuation { continuation in
            waiting = continuation
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            resume(with: LocationReading(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                accuracy: location.horizontalAccuracy
            ))
        }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager,
        didFailWithError error: Error
    ) {
        Task { @MainActor in resume(with: nil) }
    }

    /// Resumes exactly once. A continuation resumed twice traps, and Core
    /// Location will happily deliver an update and an error for one request.
    private func resume(with reading: LocationReading?) {
        guard let continuation = waiting else { return }
        waiting = nil
        continuation.resume(returning: reading)
    }
}
