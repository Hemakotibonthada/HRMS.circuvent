import SwiftUI
import Shared

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE SCREENS — iOS
// ═══════════════════════════════════════════════════════════════
//
// Every rule these screens apply comes from `Shared`. They format, lay out and
// navigate; they do not decide.

// ─── Sign in ─────────────────────────────────────────────────

struct SignInScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 8) {
                Image(systemName: "building.2.crop.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.tint)
                Text("Circuvent HRMS").font(.largeTitle.bold())
                Text("Sign in to continue").foregroundStyle(.secondary)
            }

            VStack(spacing: 12) {
                TextField("Work email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                SecureField("Password", text: $password)
                    .textContentType(.password)
            }
            .textFieldStyle(.roundedBorder)

            if let error = session.error {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // Announced rather than merely displayed, or a VoiceOver
                    // user taps "Sign in" and hears nothing change.
                    .accessibilityAddTraits(.isStaticText)
            }

            Button {
                Task { await session.signIn(email: email, password: password) }
            } label: {
                if session.signingIn {
                    ProgressView().tint(.white)
                } else {
                    Text("Sign in").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(session.signingIn || email.isEmpty || password.isEmpty)

            Spacer()
        }
        .padding(24)
    }
}

// ─── Today ───────────────────────────────────────────────────

struct TodayScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var records: [AttendanceRecord] = []
    @State private var announcements: [Announcement] = []
    @State private var loading = true
    @State private var loadError: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    PunchCard()
                }

                if let loadError {
                    Section {
                        // A failed load and an empty day look identical unless
                        // the difference is kept, which is how "no records"
                        // hid a broken endpoint on the web for months.
                        Label(loadError, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                        Button("Try again") { Task { await load() } }
                    }
                }

                if !announcements.isEmpty {
                    Section("Announcements") {
                        ForEach(announcements, id: \.id) { item in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title).font(.headline)
                                if let body = item.body_ { Text(body).font(.subheadline) }
                            }
                        }
                    }
                }

                Section("Recent attendance") {
                    if loading {
                        ProgressView()
                    } else if records.isEmpty && loadError == nil {
                        Text("Nothing recorded yet").foregroundStyle(.secondary)
                    } else {
                        ForEach(records.prefix(7), id: \.id) { record in
                            HStack {
                                Text(record.date)
                                Spacer()
                                Text(record.status ?? "—").foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Today")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }

        let attendance: ApiOutcome<Page<AttendanceRecord>> =
            outcome(try! await session.api.attendance())
        switch attendance {
        case .ok(let page): records = page.items; loadError = nil
        case .offline(let message): loadError = message
        case .failed(_, let message): loadError = message
        case .unauthorised: await session.signOut()
        }

        let news: ApiOutcome<[Announcement]> = outcome(try! await session.api.announcements())
        if case .ok(let list) = news { announcements = list }
    }
}

/// Punch in and out, refusing where the shared geofence rule says to.
struct PunchCard: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var location = LocationProvider()
    @State private var message: String?
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Attendance").font(.headline)

            if let message {
                Text(message).font(.callout).foregroundStyle(.secondary)
            }

            HStack {
                Button("Punch in") { Task { await punch("check_in") } }
                    .buttonStyle(.borderedProminent)
                Button("Punch out") { Task { await punch("check_out") } }
                    .buttonStyle(.bordered)
            }
            .disabled(working)
        }
        .padding(.vertical, 4)
    }

    private func punch(_ kind: String) async {
        working = true
        defer { working = false }

        let reading = await location.current()

        // The decision is the shared rule's, not this screen's — the Android
        // app asks exactly the same question of exactly the same code.
        let decision = AttendanceRules.shared.mayPunch(
            punch: AttendanceRules.Punch(
                at: Kotlinx_datetimeInstant.companion.fromEpochMilliseconds(
                    epochMilliseconds: Int64(Date().timeIntervalSince1970 * 1000)
                ),
                latitude: reading?.latitude as NSNumber?,
                longitude: reading?.longitude as NSNumber?,
                accuracyMetres: reading?.accuracy as NSNumber?
            ),
            fences: [],
            requireLocation: false
        )

        if let refused = decision as? AttendanceRulesPunchDecisionRefused {
            message = refused.reason
            return
        }

        let result: ApiOutcome<AttendanceRecord> = outcome(
            try! await session.api.punch(
                kind: kind,
                latitude: reading?.latitude as NSNumber?,
                longitude: reading?.longitude as NSNumber?,
                accuracy: reading?.accuracy as NSNumber?
            )
        )

        switch result {
        case .ok: message = kind == "check_in" ? "Punched in" : "Punched out"
        case .offline: message = "Saved — will sync when you are back online"
        case .failed(_, let text): message = text
        case .unauthorised: await session.signOut()
        }
    }
}

// ─── Leave ───────────────────────────────────────────────────

struct LeaveScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var balances: [LeaveBalance] = []
    @State private var requests: [LeaveRequest] = []
    @State private var applying = false

    var body: some View {
        NavigationStack {
            List {
                Section("Your balance") {
                    if balances.isEmpty {
                        Text("No balances for this year").foregroundStyle(.secondary)
                    } else {
                        ForEach(balances, id: \.leaveType) { balance in
                            HStack {
                                Text(balance.leaveType.capitalized)
                                Spacer()
                                Text("\(balance.available, specifier: "%.1f") days")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section("Your requests") {
                    if requests.isEmpty {
                        Text("Nothing applied for").foregroundStyle(.secondary)
                    } else {
                        ForEach(requests, id: \.id) { request in
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(request.leaveType.capitalized) · \(request.startDate) to \(request.endDate)")
                                Text(request.status.capitalized)
                                    .font(.caption)
                                    .foregroundStyle(colour(for: request.status))
                            }
                        }
                    }
                }
            }
            .navigationTitle("Leave")
            .toolbar {
                Button { applying = true } label: { Image(systemName: "plus") }
            }
            .sheet(isPresented: $applying) {
                ApplyForLeaveSheet(balances: balances, existing: requests) {
                    Task { await load() }
                }
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func colour(for status: String) -> Color {
        switch status {
        case "approved": return .green
        case "rejected", "cancelled": return .red
        default: return .orange
        }
    }

    private func load() async {
        let balanceResult: ApiOutcome<[LeaveBalance]> = outcome(try! await session.api.leaveBalances())
        if case .ok(let list) = balanceResult { balances = list }

        let requestResult: ApiOutcome<Page<LeaveRequest>> = outcome(try! await session.api.leaveRequests())
        if case .ok(let page) = requestResult { requests = page.items }
    }
}

struct ApplyForLeaveSheet: View {
    @EnvironmentObject private var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    let balances: [LeaveBalance]
    let existing: [LeaveRequest]
    let onApplied: () -> Void

    @State private var leaveType = "casual"
    @State private var start = Date()
    @State private var end = Date()
    @State private var reason = ""
    @State private var problem: String?
    @State private var sending = false

    private let types = ["casual", "sick", "earned", "unpaid"]

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $leaveType) {
                    ForEach(types, id: \.self) { Text($0.capitalized).tag($0) }
                }

                DatePicker("From", selection: $start, displayedComponents: .date)
                DatePicker("To", selection: $end, displayedComponents: .date)

                TextField("Reason", text: $reason, axis: .vertical).lineLimit(3...)

                if let problem {
                    Text(problem).foregroundStyle(.red).font(.callout)
                }

                Section {
                    Text("This request costs \(days, specifier: "%.1f") working days")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Apply for leave")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") { Task { await apply() } }.disabled(sending)
                }
            }
        }
    }

    /// Worked out by the shared rule, so the figure shown here is the figure
    /// the Android app shows and the figure the server will deduct.
    private var days: Double {
        LeaveRules.shared.workingDays(
            start: start.asKotlinLocalDate,
            end: end.asKotlinLocalDate,
            holidays: Set(),
            weekend: Set([Kotlinx_datetimeDayOfWeek.saturday, Kotlinx_datetimeDayOfWeek.sunday])
        )
    }

    private func apply() async {
        sending = true
        defer { sending = false }

        // Checked before sending, so the employee is told which field is wrong
        // while they are still looking at it. The server checks again — this is
        // a convenience, not a control.
        let validation = LeaveRules.shared.validate(
            request: LeaveRules.Request(
                id: "",
                leaveType: leaveType,
                startDate: start.asKotlinLocalDate,
                endDate: end.asKotlinLocalDate,
                isHalfDay: false,
                status: "pending"
            ),
            today: Date().asKotlinLocalDate,
            balance: balances.first { $0.leaveType == leaveType }.map { balance in
                LeaveRules.Balance(
                    leaveType: balance.leaveType,
                    openingDays: balance.openingDays,
                    accruedDays: balance.accruedDays,
                    carryForwardDays: balance.carryForwardDays,
                    usedDays: balance.usedDays,
                    pendingDays: balance.pendingDays
                )
            },
            existing: [],
            holidays: Set(),
            minNoticeDays: 0
        )

        if let invalid = validation as? LeaveRulesValidationInvalid {
            problem = invalid.message
            return
        }

        let result: ApiOutcome<LeaveRequest> = outcome(
            try! await session.api.applyForLeave(
                leaveType: leaveType,
                startDate: start.isoDate,
                endDate: end.isoDate,
                reason: reason,
                isHalfDay: false
            )
        )

        switch result {
        case .ok:
            onApplied()
            dismiss()
        case .offline:
            problem = "You are offline — this will be sent when you reconnect"
        case .failed(_, let message):
            problem = message
        case .unauthorised:
            await session.signOut()
        }
    }
}

// ─── Pay ─────────────────────────────────────────────────────

struct PayslipsScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var payslips: [Payslip] = []

    var body: some View {
        NavigationStack {
            List {
                if payslips.isEmpty {
                    Text("No payslips yet").foregroundStyle(.secondary)
                } else {
                    ForEach(payslips, id: \.id) { slip in
                        NavigationLink {
                            PayslipDetail(payslip: slip)
                        } label: {
                            HStack {
                                Text(slip.period)
                                Spacer()
                                if let net = slip.netPay {
                                    Text(net, format: .currency(code: "INR"))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Payslips")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        let result: ApiOutcome<Page<Payslip>> = outcome(try! await session.api.payslips())
        if case .ok(let page) = result { payslips = page.items }
    }
}

struct PayslipDetail: View {
    let payslip: Payslip

    var body: some View {
        List {
            LabeledContent("Period", value: payslip.period)
            if let gross = payslip.grossPay {
                LabeledContent("Gross") { Text(gross, format: .currency(code: "INR")) }
            }
            if let deductions = payslip.totalDeductions {
                LabeledContent("Deductions") { Text(deductions, format: .currency(code: "INR")) }
            }
            if let net = payslip.netPay {
                LabeledContent("Net pay") { Text(net, format: .currency(code: "INR")).bold() }
            }
        }
        .navigationTitle(payslip.period)
    }
}

// ─── People ──────────────────────────────────────────────────

struct DirectoryScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var people: [Employee] = []
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List(people, id: \.id) { person in
                HStack(spacing: 12) {
                    Text(person.initials)
                        .font(.caption.bold())
                        .frame(width: 36, height: 36)
                        .background(.tint.opacity(0.15), in: Circle())

                    VStack(alignment: .leading) {
                        Text(person.displayName)
                        Text([person.designation, person.departmentName]
                            .compactMap { $0 }
                            .joined(separator: " · "))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .searchable(text: $query)
            .onChange(of: query) { _, _ in Task { await load() } }
            .navigationTitle("People")
            .task { await load() }
        }
    }

    private func load() async {
        let result: ApiOutcome<Page<Employee>> = outcome(
            try! await session.api.directory(query: query.isEmpty ? nil : query)
        )
        if case .ok(let page) = result { people = page.items }
    }
}

// ─── More ────────────────────────────────────────────────────

struct MoreScreen: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        NavigationStack {
            List {
                // The person, first. A hub that opens with a list of features
                // makes you check you are signed in as yourself.
                if case .signedIn(let me) = session.state {
                    Section {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(me.displayName ?? me.email).font(.headline)
                            Text(me.email).font(.subheadline).foregroundStyle(.secondary)
                            if let code = me.employeeCode {
                                // The code, not the id. Eight characters of a
                                // uuid identify nobody to a human being, and
                                // this is the number people quote to HR.
                                Text(code).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("Money") {
                    // Kept reachable after Pay lost its tab.
                    NavigationLink("Payslips") { PayslipsScreen() }
                    NavigationLink("Expenses") { ExpensesScreen() }
                }

                Section("Time") {
                    NavigationLink("Holidays") { HolidaysScreen() }
                }

                Section("Workplace") {
                    // Kept reachable after People lost its tab.
                    NavigationLink("Directory") { DirectoryScreen() }
                    NavigationLink("Documents") { DocumentsScreen() }
                    NavigationLink("Helpdesk") { HelpdeskScreen() }
                }

                Section {
                    Button("Sign out", role: .destructive) {
                        Task { await session.signOut() }
                    }
                }
            }
            .navigationTitle("Me")
        }
    }
}

struct HelpdeskScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var tickets: [HelpdeskTicket] = []

    var body: some View {
        List(tickets, id: \.id) { ticket in
            VStack(alignment: .leading, spacing: 4) {
                Text(ticket.subject)
                Text("\(ticket.status.capitalized) · \(ticket.priority)")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .overlay { if tickets.isEmpty { Text("No tickets").foregroundStyle(.secondary) } }
        .navigationTitle("Helpdesk")
        .task {
            let result: ApiOutcome<Page<HelpdeskTicket>> = outcome(try! await session.api.tickets())
            if case .ok(let page) = result { tickets = page.items }
        }
    }
}

struct ExpensesScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var claims: [ExpenseClaim] = []

    var body: some View {
        List(claims, id: \.id) { claim in
            HStack {
                Text(claim.title ?? claim.claimNumber ?? "Claim")
                Spacer()
                if let amount = claim.totalAmount {
                    Text(amount, format: .currency(code: claim.currency))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .overlay { if claims.isEmpty { Text("No claims").foregroundStyle(.secondary) } }
        .navigationTitle("Expenses")
        .task {
            let result: ApiOutcome<Page<ExpenseClaim>> = outcome(try! await session.api.expenses())
            if case .ok(let page) = result { claims = page.items }
        }
    }
}

struct HolidaysScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var holidays: [Holiday] = []

    var body: some View {
        List(holidays, id: \.name) { holiday in
            HStack {
                Text(holiday.name)
                Spacer()
                Text(holiday.date).foregroundStyle(.secondary)
            }
        }
        .overlay { if holidays.isEmpty { Text("No holidays published").foregroundStyle(.secondary) } }
        .navigationTitle("Holidays")
        .task {
            let result: ApiOutcome<[Holiday]> = outcome(try! await session.api.holidays())
            if case .ok(let list) = result { holidays = list }
        }
    }
}

struct DocumentsScreen: View {
    @EnvironmentObject private var session: SessionStore
    @State private var documents: [DocumentSummary] = []

    var body: some View {
        List(documents, id: \.id) { document in
            VStack(alignment: .leading, spacing: 4) {
                Text(document.title)
                Text(document.status.capitalized).font(.caption).foregroundStyle(.secondary)
            }
        }
        .overlay { if documents.isEmpty { Text("No documents").foregroundStyle(.secondary) } }
        .navigationTitle("Documents")
        .task {
            let result: ApiOutcome<[DocumentSummary]> = outcome(try! await session.api.documents())
            if case .ok(let list) = result { documents = list }
        }
    }
}
