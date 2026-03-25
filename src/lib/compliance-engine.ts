// ═══════════════════════════════════════════════════════════════
// HR COMPLIANCE & REGULATORY ENGINE
// Indian labor law compliance checks, statutory due dates,
// document requirements, and compliance scoring
// ═══════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────

export type ComplianceCategory = "statutory" | "tax" | "labor" | "safety" | "data_privacy" | "training";
export type ComplianceStatus = "compliant" | "due_soon" | "overdue" | "not_started";
export type CompliancePriority = "low" | "medium" | "high" | "critical";

export interface ComplianceItem {
  id: string;
  name: string;
  category: ComplianceCategory;
  description: string;
  frequency: "monthly" | "quarterly" | "half_yearly" | "annual" | "one_time";
  dueDate: string;
  status: ComplianceStatus;
  priority: CompliancePriority;
  assignee: string;
  department: string;
  filingUrl?: string;
  penalty?: string;
  lastFiledDate?: string;
  nextDueDate?: string;
  evidence?: string[];
  notes?: string;
}

export interface ComplianceScore {
  overall: number;
  byCategory: Record<ComplianceCategory, { score: number; total: number; compliant: number; overdue: number }>;
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendations: string[];
}

// ─── Statutory Compliance Items (India) ──────────────────────

export const STATUTORY_COMPLIANCE_ITEMS: Omit<ComplianceItem, "id" | "status" | "lastFiledDate" | "evidence">[] = [
  // PF Compliance
  {
    name: "EPF Monthly Contribution",
    category: "statutory",
    description: "Employee Provident Fund contribution deposit with EPFO for all eligible employees",
    frequency: "monthly",
    dueDate: "15th of following month",
    priority: "critical",
    assignee: "Finance",
    department: "Finance",
    filingUrl: "https://unifiedportal-mem.epfindia.gov.in",
    penalty: "12% per annum on delayed deposit + inspection charges",
    nextDueDate: "",
  },
  {
    name: "EPF ECR Filing",
    category: "statutory",
    description: "Electronic Challan cum Return filing with member-wise PF contribution details",
    frequency: "monthly",
    dueDate: "15th of following month",
    priority: "critical",
    assignee: "Finance",
    department: "Finance",
    filingUrl: "https://unifiedportal-emp.epfindia.gov.in",
    penalty: "₹5,000 - ₹25,000 per month of default",
  },
  {
    name: "EPF Annual Return (Form 3A/6A)",
    category: "statutory",
    description: "Annual consolidated PF statement for all members",
    frequency: "annual",
    dueDate: "April 30",
    priority: "high",
    assignee: "Finance",
    department: "Finance",
    penalty: "₹10,000 + ₹100/day for each day of default",
  },

  // ESI Compliance
  {
    name: "ESI Monthly Contribution",
    category: "statutory",
    description: "Employee State Insurance contribution for employees earning up to ₹21,000/month",
    frequency: "monthly",
    dueDate: "15th of following month",
    priority: "high",
    assignee: "Finance",
    department: "Finance",
    filingUrl: "https://www.esic.in",
    penalty: "12% per annum simple interest on delayed payment",
  },
  {
    name: "ESI Return Filing",
    category: "statutory",
    description: "Half-yearly ESI return with employee contribution details",
    frequency: "half_yearly",
    dueDate: "May 12 (April period) / November 11 (October period)",
    priority: "high",
    assignee: "Finance",
    department: "Finance",
    penalty: "₹1,000 for first day + ₹100 per day thereafter",
  },

  // Tax Compliance
  {
    name: "TDS Monthly Deposit",
    category: "tax",
    description: "Tax Deducted at Source deposit with Income Tax department",
    frequency: "monthly",
    dueDate: "7th of following month",
    priority: "critical",
    assignee: "Finance",
    department: "Finance",
    filingUrl: "https://www.incometax.gov.in",
    penalty: "1.5% per month simple interest + penalty under Section 271C",
  },
  {
    name: "TDS Quarterly Return (Form 24Q)",
    category: "tax",
    description: "Quarterly TDS return for salary payments with employee-wise deduction details",
    frequency: "quarterly",
    dueDate: "July 31 (Q1) / October 31 (Q2) / January 31 (Q3) / May 31 (Q4)",
    priority: "critical",
    assignee: "Finance",
    department: "Finance",
    filingUrl: "https://www.incometax.gov.in",
    penalty: "₹200 per day of delay (max: TDS amount) + prosecution",
  },
  {
    name: "Form 16 Issuance",
    category: "tax",
    description: "Annual TDS certificate to all employees for income tax filing",
    frequency: "annual",
    dueDate: "June 15",
    priority: "high",
    assignee: "Finance",
    department: "Finance",
    penalty: "₹100 per day per employee for delayed issuance",
  },
  {
    name: "Form 12BA",
    category: "tax",
    description: "Statement of perquisites and profits in lieu of salary",
    frequency: "annual",
    dueDate: "June 15",
    priority: "medium",
    assignee: "Finance",
    department: "Finance",
  },

  // Professional Tax
  {
    name: "Professional Tax Deduction & Deposit",
    category: "tax",
    description: "State-level professional tax deduction and deposit (varies by state)",
    frequency: "monthly",
    dueDate: "Varies by state (typically 15th/20th of following month)",
    priority: "high",
    assignee: "Finance",
    department: "Finance",
    penalty: "2% per month penalty on delayed payment",
  },
  {
    name: "Professional Tax Annual Return",
    category: "tax",
    description: "Annual PT return filing with state commercial tax department",
    frequency: "annual",
    dueDate: "Varies by state",
    priority: "medium",
    assignee: "Finance",
    department: "Finance",
  },

  // Labor Law Compliance
  {
    name: "Minimum Wages Compliance",
    category: "labor",
    description: "Ensure all employees are paid at least the minimum wage as per state notification",
    frequency: "half_yearly",
    dueDate: "Ongoing (review every 6 months)",
    priority: "critical",
    assignee: "HR",
    department: "HR",
    penalty: "Multiple of amount short-paid + imprisonment up to 5 years",
  },
  {
    name: "Payment of Gratuity",
    category: "labor",
    description: "Gratuity payment to employees completing 5+ years of service",
    frequency: "one_time",
    dueDate: "Within 30 days of separation",
    priority: "high",
    assignee: "Finance",
    department: "Finance",
    penalty: "Simple interest for delay + ₹10,000 fine",
  },
  {
    name: "Payment of Bonus (Annual)",
    category: "labor",
    description: "Minimum 8.33% bonus under Payment of Bonus Act for eligible employees",
    frequency: "annual",
    dueDate: "Within 8 months of close of financial year",
    priority: "high",
    assignee: "Finance",
    department: "Finance",
    penalty: "₹1,000-₹5,000 fine + imprisonment up to 6 months",
  },
  {
    name: "Equal Remuneration Compliance",
    category: "labor",
    description: "Ensure equal pay for equal work regardless of gender",
    frequency: "annual",
    dueDate: "Ongoing (annual review)",
    priority: "high",
    assignee: "HR",
    department: "HR",
    penalty: "Fine + imprisonment up to 6 months",
  },
  {
    name: "Maternity Benefit Compliance",
    category: "labor",
    description: "26 weeks paid maternity leave, creche facility for 50+ employees",
    frequency: "annual",
    dueDate: "Ongoing",
    priority: "high",
    assignee: "HR",
    department: "HR",
    penalty: "₹5,000-₹50,000 fine",
  },
  {
    name: "Sexual Harassment Prevention (POSH)",
    category: "labor",
    description: "Internal Complaints Committee, annual report, awareness training",
    frequency: "annual",
    dueDate: "January 31 (annual report)",
    priority: "critical",
    assignee: "HR",
    department: "HR",
    penalty: "₹50,000 fine + cancellation of business license for repeated offense",
  },

  // Safety & Workplace
  {
    name: "Fire Safety Certificate",
    category: "safety",
    description: "Fire NOC from local fire department for office premises",
    frequency: "annual",
    dueDate: "Varies (typically annual renewal)",
    priority: "high",
    assignee: "Admin",
    department: "Operations",
    penalty: "Closure order + criminal prosecution",
  },
  {
    name: "Building Safety Audit",
    category: "safety",
    description: "Structural safety certificate from authorized engineer",
    frequency: "annual",
    dueDate: "Varies",
    priority: "medium",
    assignee: "Admin",
    department: "Operations",
  },
  {
    name: "First Aid & Emergency Preparedness",
    category: "safety",
    description: "First aid kits, emergency exits, evacuation drills",
    frequency: "quarterly",
    dueDate: "Quarterly drills",
    priority: "medium",
    assignee: "Admin",
    department: "Operations",
  },

  // Data Privacy
  {
    name: "Data Protection Policy Review",
    category: "data_privacy",
    description: "Review and update data protection and privacy policies (IT Act, DPDP Act)",
    frequency: "annual",
    dueDate: "Annually",
    priority: "high",
    assignee: "IT",
    department: "IT",
    penalty: "Up to ₹250 Cr under DPDP Act 2023",
  },
  {
    name: "Data Breach Response Plan",
    category: "data_privacy",
    description: "Maintain and test data breach notification and response procedures",
    frequency: "annual",
    dueDate: "Annually",
    priority: "high",
    assignee: "IT",
    department: "IT",
  },
  {
    name: "Employee Data Consent Management",
    category: "data_privacy",
    description: "Ensure consent collection for processing employee personal data",
    frequency: "one_time",
    dueDate: "At onboarding",
    priority: "medium",
    assignee: "HR",
    department: "HR",
  },

  // Training Compliance
  {
    name: "POSH Awareness Training",
    category: "training",
    description: "Prevention of Sexual Harassment awareness training for all employees",
    frequency: "annual",
    dueDate: "Annual (within 30 days for new joiners)",
    priority: "critical",
    assignee: "HR",
    department: "HR",
    penalty: "Part of POSH compliance - ₹50,000 fine for non-compliance",
  },
  {
    name: "Data Privacy Training",
    category: "training",
    description: "Employee awareness training on data handling and privacy obligations",
    frequency: "annual",
    dueDate: "Annual",
    priority: "high",
    assignee: "IT",
    department: "IT",
  },
  {
    name: "Safety & Emergency Training",
    category: "training",
    description: "Fire safety, evacuation, first aid training for all employees",
    frequency: "annual",
    dueDate: "Annual",
    priority: "medium",
    assignee: "Admin",
    department: "Operations",
  },
  {
    name: "Code of Conduct Training",
    category: "training",
    description: "Annual ethics, code of conduct, and anti-bribery training",
    frequency: "annual",
    dueDate: "Annual",
    priority: "medium",
    assignee: "HR",
    department: "HR",
  },
];

// ─── Compliance Scoring ──────────────────────────────────────

export function calculateComplianceScore(items: ComplianceItem[]): ComplianceScore {
  if (items.length === 0) {
    return {
      overall: 100,
      byCategory: {} as ComplianceScore["byCategory"],
      riskLevel: "low",
      recommendations: ["Add compliance items to start tracking"],
    };
  }

  const categoryMap = new Map<ComplianceCategory, { compliant: number; total: number; overdue: number }>();

  items.forEach(item => {
    const cat = item.category;
    const existing = categoryMap.get(cat) || { compliant: 0, total: 0, overdue: 0 };
    existing.total += 1;
    if (item.status === "compliant") existing.compliant += 1;
    if (item.status === "overdue") existing.overdue += 1;
    categoryMap.set(cat, existing);
  });

  const totalItems = items.length;
  const compliantItems = items.filter(i => i.status === "compliant").length;
  const overdueItems = items.filter(i => i.status === "overdue").length;
  const overall = totalItems > 0 ? Math.round((compliantItems / totalItems) * 100) : 0;

  const byCategory: ComplianceScore["byCategory"] = {} as ComplianceScore["byCategory"];
  categoryMap.forEach((data, category) => {
    byCategory[category] = {
      score: data.total > 0 ? Math.round((data.compliant / data.total) * 100) : 0,
      total: data.total,
      compliant: data.compliant,
      overdue: data.overdue,
    };
  });

  // Determine risk level
  let riskLevel: ComplianceScore["riskLevel"] = "low";
  const criticalOverdue = items.filter(i => i.status === "overdue" && (i.priority === "critical" || i.priority === "high")).length;
  if (criticalOverdue > 3) riskLevel = "critical";
  else if (criticalOverdue > 1) riskLevel = "high";
  else if (overdueItems > 3) riskLevel = "medium";

  // Generate recommendations
  const recommendations: string[] = [];
  if (overdueItems > 0) recommendations.push(`${overdueItems} compliance items are overdue — address immediately`);
  const criticalPending = items.filter(i => i.priority === "critical" && i.status !== "compliant");
  if (criticalPending.length > 0) recommendations.push(`${criticalPending.length} critical compliance items need attention`);
  const trainingGaps = items.filter(i => i.category === "training" && i.status !== "compliant");
  if (trainingGaps.length > 0) recommendations.push(`${trainingGaps.length} mandatory training requirements are incomplete`);
  if (overall < 80) recommendations.push("Overall compliance score is below 80% — review all pending items");
  if (recommendations.length === 0) recommendations.push("Compliance posture is healthy — maintain current standards");

  return { overall, byCategory, riskLevel, recommendations };
}

// ─── Due Date Calculator ─────────────────────────────────────

export function getNextDueDate(frequency: ComplianceItem["frequency"], currentDate: Date = new Date()): Date {
  const result = new Date(currentDate);
  switch (frequency) {
    case "monthly":
      result.setMonth(result.getMonth() + 1);
      result.setDate(15);
      break;
    case "quarterly":
      result.setMonth(result.getMonth() + 3 - (result.getMonth() % 3));
      result.setDate(1);
      break;
    case "half_yearly":
      result.setMonth(result.getMonth() + 6);
      result.setDate(1);
      break;
    case "annual":
      result.setFullYear(result.getFullYear() + 1);
      result.setMonth(3); // April
      result.setDate(30);
      break;
    case "one_time":
      result.setDate(result.getDate() + 30);
      break;
  }
  return result;
}

export function getDaysUntilDue(dueDate: Date): number {
  const now = new Date();
  return Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function getComplianceStatus(dueDate: Date): ComplianceStatus {
  const daysLeft = getDaysUntilDue(dueDate);
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "due_soon";
  return "compliant";
}

// ─── Category Labels & Config ────────────────────────────────

export const COMPLIANCE_CATEGORIES: Record<ComplianceCategory, { label: string; icon: string; color: string; description: string }> = {
  statutory: { label: "Statutory", icon: "⚖️", color: "from-violet-500 to-purple-600", description: "PF, ESI, and statutory contributions" },
  tax: { label: "Tax", icon: "💰", color: "from-red-500 to-orange-500", description: "TDS, professional tax, and tax returns" },
  labor: { label: "Labor Law", icon: "👷", color: "from-blue-500 to-cyan-500", description: "Minimum wages, gratuity, bonus, POSH" },
  safety: { label: "Safety", icon: "🛡️", color: "from-emerald-500 to-green-600", description: "Fire safety, building safety, emergency preparedness" },
  data_privacy: { label: "Data Privacy", icon: "🔒", color: "from-amber-500 to-orange-500", description: "DPDP Act, data protection, breach management" },
  training: { label: "Training", icon: "📚", color: "from-pink-500 to-rose-600", description: "Mandatory compliance training programs" },
};

export const COMPLIANCE_STATUS_COLORS: Record<ComplianceStatus, { label: string; className: string }> = {
  compliant: { label: "Compliant", className: "status-active" },
  due_soon: { label: "Due Soon", className: "status-pending" },
  overdue: { label: "Overdue", className: "status-rejected" },
  not_started: { label: "Not Started", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

export const COMPLIANCE_PRIORITY_COLORS: Record<CompliancePriority, { label: string; className: string }> = {
  low: { label: "Low", className: "status-inactive" },
  medium: { label: "Medium", className: "status-pending" },
  high: { label: "High", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  critical: { label: "Critical", className: "status-rejected" },
};
