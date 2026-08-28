import { ogImageResponse, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { OG_CARD } from "@/lib/seo";

export const alt = "Circuvent HRMS — hire to retire, in one system, at hrms.circuvent.com";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return ogImageResponse(OG_CARD);
}
