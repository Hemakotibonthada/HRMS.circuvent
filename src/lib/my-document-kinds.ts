// Classifies issued documents for the employee "My documents" screen.

export type MyDocumentKind =
  | "appointment_letter"
  | "joining_letter"
  | "offer_letter"
  | "compensation_letter"
  | "confirmation_letter"
  | "relieving_letter"
  | "experience_certificate"
  | "appraisal_letter"
  | "other_letter";

export function classifyMyDocument(doc: { title: string; category: string }): MyDocumentKind {
  const title = doc.title.toLowerCase();
  const category = doc.category.toLowerCase();

  if (title.includes("appointment")) return "appointment_letter";
  if (title.includes("joining")) return "joining_letter";
  if (category === "compensation_revision" || title.includes("compensation")) {
    return "compensation_letter";
  }
  if (title.includes("confirmation")) return "confirmation_letter";
  if (title.includes("relieving")) return "relieving_letter";
  if (title.includes("experience")) return "experience_certificate";
  if (title.includes("appraisal") || title.includes("performance review")) {
    return "appraisal_letter";
  }
  if (category === "offer" || title.includes("offer")) return "offer_letter";
  return "other_letter";
}

export function kindLabel(kind: MyDocumentKind): string {
  const labels: Record<MyDocumentKind, string> = {
    appointment_letter: "Appointment letter",
    joining_letter: "Joining letter",
    offer_letter: "Offer letter",
    compensation_letter: "Compensation revision",
    confirmation_letter: "Confirmation letter",
    relieving_letter: "Relieving letter",
    experience_certificate: "Experience certificate",
    appraisal_letter: "Appraisal letter",
    other_letter: "Letter",
  };
  return labels[kind];
}

export const EMPLOYMENT_KINDS: MyDocumentKind[] = [
  "appointment_letter",
  "joining_letter",
  "offer_letter",
  "confirmation_letter",
];
