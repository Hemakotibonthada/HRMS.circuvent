import { pageMetadata } from "@/lib/seo";

// Sign-in, registration and password reset. All four are thin, gated and
// near-identical to the equivalent pages on every other suite hostname, so they
// are given a canonical and a sensible preview but kept out of the index.
export const metadata = pageMetadata({
  title: "Sign in",
  description:
    "Sign in to Circuvent HRMS to reach your employee profile, attendance, leave, payslips and performance reviews.",
  path: "/login",
  index: false,
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
