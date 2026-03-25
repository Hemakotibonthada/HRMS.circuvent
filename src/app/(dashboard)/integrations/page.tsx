"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plug, Search, Settings, CheckCircle, XCircle, RefreshCw, Key, Globe, Link2, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DataEmptyState } from "@/components/data-empty-state";

const INTEGRATIONS = [
  { id: "google", name: "Google Workspace", icon: "G", color: "from-red-500 to-orange-500", category: "Productivity", description: "Gmail, Calendar, Drive sync", connected: false },
  { id: "slack", name: "Slack", icon: "S", color: "from-purple-500 to-violet-600", category: "Communication", description: "Notifications, leave alerts, bot commands", connected: false },
  { id: "jira", name: "Jira", icon: "J", color: "from-blue-500 to-blue-700", category: "Project Management", description: "Issue tracking, sprint sync, timesheet", connected: false },
  { id: "razorpay", name: "Razorpay", icon: "R", color: "from-blue-600 to-cyan-500", category: "Payment", description: "Payroll disbursement, expense reimbursement", connected: false },
  { id: "teams", name: "Microsoft Teams", icon: "T", color: "from-violet-500 to-purple-700", category: "Communication", description: "Chat integration, meeting sync", connected: false },
  { id: "zoom", name: "Zoom", icon: "Z", color: "from-blue-500 to-blue-600", category: "Communication", description: "Interview scheduling, meeting links", connected: false },
  { id: "github", name: "GitHub", icon: "GH", color: "from-gray-700 to-black", category: "Development", description: "Code contributions, PR reviews tracking", connected: false },
  { id: "bamboohr", name: "BambooHR", icon: "B", color: "from-green-500 to-emerald-600", category: "HR", description: "Employee data sync, ATS integration", connected: false },
  { id: "quickbooks", name: "QuickBooks", icon: "Q", color: "from-green-600 to-green-800", category: "Accounting", description: "Payroll accounting, expense sync", connected: false },
  { id: "okta", name: "Okta SSO", icon: "O", color: "from-blue-500 to-indigo-600", category: "Security", description: "Single sign-on, identity management", connected: false },
];

const WEBHOOKS = [
  { id: "wh1", name: "Employee Onboarding", url: "https://hooks.example.com/onboard", events: ["employee.created"], active: true },
  { id: "wh2", name: "Leave Notifications", url: "https://hooks.example.com/leave", events: ["leave.approved", "leave.rejected"], active: true },
  { id: "wh3", name: "Payroll Processed", url: "https://hooks.example.com/payroll", events: ["payroll.processed"], active: false },
];

export default function IntegrationsPage() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("integrations");
  const [connectionStates, setConnectionStates] = useState<Record<string, boolean>>({});
  const [apiKeyDialog, setApiKeyDialog] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null);
  const [webhookDialog, setWebhookDialog] = useState(false);

  const filteredIntegrations = useMemo(() => {
    if (!search) return INTEGRATIONS;
    const q = search.toLowerCase();
    return INTEGRATIONS.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  }, [search]);

  const connectedCount = Object.values(connectionStates).filter(Boolean).length;
  const categories = [...new Set(INTEGRATIONS.map(i => i.category))];

  const toggleConnection = (id: string) => {
    setConnectionStates(prev => {
      const newState = !prev[id];
      toast.success(newState ? `${INTEGRATIONS.find(i => i.id === id)?.name} connected!` : `${INTEGRATIONS.find(i => i.id === id)?.name} disconnected`);
      return { ...prev, [id]: newState };
    });
  };

  const openApiKeyDialog = (id: string) => {
    setSelectedIntegration(id);
    setApiKeyDialog(true);
  };

  return (
    <div className="p-6 space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{connectedCount} of {INTEGRATIONS.length} connected</p>
        </div>
        <Button onClick={() => setWebhookDialog(true)} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md gap-2"><Webhook className="h-4 w-4" />Add Webhook</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Available", value: INTEGRATIONS.length, icon: Plug, color: "from-violet-500 to-purple-600" },
          { label: "Connected", value: connectedCount, icon: CheckCircle, color: "from-emerald-500 to-green-600" },
          { label: "Disconnected", value: INTEGRATIONS.length - connectedCount, icon: XCircle, color: "from-red-500 to-rose-600" },
          { label: "Categories", value: categories.length, icon: Globe, color: "from-blue-500 to-cyan-500" },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-md">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white", kpi.color)}><kpi.icon className="h-5 w-5" /></div>
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-xl font-bold">{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="integrations">Integrations</TabsTrigger><TabsTrigger value="apikeys">API Keys</TabsTrigger><TabsTrigger value="webhooks">Webhooks</TabsTrigger><TabsTrigger value="logs">Sync Log</TabsTrigger></TabsList>

        <TabsContent value="integrations" className="mt-4 space-y-4">
          <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search integrations..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filteredIntegrations.map(integration => {
              const isConnected = connectionStates[integration.id] || false;
              return (
                <Card key={integration.id} className={cn("border-0 shadow-sm hover:shadow-md transition-shadow", isConnected && "ring-1 ring-emerald-500/30")}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={cn("h-10 w-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white font-bold text-sm", integration.color)}>
                        {integration.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{integration.name}</p>
                        <Badge variant="outline" className="text-[10px]">{integration.category}</Badge>
                      </div>
                      <Switch checked={isConnected} onCheckedChange={() => toggleConnection(integration.id)} />
                    </div>
                    <p className="text-xs text-muted-foreground">{integration.description}</p>
                    <div className="flex gap-2 mt-3">
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => openApiKeyDialog(integration.id)}>
                        <Key className="h-3 w-3 mr-1" />Configure
                      </Button>
                      {isConnected && (
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => toast.success(`${integration.name} synced!`)}>
                          <RefreshCw className="h-3 w-3 mr-1" />Sync
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="apikeys" className="mt-4">
          <Card className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-lg">API Key Management</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {INTEGRATIONS.filter(i => connectionStates[i.id]).length === 0 ? (
                <DataEmptyState icon={Key} title="No API keys configured" description="Connect an integration to manage its API keys." />
              ) : (
                INTEGRATIONS.filter(i => connectionStates[i.id]).map(integration => (
                  <div key={integration.id} className="flex items-center gap-3 p-3 rounded-lg border">
                    <div className={cn("h-8 w-8 rounded-lg bg-gradient-to-br flex items-center justify-center text-white text-xs font-bold", integration.color)}>{integration.icon}</div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{integration.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">sk_****_****_{integration.id.substring(0, 4)}</p>
                    </div>
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => { openApiKeyDialog(integration.id); }}>
                      <Settings className="h-3 w-3 mr-1" />Edit
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks" className="mt-4">
          <Card className="border-0 shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Webhooks</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setWebhookDialog(true)} className="gap-1"><Webhook className="h-3 w-3" />Add</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {WEBHOOKS.map(wh => (
                <div key={wh.id} className="flex items-center gap-3 p-3 rounded-lg border">
                  <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white"><Webhook className="h-4 w-4" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{wh.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{wh.url}</p>
                    <div className="flex gap-1 mt-1">{wh.events.map(ev => <Badge key={ev} variant="secondary" className="text-[10px]">{ev}</Badge>)}</div>
                  </div>
                  <Switch checked={wh.active} onCheckedChange={() => toast.success(`Webhook ${wh.active ? "disabled" : "enabled"}`)} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card className="border-0 shadow-md">
            <CardHeader><CardTitle className="text-lg">Sync Log</CardTitle></CardHeader>
            <CardContent>
              {connectedCount === 0 ? (
                <DataEmptyState icon={RefreshCw} title="No sync activity" description="Connect integrations to see sync logs." />
              ) : (
                <div className="space-y-2">
                  {INTEGRATIONS.filter(i => connectionStates[i.id]).flatMap(i => [
                    { id: `${i.id}-1`, integration: i.name, action: "Full sync completed", status: "success", time: "2 min ago" },
                    { id: `${i.id}-2`, integration: i.name, action: "Incremental sync", status: "success", time: "15 min ago" },
                  ]).slice(0, 10).map(log => (
                    <div key={log.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 text-xs">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="font-medium">{log.integration}</span>
                      <span className="text-muted-foreground flex-1">{log.action}</span>
                      <span className="text-muted-foreground">{log.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* API Key Dialog */}
      <Dialog open={apiKeyDialog} onOpenChange={setApiKeyDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Configure {INTEGRATIONS.find(i => i.id === selectedIntegration)?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>API Key</Label><Input type="password" placeholder="Enter API key" /></div>
            <div><Label>API Secret</Label><Input type="password" placeholder="Enter API secret" /></div>
            <div><Label>Webhook URL (optional)</Label><Input placeholder="https://your-endpoint.com/webhook" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApiKeyDialog(false)}>Cancel</Button>
            <Button onClick={() => { setApiKeyDialog(false); toast.success("Configuration saved!"); }} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Webhook Dialog */}
      <Dialog open={webhookDialog} onOpenChange={setWebhookDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Webhook</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name</Label><Input placeholder="e.g., Slack Notification" /></div>
            <div><Label>Endpoint URL</Label><Input placeholder="https://hooks.example.com/endpoint" /></div>
            <div><Label>Events</Label><Input placeholder="employee.created, leave.approved" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWebhookDialog(false)}>Cancel</Button>
            <Button onClick={() => { setWebhookDialog(false); toast.success("Webhook added!"); }} className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">Add Webhook</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
