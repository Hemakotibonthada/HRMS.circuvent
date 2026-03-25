import Link from "next/link";
import { Building2 } from "lucide-react";

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
        <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p>Last updated: March 24, 2026</p>
          <h2 className="text-lg font-semibold text-foreground">1. Information We Collect</h2>
          <p>Circuvent HRMS collects information you provide directly, including name, email, company details, and employee data entered into the platform. We also collect usage data to improve our services.</p>
          <h2 className="text-lg font-semibold text-foreground">2. How We Use Your Information</h2>
          <p>We use collected information to provide and improve our HRMS services, process subscriptions, send service notifications, and ensure platform security.</p>
          <h2 className="text-lg font-semibold text-foreground">3. Data Security</h2>
          <p>We implement industry-standard security measures including encryption at rest and in transit, role-based access controls, and regular security audits to protect your data.</p>
          <h2 className="text-lg font-semibold text-foreground">4. Data Retention</h2>
          <p>We retain your data for as long as your account is active. Upon account deletion, data is permanently removed within 30 days.</p>
          <h2 className="text-lg font-semibold text-foreground">5. Third-Party Services</h2>
          <p>We use Firebase (Google Cloud) for authentication, database, and storage. Your data is processed in accordance with Google Cloud&apos;s security standards.</p>
          <h2 className="text-lg font-semibold text-foreground">6. Contact</h2>
          <p>For privacy inquiries, contact us at privacy@circuvent.com</p>
        </div>
      </div>
    </div>
  );
}
