"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Package, Plus, Search, CheckCircle2, Clock, DollarSign,
  Monitor, Laptop, Server, Smartphone, HardDrive, AlertTriangle,
  Wrench, ShieldCheck, Calendar, Eye, Trash2, Edit, MoreVertical,
  UserCheck, ArrowDownLeft, RotateCcw, AlertOctagon, HelpCircle,
  FileText, History, TrendingDown, Layers, Building2, RefreshCw,
  LayoutGrid, List, Sparkles, Check, ChevronRight, ShieldAlert,
  AppWindow, Lock, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DeviceInstallPanel } from "@/components/device-install-panel";
import { toast } from "sonner";
import { useRBAC } from "@/hooks/use-rbac";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";

// ═══════════════════════════════════════════════════════════════
// ASSET MANAGEMENT — Enterprise Register, Valuation & Lifecycle
// ═══════════════════════════════════════════════════════════════

export interface AssetRecord {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  categoryId?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  state: "in_stock" | "assigned" | "in_repair" | "lost" | "retired" | "disposed";
  condition: string;
  assignedToId?: string;
  assignedToName?: string;
  purchaseCostMinor?: string;
  bookValueMinor?: string;
  purchaseDate?: string;
  warrantyExpiresOn?: string;
  isUnderWarranty?: boolean;
  warrantyExpiringSoon?: boolean;
  nextServiceDue?: string;
  depreciationMethod?: string;
  usefulLifeMonths?: number;
  salvageValueMinor?: string;
  locationId?: string;
  notes?: string;
}

export interface AssetCategoryRecord {
  id: string;
  name: string;
  code: string;
  defaultUsefulLifeMonths: number;
  defaultMethod: "straight_line" | "declining_balance" | "double_declining" | "none";
  defaultSalvagePercent: number;
  maxPerEmployee: number;
  serviceIntervalMonths: number;
  requiresAcceptance: boolean;
  isActive: boolean;
}

export interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  designation?: string;
  departmentName?: string;
}

export interface DepreciationRow {
  month: number;
  date: string;
  chargeMinor: string;
  accumulatedMinor: string;
  bookValueMinor: string;
}

export interface AssetHistoryData {
  assignments: {
    employeeId: string;
    employeeName?: string;
    issuedAt: string;
    returnedAt?: string;
    conditionOnIssue: string;
    conditionOnReturn?: string;
  }[];
  events: {
    action: string;
    fromState?: string;
    toState?: string;
    detail?: string;
    occurredAt: string;
  }[];
}

export interface ValuationData {
  asOf: string;
  categories: {
    category: string;
    count: number;
    costMinor: string;
    bookValueMinor: string;
  }[];
  totalCostMinor: string;
  totalBookValueMinor: string;
}

export interface InstalledSoftwareRecord {
  id: string;
  name: string;
  version?: string | null;
  publisher?: string | null;
  installDate?: string | null;
  isBlacklisted: boolean;
  category: string;
  riskLevel: string;
  deviceHostname: string;
  deviceId?: string | null;
  employeeId?: string | null;
  updatedAt: string;
}

const STATE_CONFIG: Record<string, { label: string; badgeClass: string; icon: typeof Package; color: string }> = {
  in_stock: { label: "In Stock", badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800", icon: ShieldCheck, color: "text-emerald-500" },
  assigned: { label: "Assigned", badgeClass: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800", icon: UserCheck, color: "text-blue-500" },
  in_repair: { label: "In Repair", badgeClass: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800", icon: Wrench, color: "text-amber-500" },
  lost: { label: "Lost", badgeClass: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800", icon: AlertOctagon, color: "text-rose-500" },
  retired: { label: "Retired", badgeClass: "bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700", icon: RotateCcw, color: "text-gray-500" },
  disposed: { label: "Disposed", badgeClass: "bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800", icon: Trash2, color: "text-zinc-400" },
};

const CATEGORY_ICONS: Record<string, typeof Package> = {
  "Laptops & Notebooks": Laptop,
  Laptop: Laptop,
  "Workstations & Desktops": Monitor,
  "Workstations & Displays": Monitor,
  "Monitors & External Displays": Monitor,
  Monitor: Monitor,
  Desktop: Monitor,
  "Mobile Devices & Tablets": Smartphone,
  Mobile: Smartphone,
  "Servers & Network Equipment": Server,
  "Storage & NAS Devices": Server,
  Server: Server,
  Network: Server,
  "Printers & Scanners": Package,
  "Peripherals & Accessories": Package,
  "Audio / Video Equipment": Package,
  "Conference Room Equipment": Package,
  "Security & Surveillance": ShieldCheck,
  "Office Furniture & Setup": Layers,
  Furniture: Layers,
  "SIM Cards & Telecom": Smartphone,
  "IoT & Smart Devices": Package,
  Wearables: Smartphone,
  "Tools & Field Equipment": Wrench,
  Vehicles: Package,
  "Software Licenses": Package,
  "Other / Miscellaneous": Package,
};

function formatRupees(minorString?: string | null): string {
  if (!minorString) return "₹0";
  const num = Number(BigInt(minorString) / 100n);
  return `₹${num.toLocaleString("en-IN")}`;
}

export default function AssetsPage() {
  const rbac = useRBAC();
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [categories, setCategories] = useState<AssetCategoryRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [valuation, setValuation] = useState<ValuationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Software & SaaS Tab State
  const [softwareList, setSoftwareList] = useState<InstalledSoftwareRecord[]>([]);
  const [softwareSummary, setSoftwareSummary] = useState({
    totalInstallations: 0,
    uniqueApplications: 0,
    blacklistedCount: 0,
    highRiskCount: 0,
    saasProductivityCount: 0,
  });
  const [softwareSearch, setSoftwareSearch] = useState("");
  const [softwareCategoryFilter, setSoftwareCategoryFilter] = useState("all");
  const [softwareRiskFilter, setSoftwareRiskFilter] = useState("all");
  const [softwareBlacklistOnly, setSoftwareBlacklistOnly] = useState(false);
  const [loadingSoftwareTab, setLoadingSoftwareTab] = useState(false);
  const [assetSoftwareList, setAssetSoftwareList] = useState<InstalledSoftwareRecord[]>([]);
  const [loadingAssetSoftware, setLoadingAssetSoftware] = useState(false);

  // Filters & Views
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [conditionFilter, setConditionFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [activeTab, setActiveTab] = useState("inventory");

  // Modals state
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<AssetRecord | null>(null);
  const [detailItem, setDetailItem] = useState<AssetRecord | null>(null);
  const [detailTab, setDetailTab] = useState<"specs" | "schedule" | "history" | "software" | "security">("specs");
  const [scheduleData, setScheduleData] = useState<DepreciationRow[]>([]);
  const [historyData, setHistoryData] = useState<AssetHistoryData | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Action Modals
  const [issueModalItem, setIssueModalItem] = useState<AssetRecord | null>(null);
  const [issueEmployeeId, setIssueEmployeeId] = useState("");
  const [issueCondition, setIssueCondition] = useState("good");

  const [returnModalItem, setReturnModalItem] = useState<AssetRecord | null>(null);
  const [returnCondition, setReturnCondition] = useState("good");
  const [returnNotes, setReturnNotes] = useState("");

  const [faultModalItem, setFaultModalItem] = useState<AssetRecord | null>(null);
  const [faultDesc, setFaultDesc] = useState("");
  const [faultVendor, setFaultVendor] = useState("");

  const [actionLoading, setActionLoading] = useState(false);

  // Form State for Create & Edit
  const [form, setForm] = useState({
    name: "",
    category: "",
    categoryId: "",
    assetTag: "",
    serialNumber: "",
    manufacturer: "",
    model: "",
    purchaseDate: new Date().toISOString().slice(0, 10),
    purchaseCostRupees: "",
    warrantyExpiresOn: "",
    usefulLifeMonths: 36,
    salvageValueRupees: "0",
    depreciationMethod: "straight_line",
    condition: "new",
    assignedToId: "",
    notes: "",
  });

  // Load Software Data
  const loadSoftwareData = useCallback(async () => {
    try {
      setLoadingSoftwareTab(true);
      const params = new URLSearchParams();
      if (softwareSearch) params.set("search", softwareSearch);
      if (softwareCategoryFilter !== "all") params.set("category", softwareCategoryFilter);
      if (softwareRiskFilter !== "all") params.set("riskLevel", softwareRiskFilter);
      if (softwareBlacklistOnly) params.set("isBlacklisted", "true");
      params.set("limit", "200");

      const res = await fetch(`/api/security/devices/software?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSoftwareList(data.software || []);
        if (data.summary) setSoftwareSummary(data.summary);
      }
    } catch (err) {
      console.error("Failed to load software inventory:", err);
    } finally {
      setLoadingSoftwareTab(false);
    }
  }, [softwareSearch, softwareCategoryFilter, softwareRiskFilter, softwareBlacklistOnly]);

  // Load Data
  const loadAllData = useCallback(async () => {
    try {
      setRefreshing(true);
      const [assetsRes, catsRes, empsRes, valRes, swRes] = await Promise.all([
        fetch("/api/assets", { credentials: "include" }),
        fetch("/api/assets/categories", { credentials: "include" }),
        fetch("/api/employees?limit=200", { credentials: "include" }),
        fetch("/api/assets/valuation", { credentials: "include" }),
        fetch("/api/security/devices/software?limit=200"),
      ]);

      if (assetsRes.ok) {
        const data = await assetsRes.json();
        setAssets(data.assets || []);
      }
      if (catsRes.ok) {
        const data = await catsRes.json();
        setCategories(data.categories || []);
      }
      if (empsRes.ok) {
        const data = await empsRes.json();
        const empList = (data.employees || data.data || []).map((e: any) => ({
          id: e.id,
          firstName: e.firstName || e.first_name || "",
          lastName: e.lastName || e.last_name || "",
          workEmail: e.workEmail || e.work_email || "",
          designation: e.designation || "",
          departmentName: e.departmentName || e.department_name || "",
        }));
        setEmployees(empList);
      }
      if (valRes.ok) {
        const data = await valRes.json();
        setValuation(data);
      }
      if (swRes.ok) {
        const data = await swRes.json();
        setSoftwareList(data.software || []);
        if (data.summary) setSoftwareSummary(data.summary);
      }
    } catch (err) {
      console.error("Failed to load asset data:", err);
      toast.error("Could not load asset data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  useEffect(() => {
    if (activeTab === "software") {
      loadSoftwareData();
    }
  }, [activeTab, loadSoftwareData]);

  // Load Schedule when Detail Modal opens
  useEffect(() => {
    if (detailItem && detailTab === "schedule") {
      setLoadingSchedule(true);
      fetch(`/api/assets/${detailItem.id}/schedule`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => setScheduleData(data.schedule || []))
        .catch(() => toast.error("Could not load depreciation schedule"))
        .finally(() => setLoadingSchedule(false));
    }
  }, [detailItem, detailTab]);

  // Load History when Detail Modal opens
  useEffect(() => {
    if (detailItem && detailTab === "history") {
      setLoadingHistory(true);
      fetch(`/api/assets/${detailItem.id}/history`, { credentials: "include" })
        .then((res) => res.json())
        .then((data) => setHistoryData(data))
        .catch(() => toast.error("Could not load asset history"))
        .finally(() => setLoadingHistory(false));
    }
  }, [detailItem, detailTab]);

  // Load Software for specific asset
  useEffect(() => {
    if (detailItem && detailTab === "software") {
      setLoadingAssetSoftware(true);
      const tagClean = detailItem.assetTag?.replace("CIR-AST-", "") || "";
      fetch(`/api/security/devices/software?deviceHostname=${encodeURIComponent(tagClean)}&limit=100`)
        .then((res) => res.json())
        .then((data) => setAssetSoftwareList(data.software || []))
        .catch(() => toast.error("Could not load asset software list"))
        .finally(() => setLoadingAssetSoftware(false));
    }
  }, [detailItem, detailTab]);

  // KPIs
  const totalAssets = assets.length;
  const assignedCount = assets.filter((a) => a.state === "assigned").length;
  const inStockCount = assets.filter((a) => a.state === "in_stock").length;
  const inRepairCount = assets.filter((a) => a.state === "in_repair").length;
  const warrantyAlerts = assets.filter((a) => a.warrantyExpiringSoon);

  const totalGrossCost = useMemo(() => {
    return assets.reduce((sum, a) => {
      const minor = a.purchaseCostMinor ? BigInt(a.purchaseCostMinor) : 0n;
      return sum + minor;
    }, 0n);
  }, [assets]);

  const totalNetBookValue = useMemo(() => {
    return assets.reduce((sum, a) => {
      const minor = a.bookValueMinor ? BigInt(a.bookValueMinor) : 0n;
      return sum + minor;
    }, 0n);
  }, [assets]);

  // Filtered Assets
  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      const matchesSearch =
        !search ||
        a.name?.toLowerCase().includes(search.toLowerCase()) ||
        a.assetTag?.toLowerCase().includes(search.toLowerCase()) ||
        a.serialNumber?.toLowerCase().includes(search.toLowerCase()) ||
        a.assignedToName?.toLowerCase().includes(search.toLowerCase()) ||
        a.manufacturer?.toLowerCase().includes(search.toLowerCase()) ||
        a.model?.toLowerCase().includes(search.toLowerCase());

      const matchesCategory =
        categoryFilter === "all" ||
        a.category === categoryFilter ||
        a.categoryId === categoryFilter;

      const matchesState = stateFilter === "all" || a.state === stateFilter;
      const matchesCondition = conditionFilter === "all" || a.condition === conditionFilter;

      return matchesSearch && matchesCategory && matchesState && matchesCondition;
    });
  }, [assets, search, categoryFilter, stateFilter, conditionFilter]);

  // Category change helper
  const handleCategorySelect = (catIdOrName: string) => {
    const matched = categories.find((c) => c.id === catIdOrName || c.name === catIdOrName);
    if (matched) {
      setForm((prev) => ({
        ...prev,
        category: matched.name,
        categoryId: matched.id,
        usefulLifeMonths: matched.defaultUsefulLifeMonths,
        depreciationMethod: matched.defaultMethod,
      }));
    } else {
      setForm((prev) => ({ ...prev, category: catIdOrName, categoryId: "" }));
    }
  };

  // Create Asset
  const handleCreateSubmit = async () => {
    if (!form.name || !form.category) {
      toast.error("Please enter asset name and category");
      return;
    }
    setActionLoading(true);
    try {
      const costMinor = form.purchaseCostRupees
        ? (BigInt(Math.round(Number(form.purchaseCostRupees))) * 100n).toString()
        : "0";
      const salvageMinor = form.salvageValueRupees
        ? (BigInt(Math.round(Number(form.salvageValueRupees))) * 100n).toString()
        : "0";

      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          categoryId: form.categoryId || undefined,
          assetTag: form.assetTag || undefined,
          serialNumber: form.serialNumber || undefined,
          manufacturer: form.manufacturer || undefined,
          model: form.model || undefined,
          purchaseDate: form.purchaseDate || undefined,
          purchaseCostMinor: costMinor,
          warrantyExpiresOn: form.warrantyExpiresOn || undefined,
          depreciationMethod: form.depreciationMethod,
          usefulLifeMonths: Number(form.usefulLifeMonths) || 36,
          salvageValueMinor: salvageMinor,
          condition: form.condition,
          state: form.assignedToId ? "assigned" : "in_stock",
          assignedToId: form.assignedToId || undefined,
          notes: form.notes || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Failed to create asset");
        return;
      }

      toast.success("Asset registered successfully");
      setCreateOpen(false);
      resetForm();
      loadAllData();
    } catch {
      toast.error("Failed to create asset");
    } finally {
      setActionLoading(false);
    }
  };

  // Edit Asset Submit
  const handleEditSubmit = async () => {
    if (!editItem) return;
    setActionLoading(true);
    try {
      const costMinor = form.purchaseCostRupees
        ? (BigInt(Math.round(Number(form.purchaseCostRupees))) * 100n).toString()
        : "0";
      const salvageMinor = form.salvageValueRupees
        ? (BigInt(Math.round(Number(form.salvageValueRupees))) * 100n).toString()
        : "0";

      const res = await fetch(`/api/assets/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          categoryId: form.categoryId || undefined,
          assetTag: form.assetTag,
          serialNumber: form.serialNumber || undefined,
          manufacturer: form.manufacturer || undefined,
          model: form.model || undefined,
          purchaseDate: form.purchaseDate || undefined,
          purchaseCostMinor: costMinor,
          warrantyExpiresOn: form.warrantyExpiresOn || undefined,
          depreciationMethod: form.depreciationMethod,
          usefulLifeMonths: Number(form.usefulLifeMonths),
          salvageValueMinor: salvageMinor,
          condition: form.condition,
          notes: form.notes || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Failed to update asset");
        return;
      }

      toast.success("Asset updated successfully");
      setEditItem(null);
      loadAllData();
    } catch {
      toast.error("Failed to update asset");
    } finally {
      setActionLoading(false);
    }
  };

  // Issue Asset
  const handleIssueSubmit = async () => {
    if (!issueModalItem || !issueEmployeeId) {
      toast.error("Please select an employee");
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/assets/${issueModalItem.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "issue",
          employeeId: issueEmployeeId,
          condition: issueCondition,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Could not issue asset");
        return;
      }

      toast.success("Asset issued to employee successfully");
      setIssueModalItem(null);
      setIssueEmployeeId("");
      loadAllData();
    } catch {
      toast.error("Could not issue asset");
    } finally {
      setActionLoading(false);
    }
  };

  // Return Asset
  const handleReturnSubmit = async () => {
    if (!returnModalItem) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/assets/${returnModalItem.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "return",
          condition: returnCondition,
          notes: returnNotes || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Could not return asset");
        return;
      }

      toast.success("Asset returned to inventory");
      setReturnModalItem(null);
      setReturnNotes("");
      loadAllData();
    } catch {
      toast.error("Could not return asset");
    } finally {
      setActionLoading(false);
    }
  };

  // Lifecycle Transition
  const handleTransition = async (asset: AssetRecord, action: "send_for_repair" | "repair_complete" | "report_lost" | "recover" | "retire" | "dispose") => {
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || `Failed to ${action.replace(/_/g, " ")}`);
        return;
      }

      toast.success(`Asset status updated: ${action.replace(/_/g, " ")}`);
      loadAllData();
    } catch {
      toast.error("Failed to update status");
    }
  };

  // Report Fault
  const handleFaultSubmit = async () => {
    if (!faultModalItem || !faultDesc) {
      toast.error("Please provide a fault description");
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/assets/${faultModalItem.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "report_fault",
          description: faultDesc,
          vendor: faultVendor || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Could not report fault");
        return;
      }

      const body = await res.json();
      toast.success(
        body.underWarranty
          ? "Fault logged! Asset is covered under active warranty."
          : "Fault logged. Asset is out of warranty."
      );
      setFaultModalItem(null);
      setFaultDesc("");
      setFaultVendor("");
      loadAllData();
    } catch {
      toast.error("Could not report fault");
    } finally {
      setActionLoading(false);
    }
  };

  // Delete Asset
  const handleDelete = async (asset: AssetRecord) => {
    if (!confirm(`Are you sure you want to delete ${asset.name} (${asset.assetTag})?`)) return;
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Could not delete asset");
        return;
      }

      toast.success("Asset removed from register");
      loadAllData();
    } catch {
      toast.error("Could not delete asset");
    }
  };

  const openEditModal = (asset: AssetRecord) => {
    setEditItem(asset);
    setForm({
      name: asset.name,
      category: asset.category,
      categoryId: asset.categoryId || "",
      assetTag: asset.assetTag,
      serialNumber: asset.serialNumber || "",
      manufacturer: asset.manufacturer || "",
      model: asset.model || "",
      purchaseDate: asset.purchaseDate || "",
      purchaseCostRupees: asset.purchaseCostMinor
        ? (Number(BigInt(asset.purchaseCostMinor) / 100n)).toString()
        : "",
      warrantyExpiresOn: asset.warrantyExpiresOn || "",
      usefulLifeMonths: asset.usefulLifeMonths || 36,
      salvageValueRupees: asset.salvageValueMinor
        ? (Number(BigInt(asset.salvageValueMinor) / 100n)).toString()
        : "0",
      depreciationMethod: asset.depreciationMethod || "straight_line",
      condition: asset.condition || "good",
      assignedToId: asset.assignedToId || "",
      notes: asset.notes || "",
    });
  };

  const resetForm = () => {
    setForm({
      name: "",
      category: categories[0]?.name || "Laptops & Notebooks",
      categoryId: categories[0]?.id || "",
      assetTag: "",
      serialNumber: "",
      manufacturer: "",
      model: "",
      purchaseDate: new Date().toISOString().slice(0, 10),
      purchaseCostRupees: "",
      warrantyExpiresOn: "",
      usefulLifeMonths: 36,
      salvageValueRupees: "0",
      depreciationMethod: "straight_line",
      condition: "new",
      assignedToId: "",
      notes: "",
    });
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-md">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
                Asset Management
              </h1>
              <p className="text-sm text-muted-foreground">
                Company hardware, depreciation valuation &amp; custody lifecycle tracking
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadAllData}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>

          {rbac.can("assets.manage") && (
            <Button
              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md hover:opacity-95 gap-2"
              onClick={() => {
                resetForm();
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add Asset
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Assets</p>
                <p className="text-2xl font-bold mt-1">{totalAssets}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatRupees(totalGrossCost.toString())} gross cost</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center text-violet-600">
                <Package className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assigned</p>
                <p className="text-2xl font-bold mt-1 text-blue-600">{assignedCount}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{totalAssets > 0 ? Math.round((assignedCount / totalAssets) * 100) : 0}% in active custody</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center text-blue-600">
                <UserCheck className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">In Stock</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600">{inStockCount}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Available for issuance</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">In Repair / Alert</p>
                <p className="text-2xl font-bold mt-1 text-amber-600">{inRepairCount}</p>
                <p className="text-xs text-amber-600 mt-0.5">{warrantyAlerts.length} warranty alerts</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-600">
                <Wrench className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-card/60 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Net Book Value</p>
                <p className="text-2xl font-bold mt-1 text-indigo-600">{formatRupees(totalNetBookValue.toString())}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Balance sheet value</p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600">
                <TrendingDown className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-2">
          <div className="min-w-0 overflow-x-auto">
            <TabsList className="inline-flex h-auto w-max min-w-full flex-nowrap gap-1 bg-muted/60 p-1">
              <TabsTrigger value="inventory" className="gap-1.5 px-3 text-xs sm:text-sm">
                <Package className="h-4 w-4 shrink-0" /> Inventory ({assets.length})
              </TabsTrigger>
              <TabsTrigger value="valuation" className="gap-1.5 px-3 text-xs sm:text-sm">
                <TrendingDown className="h-4 w-4 shrink-0" /> Valuation
              </TabsTrigger>
              <TabsTrigger value="maintenance" className="gap-1.5 px-3 text-xs sm:text-sm">
                <Wrench className="h-4 w-4 shrink-0" /> Maintenance ({warrantyAlerts.length})
              </TabsTrigger>
              <TabsTrigger value="software" className="gap-1.5 px-3 text-xs sm:text-sm">
                <Layers className="h-4 w-4 shrink-0" /> Software ({softwareSummary.uniqueApplications || softwareList.length})
              </TabsTrigger>
            </TabsList>
          </div>

          {activeTab === "inventory" && (
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-2.5"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "table" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-2.5"
                onClick={() => setViewMode("table")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Tab 1: Asset Inventory */}
        <TabsContent value="inventory" className="space-y-4 mt-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by tag, name, serial number, employee..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px] bg-card">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-[150px] bg-card">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                <SelectItem value="in_stock">In Stock</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="in_repair">In Repair</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
                <SelectItem value="disposed">Disposed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={conditionFilter} onValueChange={setConditionFilter}>
              <SelectTrigger className="w-[140px] bg-card">
                <SelectValue placeholder="Condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Conditions</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
                <SelectItem value="damaged">Damaged</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Results Summary */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>Showing {filteredAssets.length} of {assets.length} assets</span>
            {(search || categoryFilter !== "all" || stateFilter !== "all" || conditionFilter !== "all") && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-violet-600"
                onClick={() => {
                  setSearch("");
                  setCategoryFilter("all");
                  setStateFilter("all");
                  setConditionFilter("all");
                }}
              >
                Clear all filters
              </Button>
            )}
          </div>

          {/* Grid View */}
          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAssets.length === 0 ? (
                <div className="col-span-full py-16 text-center border rounded-2xl bg-card/40">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <h3 className="text-lg font-semibold">No assets found</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                    No equipment matched your filters or search criteria.
                  </p>
                  {rbac.can("assets.manage") && (
                    <Button
                      onClick={() => {
                        resetForm();
                        setCreateOpen(true);
                      }}
                      className="mt-4 gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                    >
                      <Plus className="h-4 w-4" /> Add First Asset
                    </Button>
                  )}
                </div>
              ) : (
                filteredAssets.map((asset) => {
                  const stateCfg = STATE_CONFIG[asset.state] || STATE_CONFIG.in_stock;
                  const CategoryIcon = CATEGORY_ICONS[asset.category] || Package;

                  return (
                    <Card
                      key={asset.id}
                      role="button"
                      tabIndex={0}
                      className="group border hover:border-violet-400/50 hover:shadow-md transition-all duration-200 bg-card/80 backdrop-blur-sm relative overflow-hidden cursor-pointer"
                      onClick={() => {
                        setDetailItem(asset);
                        setDetailTab("specs");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setDetailItem(asset);
                          setDetailTab("specs");
                        }
                      }}
                    >
                      <div className="p-5 space-y-4">
                        {/* Card Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-500/20 flex items-center justify-center text-violet-600 group-hover:scale-105 transition-transform">
                              <CategoryIcon className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-violet-600 bg-violet-50 dark:bg-violet-950/60 px-1.5 py-0.5 rounded border border-violet-200 dark:border-violet-800">
                                  {asset.assetTag}
                                </span>
                                <Badge variant="outline" className={cn("text-xs font-medium border", stateCfg.badgeClass)}>
                                  {stateCfg.label}
                                </Badge>
                              </div>
                              <h3 className="font-semibold text-base mt-1 line-clamp-1 group-hover:text-violet-600 transition-colors">
                                {asset.name}
                              </h3>
                            </div>
                          </div>

                          {/* Action Dropdown */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuLabel>Asset Actions</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => {
                                  setDetailItem(asset);
                                  setDetailTab("specs");
                                }}
                              >
                                <Eye className="h-4 w-4 mr-2" /> View Details &amp; History
                              </DropdownMenuItem>

                              {rbac.can("assets.manage") && (
                                <>
                                  <DropdownMenuSeparator />
                                  {asset.state === "in_stock" && (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setIssueModalItem(asset);
                                        setIssueEmployeeId("");
                                        setIssueCondition(asset.condition || "good");
                                      }}
                                    >
                                      <UserCheck className="h-4 w-4 mr-2 text-blue-600" /> Issue to Employee
                                    </DropdownMenuItem>
                                  )}

                                  {asset.state === "assigned" && (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setReturnModalItem(asset);
                                        setReturnCondition(asset.condition || "good");
                                        setReturnNotes("");
                                      }}
                                    >
                                      <ArrowDownLeft className="h-4 w-4 mr-2 text-emerald-600" /> Return to Inventory
                                    </DropdownMenuItem>
                                  )}

                                  {asset.state === "in_stock" && (
                                    <DropdownMenuItem onClick={() => handleTransition(asset, "send_for_repair")}>
                                      <Wrench className="h-4 w-4 mr-2 text-amber-600" /> Send for Repair
                                    </DropdownMenuItem>
                                  )}

                                  {asset.state === "in_repair" && (
                                    <DropdownMenuItem onClick={() => handleTransition(asset, "repair_complete")}>
                                      <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-600" /> Mark Repair Complete
                                    </DropdownMenuItem>
                                  )}

                                  <DropdownMenuItem
                                    onClick={() => {
                                      setFaultModalItem(asset);
                                      setFaultDesc("");
                                      setFaultVendor(asset.manufacturer || "");
                                    }}
                                  >
                                    <AlertTriangle className="h-4 w-4 mr-2 text-amber-500" /> Report Fault Ticket
                                  </DropdownMenuItem>

                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => openEditModal(asset)}>
                                    <Edit className="h-4 w-4 mr-2 text-muted-foreground" /> Edit Specifications
                                  </DropdownMenuItem>

                                  {asset.state !== "assigned" && (
                                    <DropdownMenuItem onClick={() => handleDelete(asset)} className="text-rose-600">
                                      <Trash2 className="h-4 w-4 mr-2" /> Delete Asset
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {/* Specs row */}
                        <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg">
                          <div>
                            <span className="text-muted-foreground">Serial No:</span>
                            <p className="font-mono font-medium truncate">{asset.serialNumber || "N/A"}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Model / Mfr:</span>
                            <p className="font-medium truncate">{asset.model || asset.manufacturer || "Standard"}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Condition:</span>
                            <p className="font-medium capitalize">{asset.condition || "Good"}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Warranty:</span>
                            <p className={cn("font-medium", asset.warrantyExpiringSoon ? "text-amber-600 font-semibold" : "")}>
                              {asset.warrantyExpiresOn || "N/A"}
                            </p>
                          </div>
                        </div>

                        {/* Financial and Custody footer */}
                        <div className="flex items-center justify-between pt-2 border-t text-xs">
                          <div>
                            <span className="text-muted-foreground">Book Value:</span>
                            <p className="font-bold text-sm text-foreground">
                              {formatRupees(asset.bookValueMinor)}
                            </p>
                          </div>

                          {asset.assignedToName ? (
                            <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-md border border-blue-200 dark:border-blue-800">
                              <UserCheck className="h-3.5 w-3.5" />
                              <span className="font-medium truncate max-w-[120px]">{asset.assignedToName}</span>
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300">
                              Available in Store
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          ) : (
            /* Table View */
            <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Asset Tag</TableHead>
                    <TableHead>Equipment Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Book Value</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        No assets found matching the criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAssets.map((asset) => {
                      const stateCfg = STATE_CONFIG[asset.state] || STATE_CONFIG.in_stock;
                      return (
                        <TableRow key={asset.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono font-bold text-xs text-violet-600">
                            {asset.assetTag}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-semibold text-sm">{asset.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">SN: {asset.serialNumber || "N/A"}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{asset.category}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-xs font-medium border", stateCfg.badgeClass)}>
                              {stateCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="capitalize text-sm">{asset.condition}</TableCell>
                          <TableCell className="text-sm">
                            {asset.assignedToName ? (
                              <span className="font-medium text-blue-600">{asset.assignedToName}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">In Store</span>
                            )}
                          </TableCell>
                          <TableCell className="font-semibold text-sm">
                            {formatRupees(asset.bookValueMinor)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDetailItem(asset);
                                setDetailTab("specs");
                              }}
                            >
                              <Eye className="h-4 w-4 mr-1 text-muted-foreground" /> View
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Tab 2: Financial Valuation */}
        <TabsContent value="valuation" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Gross Acquisition Cost</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-foreground">{formatRupees(totalGrossCost.toString())}</p>
                <p className="text-xs text-muted-foreground mt-1">Total original purchase cost of all assets</p>
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Net Book Value (Today)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-indigo-600">{formatRupees(totalNetBookValue.toString())}</p>
                <p className="text-xs text-muted-foreground mt-1">Current balance sheet valuation after depreciation</p>
              </CardContent>
            </Card>

            <Card className="border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Accumulated Depreciation</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-rose-600">
                  {formatRupees((totalGrossCost - totalNetBookValue).toString())}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {totalGrossCost > 0n ? Math.round(Number(((totalGrossCost - totalNetBookValue) * 100n) / totalGrossCost)) : 0}% written down
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Category Breakdown Table */}
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Category Valuation Summary</CardTitle>
              <CardDescription>
                Auditor-ready asset breakdown by category with depreciation schedules
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Asset Category</TableHead>
                    <TableHead>Item Count</TableHead>
                    <TableHead>Gross Purchase Cost</TableHead>
                    <TableHead>Net Book Value</TableHead>
                    <TableHead>Accumulated Depreciation</TableHead>
                    <TableHead>Depreciation %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {valuation?.categories && valuation.categories.length > 0 ? (
                    valuation.categories.map((c) => {
                      const cost = BigInt(c.costMinor || "0");
                      const book = BigInt(c.bookValueMinor || "0");
                      const dep = cost - book;
                      const percent = cost > 0n ? Math.round(Number((dep * 100n) / cost)) : 0;

                      return (
                        <TableRow key={c.category}>
                          <TableCell className="font-semibold">{c.category}</TableCell>
                          <TableCell>{c.count} items</TableCell>
                          <TableCell className="font-medium">{formatRupees(c.costMinor)}</TableCell>
                          <TableCell className="font-bold text-indigo-600">{formatRupees(c.bookValueMinor)}</TableCell>
                          <TableCell className="text-rose-600 font-medium">{formatRupees(dep.toString())}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={percent} className="h-2 w-16" />
                              <span className="text-xs font-mono">{percent}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        Loading valuation records...
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Maintenance & Warranty */}
        <TabsContent value="maintenance" className="space-y-6 mt-4">
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" /> Warranty Expiry Watchlist (Next 90 Days)
              </CardTitle>
              <CardDescription>
                Equipment nearing warranty expiration requiring renewal or hardware review
              </CardDescription>
            </CardHeader>
            <CardContent>
              {warrantyAlerts.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                  <p className="font-medium">All equipment warranties are up to date.</p>
                  <p className="text-xs mt-1">No equipment expiring in the immediate 90-day window.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {warrantyAlerts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-3.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold">
                          <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{a.name} ({a.assetTag})</p>
                          <p className="text-xs text-muted-foreground">
                            SN: {a.serialNumber || "N/A"} • Custody: {a.assignedToName || "In Store"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className="text-xs text-muted-foreground">Expires On</span>
                          <p className="font-mono font-bold text-sm text-amber-700 dark:text-amber-400">
                            {a.warrantyExpiresOn}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setFaultModalItem(a);
                            setFaultDesc("");
                            setFaultVendor(a.manufacturer || "");
                          }}
                        >
                          Report Issue
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Software & SaaS Applications */}
        <TabsContent value="software" className="space-y-6 mt-4">
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border shadow-sm bg-card/60">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Software Apps</p>
                  <p className="text-2xl font-bold mt-1 text-foreground">{softwareSummary.uniqueApplications || softwareList.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{softwareSummary.totalInstallations} installations across fleet</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-500">
                  <Layers className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-sm bg-card/60">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Blacklisted Apps</p>
                  <p className={cn("text-2xl font-bold mt-1", softwareSummary.blacklistedCount > 0 ? "text-rose-500" : "text-emerald-500")}>
                    {softwareSummary.blacklistedCount}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Torrents / unauthorized remote access</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500">
                  <ShieldAlert className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-sm bg-card/60">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">High Risk Tools</p>
                  <p className="text-2xl font-bold mt-1 text-amber-500">{softwareSummary.highRiskCount}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Packet capture &amp; diagnostic utilities</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                  <AlertTriangle className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-sm bg-card/60">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Productivity &amp; SaaS</p>
                  <p className="text-2xl font-bold mt-1 text-blue-500">{softwareSummary.saasProductivityCount}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">IDEs, Office, Figma, Slack</p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                  <AppWindow className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Software Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by application name, publisher, hostname..."
                value={softwareSearch}
                onChange={(e) => setSoftwareSearch(e.target.value)}
                className="pl-9 bg-card text-xs"
              />
            </div>

            <select
              value={softwareCategoryFilter}
              onChange={(e) => setSoftwareCategoryFilter(e.target.value)}
              className="h-9 text-xs bg-background border border-input rounded-md px-2 text-foreground"
            >
              <option value="all">All Categories</option>
              <option value="productivity">Productivity &amp; SaaS</option>
              <option value="development">Development</option>
              <option value="remote_access">Remote Access</option>
              <option value="p2p_sharing">P2P &amp; Torrent</option>
              <option value="security">Security / Auditing</option>
              <option value="communication">Communication</option>
              <option value="utility">Utility</option>
            </select>

            <select
              value={softwareRiskFilter}
              onChange={(e) => setSoftwareRiskFilter(e.target.value)}
              className="h-9 text-xs bg-background border border-input rounded-md px-2 text-foreground"
            >
              <option value="all">All Risk Levels</option>
              <option value="critical">Critical Risk</option>
              <option value="high">High Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="low">Low Risk</option>
              <option value="safe">Safe / Approved</option>
            </select>

            <Button
              variant={softwareBlacklistOnly ? "destructive" : "outline"}
              size="sm"
              onClick={() => setSoftwareBlacklistOnly(!softwareBlacklistOnly)}
              className="text-xs gap-1.5"
            >
              <ShieldAlert className="h-3.5 w-3.5" /> Blacklisted Only
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={loadSoftwareData}
              disabled={loadingSoftwareTab}
              className="text-xs gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loadingSoftwareTab && "animate-spin")} /> Refresh
            </Button>
          </div>

          {/* Software Inventory Table */}
          <Card className="border shadow-sm overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40 text-xs">
                <TableRow>
                  <TableHead>Application Name</TableHead>
                  <TableHead>Publisher / Vendor</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Installed On Host</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Risk Classification</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingSoftwareTab ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-xs">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" /> Loading fleet software catalog...
                    </TableCell>
                  </TableRow>
                ) : softwareList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground text-xs">
                      No software applications found matching current criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  softwareList.map((app) => (
                    <TableRow key={app.id} className="hover:bg-muted/30 text-xs">
                      <TableCell className="font-bold text-foreground">
                        <div className="flex items-center gap-1.5">
                          {app.isBlacklisted ? (
                            <ShieldAlert className="h-4 w-4 text-rose-500 shrink-0" />
                          ) : (
                            <AppWindow className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span>{app.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{app.publisher || "Third Party"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{app.version || "1.0.0"}</TableCell>
                      <TableCell className="font-mono font-semibold text-primary">{app.deviceHostname}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{app.category.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] uppercase font-bold",
                            app.riskLevel === "critical"
                              ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                              : app.riskLevel === "high"
                              ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                          )}
                        >
                          {app.isBlacklisted ? "BLACKLISTED" : app.riskLevel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {app.isBlacklisted && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 px-2 text-[10px] gap-1"
                            onClick={async () => {
                              toast.info(`Dispatched remote kill command for ${app.name} on ${app.deviceHostname}`);
                              await fetch("/api/security/devices/commands", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  deviceHostname: app.deviceHostname,
                                  commandType: "kill_process",
                                  payload: { processName: app.name },
                                }),
                              });
                            }}
                          >
                            <Zap className="h-3 w-3" /> Terminate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: ADD ASSET                                               */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register New Asset</DialogTitle>
            <DialogDescription>
              Provision new hardware, assign initial custody, and configure depreciation.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Equipment / Asset Name *</Label>
              <Input
                placeholder="e.g. Apple MacBook Pro 16 M3 Max"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Category *</Label>
              <Select
                value={form.category || categories[0]?.name || ""}
                onValueChange={handleCategorySelect}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Asset Tag (Auto-generated if blank)</Label>
              <Input
                placeholder="e.g. CIR-AST-0007"
                value={form.assetTag}
                onChange={(e) => setForm({ ...form, assetTag: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Serial Number</Label>
              <Input
                placeholder="e.g. C02G99XYMD6T"
                value={form.serialNumber}
                onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Manufacturer / Brand</Label>
              <Input
                placeholder="e.g. Apple / Dell / Lenovo"
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                placeholder="e.g. MacBook Pro 16"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Purchase Date</Label>
              <Input
                type="date"
                value={form.purchaseDate}
                onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Purchase Cost (₹)</Label>
              <Input
                type="number"
                placeholder="e.g. 150000"
                value={form.purchaseCostRupees}
                onChange={(e) => setForm({ ...form, purchaseCostRupees: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Warranty Expiry Date</Label>
              <Input
                type="date"
                value={form.warrantyExpiresOn}
                onChange={(e) => setForm({ ...form, warrantyExpiresOn: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Depreciation Method</Label>
              <Select
                value={form.depreciationMethod}
                onValueChange={(val) => setForm({ ...form, depreciationMethod: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="straight_line">Straight Line (Equal Monthly)</SelectItem>
                  <SelectItem value="declining_balance">Declining Balance (150%)</SelectItem>
                  <SelectItem value="double_declining">Double Declining Balance (200%)</SelectItem>
                  <SelectItem value="none">No Depreciation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Useful Life (Months)</Label>
              <Input
                type="number"
                value={form.usefulLifeMonths}
                onChange={(e) => setForm({ ...form, usefulLifeMonths: Number(e.target.value) })}
              />
            </div>

            <div className="space-y-2">
              <Label>Condition</Label>
              <Select value={form.condition} onValueChange={(val) => setForm({ ...form, condition: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Brand New</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Initial Assignment (Optional)</Label>
              <Select value={form.assignedToId} onValueChange={(val) => setForm({ ...form, assignedToId: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Keep in stock (Unassigned)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned (Store in Stock)</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.firstName} {e.lastName} ({e.workEmail})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Notes &amp; Internal Remarks</Label>
              <Textarea
                placeholder="Vendor invoice details, PO reference, accessory notes..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateSubmit}
              disabled={actionLoading}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              {actionLoading ? "Registering..." : "Register Asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: EDIT ASSET                                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Asset — {editItem?.assetTag}</DialogTitle>
            <DialogDescription>Modify asset specifications, warranty, or policy details.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Equipment Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Asset Tag</Label>
              <Input
                value={form.assetTag}
                onChange={(e) => setForm({ ...form, assetTag: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Serial Number</Label>
              <Input
                value={form.serialNumber}
                onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Manufacturer</Label>
              <Input
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Purchase Date</Label>
              <Input
                type="date"
                value={form.purchaseDate}
                onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Purchase Cost (₹)</Label>
              <Input
                type="number"
                value={form.purchaseCostRupees}
                onChange={(e) => setForm({ ...form, purchaseCostRupees: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Warranty Expiry</Label>
              <Input
                type="date"
                value={form.warrantyExpiresOn}
                onChange={(e) => setForm({ ...form, warrantyExpiresOn: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Condition</Label>
              <Select value={form.condition} onValueChange={(val) => setForm({ ...form, condition: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={actionLoading}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              {actionLoading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: ASSET DETAIL, SCHEDULE & CUSTODY HISTORY                 */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!detailItem} onOpenChange={(open) => !open && setDetailItem(null)}>
        <DialogContent className="flex max-h-[min(90vh,900px)] w-[min(96vw,56rem)] max-w-none flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-12">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-violet-600 bg-violet-100 dark:bg-violet-950 px-2 py-0.5 rounded">
                {detailItem?.assetTag}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-medium border",
                  detailItem ? STATE_CONFIG[detailItem.state]?.badgeClass : ""
                )}
              >
                {detailItem ? STATE_CONFIG[detailItem.state]?.label : ""}
              </Badge>
            </div>
            <DialogTitle className="text-left text-xl leading-tight">{detailItem?.name}</DialogTitle>
            <DialogDescription className="text-left">
              {detailItem?.category} • {detailItem?.model || detailItem?.manufacturer || "Standard Equipment"}
            </DialogDescription>
          </DialogHeader>

          {detailItem && (
            <div className="flex min-h-0 flex-1 flex-col">
              <Tabs
                value={detailTab}
                onValueChange={(v: "specs" | "schedule" | "history" | "software" | "security") => setDetailTab(v)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="shrink-0 overflow-x-auto border-b px-4 py-2">
                  <TabsList className="inline-flex h-auto w-max min-w-full flex-nowrap justify-start gap-1 bg-muted/60 p-1">
                    <TabsTrigger value="specs" className="gap-1.5 px-3 text-xs sm:text-sm">
                      <FileText className="h-4 w-4 shrink-0" />
                      Specs
                    </TabsTrigger>
                    <TabsTrigger value="schedule" className="gap-1.5 px-3 text-xs sm:text-sm">
                      <TrendingDown className="h-4 w-4 shrink-0" />
                      Depreciation
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-1.5 px-3 text-xs sm:text-sm">
                      <History className="h-4 w-4 shrink-0" />
                      Custody
                    </TabsTrigger>
                    <TabsTrigger value="software" className="gap-1.5 px-3 text-xs sm:text-sm">
                      <Layers className="h-4 w-4 shrink-0" />
                      Software
                      <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                        {assetSoftwareList.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="security" className="gap-1.5 px-3 text-xs sm:text-sm">
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      Endpoint
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <TabsContent value="specs" className="mt-0 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground">Current State</span>
                      <p className="font-bold text-sm capitalize mt-0.5">{detailItem.state.replace(/_/g, " ")}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground">Condition</span>
                      <p className="font-bold text-sm capitalize mt-0.5">{detailItem.condition}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground">Serial Number</span>
                      <p className="font-mono font-bold text-sm mt-0.5">{detailItem.serialNumber || "N/A"}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground">Purchase Cost</span>
                      <p className="font-bold text-sm text-foreground mt-0.5">{formatRupees(detailItem.purchaseCostMinor)}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground">Net Book Value</span>
                      <p className="font-bold text-sm text-indigo-600 mt-0.5">{formatRupees(detailItem.bookValueMinor)}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/40 border">
                      <span className="text-xs text-muted-foreground">Warranty Expires</span>
                      <p className={cn("font-bold text-sm mt-0.5", detailItem.warrantyExpiringSoon ? "text-amber-600" : "")}>
                        {detailItem.warrantyExpiresOn || "N/A"}
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border bg-card space-y-2">
                    <h4 className="font-semibold text-sm flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-blue-500" /> Current Custody Holder
                    </h4>
                    {detailItem.assignedToName ? (
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <p className="font-semibold text-sm">{detailItem.assignedToName}</p>
                          <p className="text-muted-foreground">Active corporate custodian</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Asset is currently in inventory stock.</p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="schedule" className="mt-0 space-y-4">
                  {loadingSchedule ? (
                    <div className="py-12 text-center text-muted-foreground">Calculating depreciation matrix...</div>
                  ) : scheduleData.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">No depreciation schedule calculated.</div>
                  ) : (
                    <div className="border rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-muted/40 text-xs">
                          <TableRow>
                            <TableHead>Period</TableHead>
                            <TableHead>Monthly Charge</TableHead>
                            <TableHead>Accumulated</TableHead>
                            <TableHead>Ending Book Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {scheduleData.map((row) => (
                            <TableRow key={row.month} className="text-xs">
                              <TableCell className="font-mono">Month {row.month} ({row.date})</TableCell>
                              <TableCell className="text-xs">{formatRupees(row.chargeMinor)}</TableCell>
                              <TableCell className="text-xs text-rose-600">{formatRupees(row.accumulatedMinor)}</TableCell>
                              <TableCell className="text-xs font-bold text-indigo-600">{formatRupees(row.bookValueMinor)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="history" className="mt-0 space-y-4">
                  {loadingHistory ? (
                    <div className="py-12 text-center text-muted-foreground">Loading custody chain...</div>
                  ) : !historyData || (historyData.assignments.length === 0 && historyData.events.length === 0) ? (
                    <div className="py-12 text-center text-muted-foreground">No custody movements recorded yet.</div>
                  ) : (
                    <div className="space-y-4">
                      {historyData.assignments.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="font-semibold text-sm">Custody Assignments</h4>
                          <div className="border rounded-xl divide-y">
                            {historyData.assignments.map((asg, idx) => (
                              <div key={idx} className="p-3 flex items-center justify-between text-xs">
                                <div>
                                  <p className="font-semibold text-sm">{asg.employeeName || "Employee"}</p>
                                  <p className="text-muted-foreground">
                                    Issued: {new Date(asg.issuedAt).toLocaleDateString()} • Condition: {asg.conditionOnIssue}
                                  </p>
                                </div>
                                <div>
                                  {asg.returnedAt ? (
                                    <Badge variant="outline" className="text-xs">
                                      Returned on {new Date(asg.returnedAt).toLocaleDateString()}
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-blue-100 text-blue-800 text-xs">Current Holder</Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {historyData.events.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="font-semibold text-sm">Audit Log</h4>
                          <div className="border rounded-xl divide-y text-xs">
                            {historyData.events.map((ev, idx) => (
                              <div key={idx} className="p-2.5 flex items-center justify-between">
                                <div>
                                  <span className="font-semibold uppercase tracking-wider text-violet-600 mr-2">{ev.action}</span>
                                  <span className="text-muted-foreground">{ev.detail || "State change"}</span>
                                </div>
                                <span className="text-muted-foreground font-mono text-[10px]">
                                  {new Date(ev.occurredAt).toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="software" className="mt-0 space-y-4">
                  {loadingAssetSoftware ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" /> Loading installed applications on {detailItem.name}...
                    </div>
                  ) : assetSoftwareList.length === 0 ? (
                    <div className="py-12 text-center text-xs text-muted-foreground">
                      No software inventory reported yet for this asset tag ({detailItem.assetTag}).
                    </div>
                  ) : (
                    <div className="border rounded-xl overflow-hidden max-h-72 overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-muted/40 text-xs">
                          <TableRow>
                            <TableHead>Application Name</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Risk Level</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {assetSoftwareList.map((app) => (
                            <TableRow key={app.id} className="text-xs">
                              <TableCell className="font-semibold text-foreground flex items-center gap-1.5">
                                {app.isBlacklisted ? <ShieldAlert className="h-3.5 w-3.5 text-rose-500 shrink-0" /> : <AppWindow className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                                {app.name}
                              </TableCell>
                              <TableCell className="font-mono text-muted-foreground">{app.version || "1.0.0"}</TableCell>
                              <TableCell className="capitalize text-muted-foreground">{app.category.replace(/_/g, " ")}</TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] uppercase font-bold",
                                    app.riskLevel === "critical"
                                      ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                      : app.riskLevel === "high"
                                      ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                      : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                  )}
                                >
                                  {app.isBlacklisted ? "BLACKLISTED" : app.riskLevel}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="security" className="mt-0 space-y-4">
                  {detailItem.assignedToId ? (
                    <DeviceInstallPanel
                      employeeId={detailItem.assignedToId}
                      employeeLabel={detailItem.assignedToName}
                      assetTag={detailItem.assetTag}
                    />
                  ) : (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                      Assign this asset to an employee first, then generate an endpoint installer for
                      their custody laptop.
                    </div>
                  )}
                </TabsContent>
                </div>
              </Tabs>
            </div>
          )}

          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-muted/30 px-6 py-4">
            <Button variant="outline" onClick={() => setDetailItem(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: ISSUE ASSET TO EMPLOYEE                                  */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!issueModalItem} onOpenChange={(open) => !open && setIssueModalItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Issue Asset to Employee</DialogTitle>
            <DialogDescription>
              Assign {issueModalItem?.name} ({issueModalItem?.assetTag}) into employee custody.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Select Employee *</Label>
              <Select value={issueEmployeeId} onValueChange={setIssueEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose employee..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.firstName} {e.lastName} ({e.workEmail})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Condition on Handover</Label>
              <Select value={issueCondition} onValueChange={setIssueCondition}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Brand New</SelectItem>
                  <SelectItem value="good">Good / Working</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueModalItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleIssueSubmit}
              disabled={actionLoading || !issueEmployeeId}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              {actionLoading ? "Issuing..." : "Confirm Issue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: RETURN ASSET TO INVENTORY                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!returnModalItem} onOpenChange={(open) => !open && setReturnModalItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Return Asset to Inventory</DialogTitle>
            <DialogDescription>
              Receive {returnModalItem?.name} back from {returnModalItem?.assignedToName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Condition on Return *</Label>
              <Select value={returnCondition} onValueChange={setReturnCondition}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good / Operational</SelectItem>
                  <SelectItem value="fair">Fair (Minor Wear)</SelectItem>
                  <SelectItem value="poor">Poor (Needs Inspection)</SelectItem>
                  <SelectItem value="damaged">Damaged (Needs Repair)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Handover Notes / Inspection Remarks</Label>
              <Textarea
                placeholder="Physical condition, missing accessories (charger/cable), remarks..."
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnModalItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleReturnSubmit}
              disabled={actionLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {actionLoading ? "Receiving..." : "Confirm Return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: REPORT FAULT                                             */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <Dialog open={!!faultModalItem} onOpenChange={(open) => !open && setFaultModalItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Report Equipment Fault</DialogTitle>
            <DialogDescription>
              Log maintenance incident for {faultModalItem?.name} ({faultModalItem?.assetTag}).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-muted/40 border text-xs">
              <span className="text-muted-foreground">Warranty Status:</span>
              <p className={cn("font-bold mt-0.5", faultModalItem?.isUnderWarranty ? "text-emerald-600" : "text-amber-600")}>
                {faultModalItem?.isUnderWarranty ? "Covered under Manufacturer Warranty" : "Out of Warranty"}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Fault Description *</Label>
              <Textarea
                placeholder="Describe the defect, damage, or issue..."
                value={faultDesc}
                onChange={(e) => setFaultDesc(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Vendor / Service Center (Optional)</Label>
              <Input
                placeholder="e.g. Apple Authorized Care"
                value={faultVendor}
                onChange={(e) => setFaultVendor(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFaultModalItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleFaultSubmit}
              disabled={actionLoading || !faultDesc}
              className="bg-gradient-to-r from-amber-600 to-orange-600 text-white"
            >
              {actionLoading ? "Logging..." : "Log Fault Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
