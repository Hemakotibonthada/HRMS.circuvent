"use client";

import { useState, useEffect, useMemo } from "react";
import { create } from "zustand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Car, Plus, Search, CheckCircle2, Clock, MapPin,
  AlertTriangle, Wrench, Building2, Calendar,
  ParkingCircle, Square, CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { genericService } from "@/lib/firestore-service";
import { DataEmptyState, DataLoadingSkeleton, EMPTY_STATES } from "@/components/data-empty-state";

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
  const { items: spots, loading } = store;
  const [initialized, setInitialized] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState("Ground");
  const [bookOpen, setBookOpen] = useState(false);
  const [tab, setTab] = useState("floorplan");
  const [form, setForm] = useState({
    floor: "Ground", zone: "A", spot: "1", date: "", vehicle: "", bookedBy: "",
  });

  useEffect(() => {
    if (initialized) return;
    store.setLoading(true);
    genericService("parking").getAll().then((data) => {
      store.setItems(data as unknown as ParkingSpot[]);
      setInitialized(true);
    }).catch(() => {
      store.setError("Failed to load parking data");
      store.setLoading(false);
      setInitialized(true);
    });
  }, [initialized, store]);

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
                          onClick={() => {
                            if (spot.status === "available") {
                              setForm(f => ({ ...f, floor: selectedFloor, zone: ZONES[zi], spot: spot.spot }));
                              setBookOpen(true);
                            }
                          }}>
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
            <Card key={b.id} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                      <Car className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{b.zone}-{b.spot}</h3>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{b.floor}</span>
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{b.date}</span>
                        <span>{b.vehicle}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="status-active">Booked</Badge>
                    <span className="text-sm font-medium">{b.bookedBy}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Summary */}
        <TabsContent value="summary" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader><CardTitle className="text-base">Daily Availability Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {dailySummary.map(s => (
                  <div key={s.floor} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-3">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                      <span className="font-medium">{s.floor}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />{s.available} available</span>
                      <span className="flex items-center gap-1 text-violet-600"><Car className="h-3 w-3" />{s.booked} booked</span>
                      <span className="flex items-center gap-1 text-amber-600"><Wrench className="h-3 w-3" />{s.maint} maintenance</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Book Dialog */}
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Book Parking Spot</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Floor</Label>
                <Select value={form.floor} onValueChange={v => setForm(f => ({ ...f, floor: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FLOORS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Zone</Label>
                <Select value={form.zone} onValueChange={v => setForm(f => ({ ...f, zone: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ZONES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Spot</Label>
                <Select value={form.spot} onValueChange={v => setForm(f => ({ ...f, spot: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: SPOTS_PER_ZONE }, (_, i) => (
                      <SelectItem key={i + 1} value={`${i + 1}`}>{i + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Vehicle Number *</Label>
                <Input value={form.vehicle} onChange={e => setForm(f => ({ ...f, vehicle: e.target.value }))} placeholder="KA-01-XX-1234" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Your Name *</Label>
              <Input value={form.bookedBy} onChange={e => setForm(f => ({ ...f, bookedBy: e.target.value }))} placeholder="Employee name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBookOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0" onClick={handleBook}>
              <Plus className="h-4 w-4 mr-2" /> Book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
