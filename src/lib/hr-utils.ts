// ═══════════════════════════════════════════════════════════════
// HR DATA UTILITIES & FORMATTERS
// Comprehensive utility library for HRMS data processing,
// formatting, calculations, and business logic
// ═══════════════════════════════════════════════════════════════

// ─── Currency & Number Formatting ────────────────────────────

export function formatCurrency(amount: number, currency = "INR"): string {
  if (currency === "INR") {
    return "₹" + amount.toLocaleString("en-IN");
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCurrencyShort(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount}`;
}

export function formatNumber(num: number): string {
  return num.toLocaleString("en-IN");
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatCompact(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

// ─── Date & Time Formatting ──────────────────────────────────

export function formatDate(date: Date | string, format: "full" | "short" | "relative" | "iso" = "short"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Invalid date";

  switch (format) {
    case "full":
      return d.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    case "short":
      return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
    case "relative":
      return getRelativeTime(d);
    case "iso":
      return d.toISOString().split("T")[0];
    default:
      return d.toLocaleDateString("en-IN");
  }
}

export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${formatDate(d)} ${formatTime(d)}`;
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 4) return `${diffWeek}w ago`;
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return formatDate(date, "short");
}

export function getBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

export function getMonthName(month: number): string {
  return new Date(2000, month, 1).toLocaleString("en-US", { month: "long" });
}

export function getMonthShort(month: number): string {
  return new Date(2000, month, 1).toLocaleString("en-US", { month: "short" });
}

export function getFinancialYear(date: Date = new Date()): string {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `FY${year}-${(year + 1).toString().slice(-2)}`;
}

export function getQuarter(date: Date = new Date()): string {
  const month = date.getMonth();
  const fyStart = month >= 3 ? month - 3 : month + 9;
  return `Q${Math.floor(fyStart / 3) + 1}`;
}

// ─── HR Calculations ─────────────────────────────────────────

export function calculateTenure(joiningDate: Date | string): { years: number; months: number; days: number; label: string } {
  const start = typeof joiningDate === "string" ? new Date(joiningDate) : joiningDate;
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();

  if (days < 0) { months--; days += 30; }
  if (months < 0) { years--; months += 12; }

  let label = "";
  if (years > 0) label += `${years} yr${years !== 1 ? "s" : ""}`;
  if (months > 0) label += `${label ? " " : ""}${months} mo${months !== 1 ? "s" : ""}`;
  if (!label) label = `${days} day${days !== 1 ? "s" : ""}`;

  return { years, months, days, label };
}

export function calculateAge(dob: Date | string): number {
  const birth = typeof dob === "string" ? new Date(dob) : dob;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export function calculateLeaveDays(from: Date, to: Date, excludeWeekends = true): number {
  if (excludeWeekends) return getBusinessDays(from, to);
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

export function calculateAttritionRate(exits: number, avgHeadcount: number): number {
  if (avgHeadcount === 0) return 0;
  return +((exits / avgHeadcount) * 100).toFixed(1);
}

export function calculateEngagementScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
}

// ─── Salary & Tax Calculations (India) ───────────────────────

interface TaxBreakdown {
  grossSalary: number;
  basicPay: number;
  hra: number;
  specialAllowance: number;
  pf: number;
  professionalTax: number;
  incomeTax: number;
  netSalary: number;
  ctc: number;
  employerPf: number;
  gratuity: number;
}

export function calculateSalaryBreakdown(ctc: number): TaxBreakdown {
  const basicPay = Math.round(ctc * 0.40);
  const hra = Math.round(basicPay * 0.50);
  const employerPf = Math.min(Math.round(basicPay * 0.12), 21600 * 12);
  const gratuity = Math.round(basicPay * 0.0481);
  const specialAllowance = ctc - basicPay - hra - employerPf - gratuity;
  const grossSalary = basicPay + hra + specialAllowance;

  const pf = Math.min(Math.round(basicPay * 0.12), 21600 * 12);
  const professionalTax = 2400;
  const taxableIncome = grossSalary - pf - 50000; // Standard deduction
  const incomeTax = calculateNewRegimeTax(taxableIncome);
  const netSalary = grossSalary - pf - professionalTax - incomeTax;

  return { grossSalary, basicPay, hra, specialAllowance, pf, professionalTax, incomeTax, netSalary, ctc, employerPf, gratuity };
}

export function calculateNewRegimeTax(taxableIncome: number): number {
  if (taxableIncome <= 400000) return 0;
  let tax = 0;
  const slabs = [
    { limit: 400000, rate: 0 },
    { limit: 800000, rate: 0.05 },
    { limit: 1200000, rate: 0.10 },
    { limit: 1600000, rate: 0.15 },
    { limit: 2000000, rate: 0.20 },
    { limit: 2400000, rate: 0.25 },
    { limit: Infinity, rate: 0.30 },
  ];

  let remaining = taxableIncome;
  let prevLimit = 0;

  for (const slab of slabs) {
    const taxable = Math.min(remaining, slab.limit - prevLimit);
    if (taxable <= 0) break;
    tax += taxable * slab.rate;
    remaining -= taxable;
    prevLimit = slab.limit;
  }

  // Cess 4%
  tax = Math.round(tax * 1.04);

  // Section 87A rebate
  if (taxableIncome <= 700000) tax = 0;

  return tax;
}

export function calculateOldRegimeTax(taxableIncome: number): number {
  if (taxableIncome <= 250000) return 0;
  let tax = 0;
  if (taxableIncome > 250000) tax += Math.min(taxableIncome - 250000, 250000) * 0.05;
  if (taxableIncome > 500000) tax += Math.min(taxableIncome - 500000, 500000) * 0.20;
  if (taxableIncome > 1000000) tax += (taxableIncome - 1000000) * 0.30;
  tax = Math.round(tax * 1.04);
  if (taxableIncome <= 500000) tax = 0;
  return tax;
}

export function calculateEMI(principal: number, ratePerAnnum: number, tenureMonths: number): number {
  const monthlyRate = ratePerAnnum / 12 / 100;
  if (monthlyRate === 0) return Math.round(principal / tenureMonths);
  const emi = principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  return Math.round(emi);
}

export function calculateGratuity(lastDrawnSalary: number, yearsOfService: number): number {
  if (yearsOfService < 5) return 0;
  return Math.round((lastDrawnSalary * 15 * yearsOfService) / 26);
}

// ─── String Utilities ────────────────────────────────────────

export function getInitials(name: string, maxLength = 2): string {
  return name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, maxLength);
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function titleCase(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural ?? singular + "s"}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const masked = local.length <= 2 ? local : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return phone;
  return "*".repeat(phone.length - 4) + phone.slice(-4);
}

// ─── Validation Utilities ────────────────────────────────────

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone.replace(/[\s-+()]/g, ""));
}

export function isValidPAN(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase());
}

export function isValidAadhaar(aadhaar: string): boolean {
  return /^\d{12}$/.test(aadhaar.replace(/\s/g, ""));
}

export function isValidIFSC(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase());
}

export function isValidGST(gst: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z0-9]$/.test(gst.toUpperCase());
}

export function isStrongPassword(password: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 8) errors.push("Minimum 8 characters");
  if (!/[A-Z]/.test(password)) errors.push("At least one uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("At least one lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("At least one number");
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) errors.push("At least one special character");
  return { isValid: errors.length === 0, errors };
}

// ─── Color Utilities ─────────────────────────────────────────

export function getContrastColor(hex: string): string {
  const rgb = parseInt(hex.replace("#", ""), 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 128 ? "#000000" : "#ffffff";
}

export function generateAvatarColor(name: string): string {
  const colors = [
    "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899",
    "#ef4444", "#6366f1", "#14b8a6", "#f97316", "#a855f7",
    "#3b82f6", "#22c55e", "#eab308", "#e11d48", "#0ea5e9",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export const GRADIENT_PAIRS = [
  "from-violet-500 to-purple-600",
  "from-blue-500 to-cyan-500",
  "from-emerald-500 to-green-600",
  "from-amber-500 to-orange-500",
  "from-pink-500 to-rose-600",
  "from-teal-500 to-cyan-600",
  "from-indigo-500 to-blue-600",
  "from-red-500 to-orange-500",
  "from-fuchsia-500 to-pink-500",
  "from-purple-500 to-violet-600",
] as const;

export function getGradient(index: number): string {
  return GRADIENT_PAIRS[index % GRADIENT_PAIRS.length];
}

// ─── Array Utilities ─────────────────────────────────────────

export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const group = String(item[key]);
    if (!groups[group]) groups[group] = [];
    groups[group].push(item);
    return groups;
  }, {} as Record<string, T[]>);
}

export function sortBy<T>(array: T[], key: keyof T, direction: "asc" | "desc" = "asc"): T[] {
  return [...array].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal === bVal) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const comp = aVal < bVal ? -1 : 1;
    return direction === "asc" ? comp : -comp;
  });
}

export function uniqueBy<T>(array: T[], key: keyof T): T[] {
  const seen = new Set();
  return array.filter(item => {
    const val = item[key];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function sum(array: number[]): number {
  return array.reduce((a, b) => a + b, 0);
}

export function average(array: number[]): number {
  if (array.length === 0) return 0;
  return sum(array) / array.length;
}

export function median(array: number[]): number {
  if (array.length === 0) return 0;
  const sorted = [...array].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(array: number[], p: number): number {
  if (array.length === 0) return 0;
  const sorted = [...array].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// ─── File Utilities ──────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function isImageFile(filename: string): boolean {
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(getFileExtension(filename));
}

export function isDocumentFile(filename: string): boolean {
  return ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"].includes(getFileExtension(filename));
}

// ─── Export / Download ───────────────────────────────────────

export function downloadAsCSV<T extends Record<string, unknown>>(data: T[], filename: string): void {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(","),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        const str = val == null ? "" : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(",")
    ),
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function downloadAsJSON<T>(data: T, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ─── Permission Label Helpers ────────────────────────────────

export function getRoleDisplayName(role: string): string {
  const names: Record<string, string> = {
    admin: "Administrator",
    hr: "HR Manager",
    employee: "Employee",
    manager: "Manager",
    finance: "Finance",
    it: "IT Admin",
  };
  return names[role] ?? capitalize(role);
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    active: "status-active",
    inactive: "status-inactive",
    pending: "status-pending",
    approved: "status-active",
    rejected: "status-rejected",
    completed: "status-active",
    cancelled: "status-inactive",
    draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    on_hold: "status-pending",
    overdue: "status-rejected",
  };
  return colors[status] ?? "status-inactive";
}

export function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    low: "status-inactive",
    medium: "status-pending",
    high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    urgent: "status-rejected",
    critical: "status-rejected",
  };
  return colors[priority] ?? "status-inactive";
}
