"use client";

import { useState, useEffect, useMemo } from "react";
import { useToday } from "@/hooks/use-now";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Users, Plus, Search, CheckCircle2, Clock, LogIn,
  LogOut, Building2, Calendar, UserPlus, Shield,
  CreditCard, Eye, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip,
} from "recharts";
import { useVisitorStore, startSync, type VisitorDoc } from "@/stores/unified-store";
import { COLLECTIONS, genericService } from "@/lib/collection-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

// ═══════════════════════════════════════════════════════════════
// VISITORS — Visitor management system
// ═══════════════════════════════════════════════════════════════

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  "checked-in": { label: "Checked In", className: "status-active" },
  "checked-out": { label: "Checked Out", className: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400" },
  "pre-registered": { label: "Pre-registered", className: "status-pending" },
  expected: { label: "Expected", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};
const PURPOSES = ["Meeting", "Interview", "Delivery", "Maintenance", "Client Visit", "Personal", "Vendor", "Other"];

export default function VisitorsPage() {
  const store = useVisitorStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("today");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<VisitorDoc | null>(null);
  const [form, setForm] = useState({
    name: "", company: "", purpose: "", host: "", date: "",
  });

  useEffect(() => { if (!initialized) startSync(COLLECTIONS.visitors, store); }, [initialized, store]);

  const today = useToday() ?? "";

  // Filter today/pre-registered/history
  const todayVisitors = useMemo(() => items.filter(v => v.date === today || v.date?.startsWith(today)), [items, today]);
  const preRegistered = useMemo(() => items.filter(v => v.status === "pre-registered" || v.status === "expected"), [items]);
  const history = useMemo(() => items.filter(v => v.date < today), [items, today]);

  // KPIs
  const todayTotal = todayVisitors.length;
  const checkedIn = todayVisitors.filter(v => v.status === "checked-in").length;
  const checkedOut = todayVisitors.filter(v => v.status === "checked-out").length;
  const expectedToday = preRegistered.filter(v => v.date === today).length;

  // Daily visitor count by purpose
  const purposeData = useMemo(() => {
    const counts: Record<string, number> = {};
    todayVisitors.forEach(v => { counts[v.purpose || "Other"] = (counts[v.purpose || "Other"] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [todayVisitors]);

  const filtered = useMemo(() => {
    const source = tab === "today" ? todayVisitors : tab === "preregistered" ? preRegistered : history;
    if (!search) return source;
    const q = search.toLowerCase();
    return source.filter(v =>
      v.name?.toLowerCase().includes(q) ||
      v.company?.toLowerCase().includes(q) ||
      v.host?.toLowerCase().includes(q)
    );
  }, [tab, todayVisitors, preRegistered, history, search]);

  const handleRegister = async () => {
    if (!form.name || !form.purpose || !form.host || !form.date) {
      toast.error("Please fill required fields"); return;
    }
    try {
      await genericService(COLLECTIONS.visitors).create({
        ...form,
        checkIn: "", checkOut: "",
        status: "pre-registered",
      });
      toast.success("Visitor pre-registered!");
      setRegisterOpen(false);
      setForm({ name: "", company: "", purpose: "", host: "", date: "" });
    } catch { toast.error("Failed to register visitor"); }
  };

  const handleCheckIn = async (id: string) => {
    try {
      await genericService(COLLECTIONS.visitors).update(id, {
        status: "checked-in",
        checkIn: new Date().toLocaleTimeString("en-US", { hour12: false }),
      });
      toast.success("Visitor checked in");
    } catch { toast.error("Failed to check in"); }
  };

  const handleCheckOut = async (id: string) => {
    try {
      await genericService(COLLECTIONS.visitors).update(id, {
        status: "checked-out",
        checkOut: new Date().toLocaleTimeString("en-US", { hour12: false }),
      });
      toast.success("Visitor checked out");
    } catch { toast.error("Failed to check out"); }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;
  if (!loading && initialized && items.length === 0) {
    return <DataEmptyState {...EMPTY_STATES.visitors} onAction={() => setRegisterOpen(true)} />;
  }

  const kpis = [
    { label: "Today Total", value: todayTotal, icon: Users, gradient: "from-violet-500 to-purple-600" },
    { label: "Checked In", value: checkedIn, icon: LogIn, gradient: "from-emerald-500 to-green-600" },
    { label: "Checked Out", value: checkedOut, icon: LogOut, gradient: "from-gray-500 to-gray-600" },
    { label: "Expected", value: expectedToday, icon: Clock, gradient: "from-blue-500 to-cyan-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Visitors</h1>
          <p className="text-muted-foreground mt-1">Visitor check-in, pre-registration &amp; management</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setRegisterOpen(true)}>
          <UserPlus className="h-4 w-4" /> Pre-Register
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                </div>
                <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center", kpi.gradient)}>
                  <kpi.icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search visitors..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="today">Today ({todayTotal})</TabsTrigger>
          <TabsTrigger value="preregistered">Pre-registered ({preRegistered.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {[{ key: "today" }, { key: "preregistered" }, { key: "history" }].map(({ key }) => (
          <TabsContent key={key} value={key} className="space-y-3 mt-4">
            {filtered.length === 0 ? (
              <DataEmptyState {...EMPTY_STATES.visitors} compact onAction={() => setRegisterOpen(true)} />
            ) : filtered.map(visitor => {
              const st = STATUS_MAP[visitor.status] || STATUS_MAP.expected;
              return (
                <Card key={visitor.id} className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDetailItem(visitor)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-cyan-500 text-white text-xs">
                            {visitor.name?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{visitor.name}</h3>
                            {visitor.company && <Badge variant="outline" className="text-xs">{visitor.company}</Badge>}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{visitor.purpose}</span>
                            <span>Host: {visitor.host}</span>
                            <span>{visitor.date}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {visitor.checkIn && <span className="text-xs text-muted-foreground flex items-center gap-1"><LogIn className="h-3 w-3" />{visitor.checkIn}</span>}
                        {visitor.checkOut && <span className="text-xs text-muted-foreground flex items-center gap-1"><LogOut className="h-3 w-3" />{visitor.checkOut}</span>}
                        <Badge className={st.className}>{st.label}</Badge>
                        {(visitor.status === "pre-registered" || visitor.status === "expected") && (
                          <Button variant="ghost" size="sm" className="text-xs text-emerald-600" onClick={e => { e.stopPropagation(); handleCheckIn(visitor.id); }}>Check In</Button>
                        )}
                        {visitor.status === "checked-in" && (
                          <Button variant="ghost" size="sm" className="text-xs text-blue-600" onClick={e => { e.stopPropagation(); handleCheckOut(visitor.id); }}>Check Out</Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
        ))}
      </Tabs>

      {/* Daily Visitor Count */}
      {purposeData.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Today&apos;s Visitors by Purpose</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={purposeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis />
                <RTooltip />
                <Bar dataKey="value" name="Visitors" fill="#8b5cf6" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Badge Generation Section */}
      <Card className="border-0 shadow-sm">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" /> Visitor Badge</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">Generate a visitor badge for checked-in visitors.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {todayVisitors.filter(v => v.status === "checked-in").slice(0, 3).map(v => (
              <div key={v.id} className="p-4 rounded-lg border-2 border-dashed border-violet-200 dark:border-violet-800">
                <div className="flex items-center gap-3 mb-2">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                      {v.name?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-bold">{v.name}</p>
                    <p className="text-xs text-muted-foreground">{v.company}</p>
                  </div>
                </div>
                <Separator className="my-2" />
                <div className="text-xs space-y-1">
                  <p><span className="text-muted-foreground">Purpose:</span> {v.purpose}</p>
                  <p><span className="text-muted-foreground">Host:</span> {v.host}</p>
                  <p><span className="text-muted-foreground">Check-in:</span> {v.checkIn}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Host Notification */}
      <Card className="border-0 shadow-sm">
        <CardHeader><CardTitle className="text-base">Host Notifications</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {todayVisitors.filter(v => v.status === "checked-in").map(v => (
              <div key={v.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <p className="text-sm"><span className="font-medium">{v.name}</span> has arrived to meet <span className="font-medium">{v.host}</span></p>
                <Badge className="status-active text-xs">Notified</Badge>
              </div>
            ))}
            {todayVisitors.filter(v => v.status === "checked-in").length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No active check-ins to notify.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!detailItem} onOpenChange={v => { if (!v) setDetailItem(null); }}>
        <DialogContent>
          {detailItem && (
            <>
              <DialogHeader><DialogTitle>Visitor Details</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                      {detailItem.name?.split(" ").map(n => n[0]).join("").slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{detailItem.name}</p>
                    <p className="text-sm text-muted-foreground">{detailItem.company}</p>
                  </div>
                  <Badge className={(STATUS_MAP[detailItem.status] || STATUS_MAP.expected).className} >{(STATUS_MAP[detailItem.status] || STATUS_MAP.expected).label}</Badge>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><p className="text-muted-foreground">Purpose</p><p className="font-medium">{detailItem.purpose}</p></div>
                  <div><p className="text-muted-foreground">Host</p><p className="font-medium">{detailItem.host}</p></div>
                  <div><p className="text-muted-foreground">Date</p><p className="font-medium">{detailItem.date}</p></div>
                  <div><p className="text-muted-foreground">Check-in</p><p className="font-medium">{detailItem.checkIn || "—"}</p></div>
                  <div><p className="text-muted-foreground">Check-out</p><p className="font-medium">{detailItem.checkOut || "—"}</p></div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                {(detailItem.status === "pre-registered" || detailItem.status === "expected") && (
                  <Button className="bg-gradient-to-r from-emerald-500 to-green-600 text-white border-0" onClick={() => { handleCheckIn(detailItem.id); setDetailItem(null); }}>Check In</Button>
                )}
                {detailItem.status === "checked-in" && (
                  <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0" onClick={() => { handleCheckOut(detailItem.id); setDetailItem(null); }}>Check Out</Button>
                )}
                <Button variant="outline" onClick={() => setDetailItem(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Pre-Register Dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Pre-Register Visitor</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Visitor Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Company name" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Purpose *</Label>
                <Select value={form.purpose} onValueChange={v => setForm(f => ({ ...f, purpose: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {PURPOSES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Expected Date *</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Host (Employee) *</Label>
              <Input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))} placeholder="Host employee name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleRegister}>
              <UserPlus className="h-4 w-4 mr-2" /> Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
