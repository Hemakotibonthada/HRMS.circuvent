import Link from "next/link";
import { Building2 } from "lucide-react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "How Circuvent HRMS collects, stores and protects employee data — including identity documents, payroll records and attendance — who can access it, and how long it is kept.",
  path: "/privacy",
});

/**
 * Privacy policy.
 *
 * This page is a Play Store dependency, not only a legal one: the listing
 * cannot be published without a policy URL, and the reviewer checks that the
 * policy actually describes the data the app collects. The mobile section
 * below exists for that reason and must be kept in step with
 * `mobile/store/play/data-safety.md` — if the two disagree, the one that was
 * wrong is the one the reviewer read.
 *
 * The previous version named Firebase as the processor for authentication,
 * database and storage. Firebase was removed from this product; saying
 * otherwise in a privacy policy is a false statement about where personal data
 * is held.
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
              <Building2 className="h-4 w-4" />
            </div>
            <span className="font-bold text-sm">Circuvent HRMS</span>
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Applies to the Circuvent HRMS web application and the Circuvent HR
          mobile app for Android and iOS.
        </p>

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p>Last updated: 15 August 2026</p>

          <section className="rounded-lg border bg-muted/40 p-4">
            <h2 className="text-base font-semibold text-foreground mb-2">
              Who is responsible for your data
            </h2>
            <p>
              If you are an employee using this product, <strong>your employer is the
              data controller</strong> and Circuvent Technologies is the processor acting
              on their instructions. We do not decide what employment data is collected
              about you or how long it is kept — your employer does, within the limits
              of the law that applies to them. Requests about your own record should go
              to your employer&apos;s HR team first; see{" "}
              <a href="#deletion" className="underline text-foreground">
                Access and deletion
              </a>
              .
            </p>
          </section>

          <h2 className="text-lg font-semibold text-foreground">1. Information we collect</h2>
          <p>
            <strong className="text-foreground">Account information.</strong> Name, work
            email address, employee identifier, job title, department and role. This is
            created by your employer, not by you.
          </p>
          <p>
            <strong className="text-foreground">Employment records.</strong> Attendance,
            leave, shifts, payroll and tax figures, performance records, assets issued to
            you, helpdesk tickets and any documents your employer stores against your
            record.
          </p>
          <p>
            <strong className="text-foreground">Authentication data.</strong> A hash of
            your password — never the password itself — and, if enabled, a secret used to
            verify your authenticator app codes.
          </p>
          <p>
            <strong className="text-foreground">Technical data.</strong> IP address and
            device information attached to sign-in events and to the audit log, so that
            unauthorised access can be investigated.
          </p>

          <h2 id="mobile-app" className="text-lg font-semibold text-foreground">
            2. The Circuvent HR mobile app
          </h2>
          <p>
            <strong className="text-foreground">Location.</strong> If your employer has
            configured a geofenced work location, the app reads your device location{" "}
            <strong className="text-foreground">
              only at the moment you tap clock in or clock out
            </strong>
            . The coordinates, their accuracy and the resulting inside-or-outside verdict
            are stored on that attendance record, because that is what a geofenced
            clock-in is. Your employer can see where a punch was made; it cannot see
            where you are at any other time.
          </p>
          <p>
            The app <strong className="text-foreground">cannot</strong> collect location
            in the background. The background location permission is blocked in the app
            manifest itself, not merely left unrequested, so the operating system will
            refuse it even if a future version were to ask.
          </p>
          <p>
            <strong className="text-foreground">Biometrics.</strong> If you turn on
            biometric unlock, the check is performed by your device&apos;s operating
            system. Your fingerprint or face is never sent to us and never leaves your
            device; the app receives only a yes or no. Biometric unlock protects a
            session you already have — it is not a way of signing in.
          </p>
          <p>
            <strong className="text-foreground">Stored on your device.</strong> Your
            sign-in tokens are held in the platform keystore (Keychain on iOS, Keystore
            on Android). Actions taken while you have no connection — a clock-in, a leave
            request — are held in a local database until they can be sent. Payslips are
            deliberately <em>not</em> stored on the device.
          </p>
          <p>
            <strong className="text-foreground">What the app does not do.</strong> There
            is no advertising identifier, no analytics or tracking software, no access to
            your contacts, photos, messages or calendar, and no sale or sharing of any
            data with third parties.
          </p>

          <h2 className="text-lg font-semibold text-foreground">3. How we use information</h2>
          <p>
            To operate the service your employer has bought: recording attendance,
            processing leave and payroll, and meeting statutory obligations such as
            provident fund, employee state insurance, professional tax and income tax
            reporting in India. We do not use employment data for advertising, and we do
            not profile you for any purpose your employer has not configured.
          </p>

          <h2 className="text-lg font-semibold text-foreground">4. Where your data is held</h2>
          <p>
            Application data is stored in Neon (PostgreSQL) and the applications are
            hosted on Vercel. Each customer organisation is isolated at the database
            level by row-level security, so a query that omits an organisation filter
            still cannot return another organisation&apos;s rows. Transport is encrypted
            with TLS; sensitive columns including bank details, government identifiers
            and authenticator secrets are encrypted at rest.
          </p>

          <h2 className="text-lg font-semibold text-foreground">5. Retention</h2>
          <p>
            Retention is set by your employer, subject to the law that applies to them —
            payroll and statutory records generally have to be kept for several years and
            cannot be deleted on request. Where a legal hold is in force, erasure is
            refused and the refusal is recorded.
          </p>

          <h2 id="deletion" className="text-lg font-semibold text-foreground">
            6. Access and deletion
          </h2>
          <p>
            You may ask for a copy of the personal data held about you, or ask for it to
            be erased. <strong className="text-foreground">Send the request to your
            employer&apos;s HR team</strong>, who are the controller; the product provides
            them with subject access export and erasure tools, and every such request is
            logged.
          </p>
          <p>
            If your employer does not act, or you cannot reach them, write to{" "}
            <a href="mailto:privacy@circuvent.com" className="underline text-foreground">
              privacy@circuvent.com
            </a>{" "}
            and we will pass the request on and tell you that we have. We cannot delete
            an employer&apos;s records on your instruction alone — doing so would let one
            person destroy another party&apos;s statutory records.
          </p>
          <p>
            Deleting the mobile app removes everything held on your device. It does not
            delete your employment record, and it is not a deletion request.
          </p>

          <h2 className="text-lg font-semibold text-foreground">7. Children</h2>
          <p>
            This is a workplace product and is not directed at children. We do not
            knowingly collect data from anyone below the minimum working age in their
            jurisdiction.
          </p>

          <h2 className="text-lg font-semibold text-foreground">8. Changes</h2>
          <p>
            Material changes will be notified to the administrators of each customer
            organisation before they take effect. The date at the top of this page always
            reflects the current version.
          </p>

          <h2 className="text-lg font-semibold text-foreground">9. Contact</h2>
          <p>
            Circuvent Technologies —{" "}
            <a href="mailto:privacy@circuvent.com" className="underline text-foreground">
              privacy@circuvent.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
