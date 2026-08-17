import Link from "next/link";
import { Building2 } from "lucide-react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Terms of Service",
  description:
    "The terms governing use of Circuvent HRMS — tenant responsibilities, acceptable use, data ownership, service availability and termination.",
  path: "/terms",
});

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p>Last updated: March 24, 2026</p>
          <h2 className="text-lg font-semibold text-foreground">1. Acceptance of Terms</h2>
          <p>By accessing and using Circuvent HRMS, you agree to be bound by these Terms of Service and all applicable laws and regulations.</p>
          <h2 className="text-lg font-semibold text-foreground">2. Service Description</h2>
          <p>Circuvent HRMS is a cloud-based human resource management system offering employee management, attendance tracking, payroll processing, recruitment, performance reviews, and other HR functionalities.</p>
          <h2 className="text-lg font-semibold text-foreground">3. Subscription Plans</h2>
          <p>Access to the platform is provided through subscription plans (Starter, Professional, Enterprise). Pricing is per employee per month. A 14-day free trial is available for new accounts.</p>
          <h2 className="text-lg font-semibold text-foreground">4. User Responsibilities</h2>
          <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You agree to provide accurate information and comply with all applicable laws.</p>
          <h2 className="text-lg font-semibold text-foreground">5. Data Ownership</h2>
          <p>You retain ownership of all data you enter into the platform. We do not share, sell, or use your data for purposes other than providing the service.</p>
          <h2 className="text-lg font-semibold text-foreground">6. Limitation of Liability</h2>
          <p>Circuvent Technologies shall not be liable for any indirect, incidental, special, or consequential damages arising from the use of our services.</p>
          <h2 className="text-lg font-semibold text-foreground">7. Contact</h2>
          <p>For questions about these terms, contact us at legal@circuvent.com</p>
        </div>
      </div>
    </div>
  );
}
