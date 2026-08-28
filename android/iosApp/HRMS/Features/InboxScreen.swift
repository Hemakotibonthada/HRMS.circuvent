import SwiftUI
import Shared

// ═══════════════════════════════════════════════════════════════
// INBOX — everything waiting on a decision, in one list
// ═══════════════════════════════════════════════════════════════
//
// Approvals were split across separate screens by the kind of thing being
// approved, which is a distinction the person approving does not have. A
// manager holding a phone has "four things to decide", not "a leave queue, a
// work-from-home queue and an attendance-correction queue", and had to already
// know which screen a request lived on to find it.
//
// The word for approving differs by endpoint — leave takes "approve", the
// others take "approved" — and that difference is absorbed in the shared API
// rather than repeated here. See `HrmsApi.decideWorkArrangement`.

struct InboxScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var items: [InboxItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var deciding: Set<String> = []

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView()
                } else if let error {
                    ContentUnavailableView(
                        "Could not load your inbox",
                        systemImage: "exclamationmark.triangle",
                        description: Text(error)
                    )
                } else if items.isEmpty {
                    ContentUnavailableView(
                        "You are all caught up",
                        systemImage: "tray",
                        description: Text(
                            "Leave, work-from-home and attendance corrections needing your "
                            + "decision arrive here as soon as they are submitted."
                        )
                    )
                } else {
                    List(items) { item in
                        InboxRow(
                            item: item,
                            currentEmployeeId: session.employeeId,
                            busy: deciding.contains(item.id),
                            decide: { approve in await decide(item, approve: approve) }
                        )
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Inbox")
            .refreshable { await load() }
        }
        .task { await load() }
    }

    private func load() async {
        error = nil
        var collected: [InboxItem] = []

        // Fetched together rather than one after another: three round trips in
        // series on a phone is three chances to show half a list.
        async let leave = session.api.leaveRequests()
        async let away = session.api.workArrangements()
        async let corrections = session.api.regularisations()

        if case .ok(let page) = outcome(try? await leave) as ApiOutcome<Page<LeaveRequest>> {
            collected += page.items
                .filter { $0.status == "pending" }
                .map(InboxItem.init(leave:))
        }
        if case .ok(let rows) = outcome(try? await away) as ApiOutcome<[WorkArrangementRequest]> {
            collected += rows.filter { $0.status == "pending" }.map(InboxItem.init(away:))
        }
        if case .ok(let rows) = outcome(try? await corrections) as ApiOutcome<[RegularisationRequest]> {
            collected += rows.filter { $0.status == "pending" }.map(InboxItem.init(correction:))
        }

        items = collected
        loading = false
    }

    private func decide(_ item: InboxItem, approve: Bool) async {
        deciding.insert(item.id)
        defer { deciding.remove(item.id) }

        let result: HrmsApiResult?
        switch item.kind {
        case .leave:
            result = try? await session.api.decideLeave(id: item.sourceId, approve: approve, reason: nil)
        case .away:
            result = try? await session.api.decideWorkArrangement(id: item.sourceId, approve: approve, reason: nil)
        case .correction:
            result = try? await session.api.decideRegularisation(id: item.sourceId, approve: approve, reason: nil)
        }

        if case .ok = outcome(result) as ApiOutcome<KotlinUnit> {
            // Removed rather than refetched: the list is already correct, and a
            // reload here makes the row somebody just tapped flicker back.
            items.removeAll { $0.id == item.id }
        } else {
            await load()
        }
    }
}

// ─── One row, whatever it is ─────────────────────────────────

private struct InboxRow: View {
    let item: InboxItem
    let currentEmployeeId: String?
    let busy: Bool
    let decide: (Bool) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(item.title, systemImage: item.symbol)
                    .font(.headline)
                Spacer()
                Text(item.kindLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(item.detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if let reason = item.reason, !reason.isEmpty {
                Text(reason).font(.subheadline)
            }

            if item.isOwn(currentEmployeeId) {
                // The server refuses this outright. Saying so before the tap
                // beats a button that exists only to produce a refusal — and
                // the check is on the employment record, not the login, because
                // those are different ids and comparing the wrong pair means
                // the guard silently allows everything.
                Label(
                    "This is your own request. Someone else has to decide it.",
                    systemImage: "person.crop.circle.badge.exclamationmark"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            } else {
                HStack(spacing: 12) {
                    Button("Approve") { Task { await decide(true) } }
                        .buttonStyle(.borderedProminent)
                    Button("Reject", role: .destructive) { Task { await decide(false) } }
                        .buttonStyle(.bordered)
                }
                .disabled(busy)
                .opacity(busy ? 0.5 : 1)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

// ─── The four queues, as one thing ───────────────────────────

struct InboxItem: Identifiable {
    enum Kind { case leave, away, correction }

    let id: String
    let sourceId: String
    let kind: Kind
    let title: String
    let detail: String
    let reason: String?
    let requesterId: String?

    /**
     * Whether this is the caller's own request.
     *
     * Compared against the **employment record**, not the login. They are
     * different uuids, and comparing a request's `employeeId` against an
     * account id is false for everybody — which does not fail loudly, it
     * simply stops the guard refusing anything. Null never matches, so an
     * account with no employment record is not treated as owning anything.
     */
    func isOwn(_ employeeId: String?) -> Bool {
        guard let employeeId, let requesterId else { return false }
        return employeeId == requesterId
    }

    var kindLabel: String {
        switch kind {
        case .leave: return "Leave"
        case .away: return "Working away"
        case .correction: return "Correction"
        }
    }

    var symbol: String {
        switch kind {
        case .leave: return "airplane.departure"
        case .away: return "house"
        case .correction: return "calendar.badge.clock"
        }
    }

    init(leave: LeaveRequest) {
        self.id = "leave-\(leave.id)"
        self.sourceId = leave.id
        self.kind = .leave
        self.title = leave.employeeName ?? "A colleague"
        self.detail = "\(leave.leaveType?.capitalized ?? "Leave") · \(leave.startDate) to \(leave.endDate)"
        self.reason = leave.reason
        self.requesterId = leave.employeeId
    }

    init(away: WorkArrangementRequest) {
        self.id = "away-\(away.id)"
        self.sourceId = away.id
        self.kind = .away
        self.title = away.employeeName ?? "A colleague"
        self.detail = (away.kind == "wfh" ? "Work from home" : "On duty")
            + " · \(away.startDate) to \(away.endDate)"
        self.reason = away.reason
        self.requesterId = away.employeeId
    }

    init(correction: RegularisationRequest) {
        self.id = "fix-\(correction.id)"
        self.sourceId = correction.id
        self.kind = .correction
        self.title = correction.employeeName ?? "A colleague"
        self.detail = "Correct \(correction.workDate)"
        self.reason = correction.reason
        self.requesterId = correction.employeeId
    }
}
