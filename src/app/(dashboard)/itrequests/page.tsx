import { redirect } from "next/navigation";

/** IT requests live in the unified helpdesk — this route is kept for bookmarks. */
export default function ITRequestsPage() {
  redirect("/helpdesk");
}
