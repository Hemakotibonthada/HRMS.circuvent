// The careers page is a client component, so its metadata has to live in a
// server layout. This is the one page on the hostname that is meant to rank and
// to be shared outside the company, which is why it gets its own preview card
// rather than inheriting the product one.
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Careers at Circuvent Technologies",
  description:
    "Open roles at Circuvent Technologies across engineering, IoT, AI and product. See what each team is building, what the interview process looks like, and apply online.",
  path: "/careers",
});

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
