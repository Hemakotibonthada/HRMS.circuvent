"use client";

import { useState, useEffect, useMemo } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Car, Plus, Search, CheckCircle2, Clock, MapPin,
  AlertTriangle, Wrench, Building2, Calendar,
  ParkingCircle, Square, CircleDot, User, Zap, Bike,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { genericService, COLLECTIONS } from "@/lib/collection-service";
import { useEmployeeStore, startSync } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";
import { clickable } from "@/lib/a11y/clickable";

// ═══════════════════════════════════════════════════════════════
// PARKING — Parking spot management with floor grid
// ═══════════════════════════════════════════════════════════════

interface ParkingSpot {
  id: string;
  floor: string;
  zone: string;
  spot: string;
  status: "available" | "booked" | "maintenance";
  bookedBy?: string;
  vehicle?: string;
  date?: string;
}

interface ParkingStore {
  items: ParkingSpot[];
  loading: boolean;
  error: string | null;
  addItem: (item: ParkingSpot) => void;
  updateItem: (id: string, updates: Partial<ParkingSpot>) => void;
  removeItem: (id: string) => void;
  setItems: (items: ParkingSpot[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const useParkingStore = create<ParkingStore>((set) => ({
  items: [],
  loading: false,
  error: null,
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({
    items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
  })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  setItems: (items) => set({ items, loading: false }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));

const FLOORS = ["Ground", "Floor 1", "Floor 2", "Floor 3"];
const ZONES = ["A", "B", "C", "D"];
const SPOTS_PER_ZONE = 6;

const STATUS_COLORS: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
  booked: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-800",
  maintenance: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
};

export default function ParkingPage() {
  const store = useParkingStore();
  const empStore = useEmployeeStore();
  const { items: spots, loading } = store;
  const { items: employees, initialized: empInit } = empStore;

  const [initialized, setInitialized] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState("Ground");
  const [bookOpen, setBookOpen] = useState(false);
  const [tab, setTab] = useState("floorplan");
  const [vehicleType, setVehicleType] = useState("car");
  const [form, setForm] = useState({
    floor: "Ground", zone: "A", spot: "1", date: new Date().toISOString().slice(0, 10), vehicle: "", bookedBy: "",
  });

  useEffect(() => {
    if (!initialized) {
      store.setLoading(true);
      genericService("parking").getAll().then((data) => {
        store.setItems(data as unknown as ParkingSpot[]);
        setInitialized(true);
      }).catch(() => {
        store.setError("Failed to load parking data");
        store.setLoading(false);
        setInitialized(true);
      });
    }
    if (!empInit) startSync(COLLECTIONS.employees, empStore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, empInit]);

  // KPIs
  const totalSpots = FLOORS.length * ZONES.length * SPOTS_PER_ZONE;
  const bookedCount = spots.filter(s => s.status === "booked").length;
  const availableCount = totalSpots - bookedCount - spots.filter(s => s.status === "maintenance").length;
  const maintenanceCount = spots.filter(s => s.status === "maintenance").length;

  // Floor plan grid
  const floorGrid = useMemo(() => {
    return ZONES.map(zone => {
      return Array.from({ length: SPOTS_PER_ZONE }, (_, i) => {
        const spotId = `${selectedFloor}-${zone}-${i + 1}`;
        const existing = spots.find(s => s.id === spotId || (s.floor === selectedFloor && s.zone === zone && s.spot === `${i + 1}`));
        return {
          id: spotId,
          zone,
          spot: `${i + 1}`,
          status: existing?.status || "available",
          bookedBy: existing?.bookedBy || "",
          vehicle: existing?.vehicle || "",
        };
      });
    });
  }, [selectedFloor, spots]);

  // My bookings
  const myBookings = useMemo(() =>
    spots.filter(s => s.status === "booked"),
  [spots]);

  // Availability summary
  const dailySummary = useMemo(() => {
    return FLOORS.map(floor => {
      const floorSpots = spots.filter(s => s.floor === floor);
      const booked = floorSpots.filter(s => s.status === "booked").length;
      const maint = floorSpots.filter(s => s.status === "maintenance").length;
      const total = ZONES.length * SPOTS_PER_ZONE;
      return { floor, total, booked, maint, available: total - booked - maint };
    });
  }, [spots]);

  const handleBook = async () => {
    if (!form.bookedBy || !form.date || !form.vehicle) {
      toast.error("Please fill all fields"); return;
    }
    const spotId = `${form.floor}-${form.zone}-${form.spot}`;
    const newSpot: ParkingSpot = {
      id: spotId, floor: form.floor, zone: form.zone,
      spot: form.spot, status: "booked",
      bookedBy: form.bookedBy, vehicle: form.vehicle, date: form.date,
    };
    try {
      await genericService("parking").create(newSpot as unknown as Record<string, unknown>);
      store.addItem(newSpot);
      toast.success(`Spot ${form.zone}-${form.spot} booked on ${form.floor}!`);
      setBookOpen(false);
      setForm({ floor: "Ground", zone: "A", spot: "1", date: "", vehicle: "", bookedBy: "" });
    } catch { toast.error("Failed to book spot"); }
  };

  if (loading && !initialized) return <DataLoadingSkeleton />;

  const kpis = [
    { label: "Total Spots", value: totalSpots, icon: ParkingCircle, gradient: "from-violet-500 to-purple-600" },
    { label: "Available", value: availableCount, icon: CheckCircle2, gradient: "from-emerald-500 to-green-600" },
    { label: "Booked", value: bookedCount, icon: Car, gradient: "from-blue-500 to-cyan-500" },
    { label: "Maintenance", value: maintenanceCount, icon: Wrench, gradient: "from-amber-500 to-orange-500" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">Parking</h1>
          <p className="text-muted-foreground mt-1">Book and manage parking spots</p>
        </div>
        <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-2" onClick={() => setBookOpen(true)}>
          <Plus className="h-4 w-4" /> Book Spot
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

      {/* Status Legend */}
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1"><CircleDot className="h-4 w-4 text-emerald-500" /> Available</span>
        <span className="flex items-center gap-1"><CircleDot className="h-4 w-4 text-violet-500" /> Booked</span>
        <span className="flex items-center gap-1"><CircleDot className="h-4 w-4 text-amber-500" /> Maintenance</span>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="floorplan">Floor Plan</TabsTrigger>
          <TabsTrigger value="mybookings">My Bookings ({myBookings.length})</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        {/* Floor Plan */}
        <TabsContent value="floorplan" className="mt-4">
          <div className="flex items-center gap-3 mb-4">
            <Label>Floor:</Label>
            <Select value={selectedFloor} onValueChange={setSelectedFloor}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FLOORS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">{selectedFloor} — Parking Grid</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {floorGrid.map((zoneSpots, zi) => (
                  <div key={ZONES[zi]}>
                    <p className="text-sm font-semibold text-muted-foreground mb-2">Zone {ZONES[zi]}</p>
                    <div className="grid grid-cols-6 gap-2">
                      {zoneSpots.map(spot => (
                        <div key={spot.id}
                          className={cn(
                            "p-3 rounded-lg border-2 text-center cursor-pointer transition-all hover:scale-105",
                            STATUS_COLORS[spot.status] || STATUS_COLORS.available
                          )}
                          {...clickable(
                            () => {
                              if (spot.status === "available") {
                                setForm(f => ({ ...f, floor: selectedFloor, zone: ZONES[zi], spot: spot.spot }));
                                setBookOpen(true);
                              }
                            },
                            { disabled: spot.status !== "available" }
                          )}>
                          <Car className={cn("h-5 w-5 mx-auto mb-1",
                            spot.status === "available" ? "text-emerald-500" :
                            spot.status === "booked" ? "text-violet-500" : "text-amber-500")} />
                          <p className="text-xs font-bold">{ZONES[zi]}-{spot.spot}</p>
                          {spot.bookedBy && <p className="text-[10px] truncate">{spot.bookedBy}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* My Bookings */}
        <TabsContent value="mybookings" className="space-y-3 mt-4">
          {myBookings.length === 0 ? (
            <DataEmptyState icon={Car} title="No bookings" description="Book a parking spot to see it here." compact actionLabel="Book Spot" onAction={() => setBookOpen(true)} />
          ) : myBookings.map(b => (
            <Card key={b.id} className="border hover:shadow-xs transition-shadow">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center">
                    <Car className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Zone {b.zone}-{b.spot} ({b.floor} Level)</h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                      <span>{b.date}</span>
                      <span>&middot;</span>
                      <span>{b.vehicle}</span>
                      <span>&middot;</span>
                      <span className="font-medium text-foreground">{b.bookedBy}</span>
                    </p>
                  </div>
                </div>
                <Badge className="bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs">Booked</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Occupancy Analytics */}
        <TabsContent value="occupancy" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Level-wise Parking Availability</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {dailySummary.map(s => (
                  <div key={s.floor} className="flex items-center justify-between p-3.5 rounded-xl border bg-muted/20">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{s.floor} Level</p>
                        <p className="text-xs text-muted-foreground">{s.total} total spaces</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30">{s.available} free</Badge>
                      <Badge variant="outline" className="text-violet-600 border-violet-200 bg-violet-50 dark:bg-violet-950/30">{s.booked} occupied</Badge>
                      {s.maint > 0 && <Badge variant="outline" className="text-amber-600 border-amber-200">{s.maint} maint</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ENHANCED BOOK PARKING DIALOG */}
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Car className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Book Parking Spot</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Reserve a dedicated vehicle parking bay for office transit.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Employee Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-violet-500" />
                Employee Name <span className="text-destructive">*</span>
              </Label>
              {employees && employees.length > 0 ? (
                <Select value={form.bookedBy} onValueChange={v => setForm(f => ({ ...f, bookedBy: v }))}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select employee..." />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => {
                      const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ") || String(emp.id);
                      const sub = [emp.designation, emp.department].filter(Boolean).join(" · ");
                      return (
                        <SelectItem key={emp.id} value={name} className="text-xs">
                          <span className="font-medium">{name}</span>
                          {sub ? <span className="text-muted-foreground ml-2 text-[11px]">({sub})</span> : null}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.bookedBy}
                  onChange={e => setForm(f => ({ ...f, bookedBy: e.target.value }))}
                  placeholder="e.g. Rahul Sharma"
                  className="h-9 text-xs"
                  required
                />
              )}
            </div>

            {/* Vehicle Type Pills */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Vehicle Type</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "car", label: "Car (4-Wheeler)", icon: Car },
                  { id: "bike", label: "Two-Wheeler", icon: Bike },
                  { id: "ev", label: "EV Charging Bay", icon: Zap },
                ].map(vt => {
                  const Icon = vt.icon;
                  const active = vehicleType === vt.id;
                  return (
                    <button
                      key={vt.id}
                      type="button"
                      onClick={() => setVehicleType(vt.id)}
                      className={cn(
                        "p-2 rounded-lg border text-left flex items-center gap-2 transition-all",
                        active
                          ? "bg-violet-50 dark:bg-violet-950/40 border-violet-500 text-violet-700 dark:text-violet-300 shadow-xs"
                          : "bg-background hover:bg-muted/50 text-muted-foreground border-border"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                      <span className="font-medium text-xs truncate">{vt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Floor, Zone, Spot */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Level / Floor</Label>
                <Select value={form.floor} onValueChange={v => setForm(f => ({ ...f, floor: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FLOORS.map(f => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Zone</Label>
                <Select value={form.zone} onValueChange={v => setForm(f => ({ ...f, zone: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ZONES.map(z => <SelectItem key={z} value={z} className="text-xs">Zone {z}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Slot #</Label>
                <Select value={form.spot} onValueChange={v => setForm(f => ({ ...f, spot: v }))}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: SPOTS_PER_ZONE }, (_, i) => (
                      <SelectItem key={i + 1} value={`${i + 1}`} className="text-xs">Slot {i + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Date & Vehicle Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Booking Date <span className="text-destructive">*</span>
                </Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="h-9 text-xs" required />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center gap-1.5">
                  <Car className="h-3.5 w-3.5 text-muted-foreground" />
                  Vehicle Reg Number <span className="text-destructive">*</span>
                </Label>
                <Input value={form.vehicle} onChange={e => setForm(f => ({ ...f, vehicle: e.target.value }))} placeholder="e.g. KA-01-AB-1234" className="h-9 text-xs" required />
              </div>
            </div>

            {/* Spot Preview Card */}
            <div className="p-3 rounded-lg border bg-violet-50/60 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ParkingCircle className="h-4 w-4 text-violet-600" />
                <div>
                  <p className="text-xs font-bold text-foreground">
                    Allocated Bay: {form.floor} Floor · Zone {form.zone}-{form.spot}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {form.bookedBy ? form.bookedBy : "Selected Employee"} · {vehicleType.toUpperCase()}
                  </p>
                </div>
              </div>
              <Badge className="bg-emerald-600 text-white text-[10px]">Ready</Badge>
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2">
            <Button variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setBookOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all" onClick={handleBook}>
              <Plus className="h-4 w-4 mr-1.5" /> Confirm Reservation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}