import SwiftUI
import Shared

// ═══════════════════════════════════════════════════════════════
// TEAM — who is away, and whose day it is
// ═══════════════════════════════════════════════════════════════
//
// The two things people open an HR app to find out about other people. One
// screen because they are one question, and because two round trips to render
// one card is two chances to show half of it — the shared API asks once.
//
// No year is shown against a birthday. The day and month are what a colleague
// needs; the year is somebody's age, and an HR system publishing that to
// everyone is a disclosure nobody consented to. Anniversaries do carry it,
// because length of service is a fact about the job and "ten years today" is
// the whole point of saying it.

struct TeamScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var pulse: TeamPulse?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView()
                } else if let pulse, pulse.teamSize > 0 {
                    List {
                        Section("Away today") {
                            let today = pulse.onLeave.filter { $0.today }
                            if today.isEmpty {
                                Text("Everyone is in.").foregroundStyle(.secondary)
                            } else {
                                ForEach(today, id: \.employeeId) { person in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(person.name).font(.headline)
                                        Text(person.leaveType?.capitalized ?? "On leave")
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        if !pulse.birthdays.isEmpty {
                            Section("Birthdays") {
                                ForEach(pulse.birthdays, id: \.employeeId) { person in
                                    CelebrationRow(person: person, todayLabel: "Today")
                                }
                            }
                        }

                        if !pulse.anniversaries.isEmpty {
                            Section("Work anniversaries") {
                                ForEach(pulse.anniversaries, id: \.employeeId) { person in
                                    CelebrationRow(
                                        person: person,
                                        todayLabel: person.years.map { "\($0) years" } ?? "Today"
                                    )
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                } else {
                    ContentUnavailableView(
                        "No team yet",
                        systemImage: "person.2",
                        description: Text(
                            "Once you have colleagues who share a manager with you, who is "
                            + "away and whose birthday is coming up appear here."
                        )
                    )
                }
            }
            .navigationTitle("Team")
            .refreshable { await load() }
        }
        .task { await load() }
    }

    private func load() async {
        if case .ok(let value) = outcome(try? await session.api.teamPulse()) as ApiOutcome<TeamPulse> {
            pulse = value
        }
        loading = false
    }
}

private struct CelebrationRow: View {
    let person: Celebration
    let todayLabel: String

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(person.name).font(.headline)
                if let designation = person.designation, !designation.isEmpty {
                    Text(designation).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if person.isToday {
                Text(todayLabel)
                    .font(.caption.bold())
                    .foregroundStyle(.tint)
            } else if let on = person.on {
                Text(on).font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
