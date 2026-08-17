import { ogImageResponse, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Careers at Circuvent Technologies — open engineering, AI and IoT roles";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function CareersOpengraphImage() {
  return ogImageResponse({
    product: "Careers",
    domain: "hrms.circuvent.com/careers",
    headline: "Build What",
    headlineAccent: "Comes Next.",
    tagline: "Engineering · AI · IoT · Product · Design",
    accent: "#a78bfa",
    accentAlt: "#7c3aed",
    stats: [
      { value: "Hybrid", label: "Ways Of Working" },
      { value: "4 Rounds", label: "Interview Process" },
      { value: "India", label: "Based" },
    ],
  });
}
