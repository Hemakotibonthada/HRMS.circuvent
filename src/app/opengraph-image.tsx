import { headers } from "next/headers";
import { ogImageResponse, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { portalOgCard } from "@/lib/seo";
import { HRMS_PORTALS, PORTAL_HEADER, type HrmsPortal } from "@/lib/hrms-portals";

export const alt = "Circuvent HRMS — link preview";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function OpengraphImage() {
  const requested = (await headers()).get(PORTAL_HEADER) ?? "hrms";
  const portal: HrmsPortal = Object.hasOwn(HRMS_PORTALS, requested)
    ? (requested as HrmsPortal)
    : "hrms";
  return ogImageResponse(portalOgCard(portal));
}
