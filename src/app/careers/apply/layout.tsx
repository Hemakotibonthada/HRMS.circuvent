import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Apply for a role",
  description:
    "Submit your application to Circuvent Technologies — upload a CV, tell us which role you are interested in, and track the outcome.",
  path: "/careers/apply",
});

export default function CareersApplyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
