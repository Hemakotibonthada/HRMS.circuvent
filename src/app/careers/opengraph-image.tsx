import { ogImageResponse, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Careers at Circuvent Technologies — open engineering, AI and IoT roles";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function CareersOpengraphImage() {
  return ogImageResponse({
    product: "Careers",
    domain: "hrms.circuvent.com/careers",
    headline: "Build what comes next",
    description:
      "Open roles at Circuvent Technologies across engineering, AI, IoT, product and design — what each team is building, and how to apply.",
    accent: "#2e1065",
  });
}