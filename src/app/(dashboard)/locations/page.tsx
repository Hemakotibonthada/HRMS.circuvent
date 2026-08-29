"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Building2, Search, Plus, MapPin, Users, Globe, LayoutGrid, List, Wifi, Coffee, ParkingCircle, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { create } from "zustand";
import { useEmployeeStore, startSync, type BaseRecord } from "@/stores/unified-store";
import { DataEmptyState, DataLoadingSkeleton } from "@/components/data-empty-state";
import { genericService, COLLECTIONS } from "@/lib/collection-service";

// ─── Inline Location Store ──────────────────────────────────
interface LocationDoc extends BaseRecord {
  name: string; address: string; city: string; state: string;
  country: string; capacity: number; amenities: string[];
  type: string; status: string; timezone: string;
}

interface LocationStore {
  items: LocationDoc[]; loading: boolean; initialized: boolean; error: string | null;
  addItem: (item: LocationDoc) => void; updateItem: (id: string, u: Partial<LocationDoc>) => void; removeItem: (id: string) => void;
  setItems: (items: LocationDoc[]) => void; setLoading: (v: boolean) => void;
  setInitialized: (v: boolean) => void; setError: (e: string | null) => void;
}

const useLocationStore = create<LocationStore>((set) => ({
  items: [], loading: false, initialized: false, error: null as string | null,
  setItems: (items) => set({ items, loading: false, initialized: true }),
  setLoading: (loading) => set({ loading }),
  setInitialized: (initialized) => set({ initialized }),
  setError: (error) => set({ error }),
  addItem: (item) => set((s) => ({ items: [item, ...s.items] })),
  updateItem: (id, updates) => set((s) => ({ items: s.items.map(i => i.id === id ? { ...i, ...updates } : i) })),
  removeItem: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
}));

const COLLECTION_LOCATIONS = "office_locations";
const LOCATION_TYPES = ["Headquarters", "Branch Office", "Remote Hub", "Coworking", "Data Center"];
const AMENITY_OPTIONS = ["WiFi", "Parking", "Cafeteria", "Gym", "Conference Rooms", "Play Zone", "Library", "Creche"];
const AMENITY_ICONS: Record<string, typeof Wifi> = { WiFi: Wifi, Parking: ParkingCircle, Cafeteria: Coffee, Gym: Dumbbell };

export default function LocationsPage() {
  const store = useLocationStore();
  const empStore = useEmployeeStore();
  const { items, loading, initialized } = store;
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);

  useEffect(() => {
    if (!initialized) startSync(COLLECTION_LOCATIONS, store as unknown as Parameters<typeof startSync>[1]);
    if (!empStore.initialized) startSync(COLLECTIONS.employees, empStore);
  }, [initialized, store, empStore]);

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(l => l.name?.toLowerCase().includes(q) || l.city?.toLowerCase().includes(q) || l.country?.toLowerCase().includes(q));
  }, [items, search]);

  const employeesByLocation = useMemo(() => {
    const locMap = new Map<string, number>();
    empStore.items.forEach(e => {
      const loc = e.location || "Unknown";
      locMap.set(loc, (locMap.get(loc) || 0) + 1);
    });
    return locMap;
  }, [empStore.items]);

  const totalLocations = items.length;
  const totalCapacity = items.reduce((s, l) => s + (l.capacity || 0), 0);
  const cities = new Set(items.map(l => l.city)).size;
  const countries = new Set(items.map(l => l.country)).size;

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      name: fd.get("name") as string,
      address: fd.get("address") as string,
      city: fd.get("city") as string,
      state: fd.get("state") as string,
      country: fd.get("country") as string,
      capacity: Number(fd.get("capacity")) || 0,
      type: fd.get("type") as string,
      amenities: selectedAmenities,
      status: "active",
      timezone: fd.get("timezone") as string || "IST",
    };
    try {
      await genericService(COLLECTION_LOCATIONS).create(data);
      toast.success("Location added!");
      setCreateOpen(false);
      setSelectedAmenities([]);
    } catch { toast.error("Failed to add location"); }
  };

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities(prev => prev.includes(amenity) ? prev.filter(a => a !== amenity) : [...prev, amenity]);
  };

  if (loading && !initialized) return <div className="p-6"><DataLoadingSkeleton /></div>;

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Office Locations</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{totalLocations} locations &middot; {cities} cities</p>
        </div>
        <div className="flex gap-2">
          <div className="flex border rounded-lg">
            <Button variant={view === "grid" ? "secondary" : "ghost"} size="sm" onClick={() => setView("grid")}><LayoutGrid className="h-4 w-4" /></Button>
            <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" onClick={() => setView("list")}><List className="h-4 w-4" /></Button>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"><Plus className="h-4 w-4" />Add Location</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Locations", value: totalLocations, icon: Building2, color: "from-violet-500 to-purple-600" },
          { label: "Total Capacity", value: totalCapacity, icon: Users, color: "from-blue-500 to-cyan-500" },
          { label: "Cities", value: cities, icon: MapPin, color: "from-emerald-500 to-green-600" },
          { label: "Countries", value: countries, icon: Globe, color: "from-amber-500 to-orange-500" },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-md">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white", kpi.color)}><kpi.icon className="h-5 w-5" /></div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-xl font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search locations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>

      {filtered.length === 0 ? (
        <DataEmptyState icon={Building2} title="No office locations" description="Add your office locations to manage your distributed workforce." actionLabel="Add Location" onAction={() => setCreateOpen(true)} />
      ) : view === "grid" ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(loc => {
            const empCount = employeesByLocation.get(loc.name) || employeesByLocation.get(loc.city) || 0;
            return (
              <Card key={loc.id} className="border-0 shadow-md hover:shadow-lg transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white"><Building2 className="h-5 w-5" /></div>
                    <Badge variant={loc.status === "active" ? "default" : "secondary"} className="text-xs">{loc.type || "Office"}</Badge>
                  </div>
                  <h3 className="font-bold text-sm">{loc.name}</h3>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><MapPin className="h-3 w-3" />{loc.address}, {loc.city}</p>
                  <div className="flex items-center justify-between mt-3 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground"><Users className="h-3 w-3" />{empCount} employees</span>
                    <span className="text-muted-foreground">Capacity: {loc.capacity}</span>
                  </div>
                  {loc.amenities?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {loc.amenities.map(a => <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(loc => {
            const empCount = employeesByLocation.get(loc.name) || employeesByLocation.get(loc.city) || 0;
            return (
              <Card key={loc.id} className="border-0 shadow-sm">
                <CardContent className="p-3 flex items-center gap-4">
                  <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white"><Building2 className="h-4 w-4" /></div>
                  <div className="flex-1"><p className="text-sm font-semibold">{loc.name}</p><p className="text-xs text-muted-foreground">{loc.city}, {loc.country}</p></div>
                  <span className="text-xs text-muted-foreground">{empCount} employees</span>
                  <span className="text-xs text-muted-foreground">Cap: {loc.capacity}</span>
                  <Badge variant="outline" className="text-xs">{loc.type}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ENHANCED ADD LOCATION DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">Add Office Facility</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Register regional office hubs, capacity benchmarks, and campus amenities.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Location / Facility Name <span className="text-destructive">*</span></Label>
              <Input name="name" required placeholder="e.g. Bengaluru Innovation Hub, London Tech Center" className="h-9 text-xs" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Street &amp; Campus Address <span className="text-destructive">*</span></Label>
              <Textarea name="address" rows={2} required placeholder="Building, floor, tech park, street..." className="text-xs resize-none" />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">City <span className="text-destructive">*</span></Label>
                <Input name="city" required placeholder="Bengaluru" className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">State / Region</Label>
                <Input name="state" placeholder="Karnataka" className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Country <span className="text-destructive">*</span></Label>
                <Input name="country" required defaultValue="India" className="h-9 text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Max Capacity</Label>
                <Input name="capacity" type="number" defaultValue={250} required className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Facility Type</Label>
                <Select name="type" defaultValue={LOCATION_TYPES[0]}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    {LOCATION_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Timezone</Label>
                <Input name="timezone" defaultValue="Asia/Kolkata (IST)" className="h-9 text-xs" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Campus Amenities &amp; Services</Label>
              <div className="flex flex-wrap gap-1.5 mt-1 p-2.5 rounded-lg border bg-muted/20">
                {AMENITY_OPTIONS.map(a => {
                  const selected = selectedAmenities.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => toggleAmenity(a)}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer",
                        selected
                          ? "bg-violet-600 text-white border-violet-600 shadow-xs"
                          : "bg-background text-muted-foreground border-border hover:bg-muted"
                      )}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button type="button" variant="outline" className="rounded-full text-xs h-9 px-4" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md hover:shadow-lg transition-all gap-1.5">
                <Plus className="h-4 w-4" /> Save Facility
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
