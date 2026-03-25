"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  CreditCard, Check, Users, Calendar, ArrowRight, Shield, Zap,
  Star, Download, Clock, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SUBSCRIPTION_PLANS } from "@/lib/constants";

const INVOICES = [
  { id: "INV-2026-003", date: "Mar 1, 2026", amount: "$1,200", status: "paid" as const, plan: "Professional" },
  { id: "INV-2026-002", date: "Feb 1, 2026", amount: "$1,200", status: "paid" as const, plan: "Professional" },
  { id: "INV-2026-001", date: "Jan 1, 2026", amount: "$1,200", status: "paid" as const, plan: "Professional" },
  { id: "INV-2025-012", date: "Dec 1, 2025", amount: "$750", status: "paid" as const, plan: "Starter" },
];

export default function BillingPage() {
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const currentPlan = SUBSCRIPTION_PLANS[1]; // Professional
  const currentEmployees = 148;
  const maxEmployees = 200;
  const employeeUsage = (currentEmployees / maxEmployees) * 100;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="animate-slide-up">
        <h1 className="text-2xl font-bold tracking-tight">Subscription & Billing</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Manage your plan, billing, and invoices</p>
      </div>

      {/* Current Plan */}
      <Card className="overflow-hidden animate-slide-up" style={{ animationDelay: "80ms" }}>
        <div className="bg-gradient-to-r from-violet-500 to-purple-600 p-6 text-white">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-white/20 text-white border-0 backdrop-blur-sm">
                  <Star className="h-3 w-3 mr-1 fill-white" /> {currentPlan.name} Plan
                </Badge>
                <Badge className="bg-emerald-400/20 text-emerald-100 border-0">Active</Badge>
              </div>
              <h2 className="text-3xl font-extrabold mt-3">
                ${currentPlan.price}<span className="text-lg font-normal opacity-80">/{currentPlan.interval}</span>
              </h2>
              <p className="text-sm opacity-70 mt-1">Billed monthly — Next billing: April 1, 2026</p>
            </div>
            <Button
              onClick={() => setIsUpgradeOpen(true)}
              className="bg-white text-violet-600 hover:bg-white/90 shadow-lg border-0"
            >
              Upgrade Plan <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardContent className="p-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Employee Usage</p>
              <p className="mt-1 text-lg font-bold">{currentEmployees} / {maxEmployees}</p>
              <Progress value={employeeUsage} className="mt-2 h-2" />
              {employeeUsage > 80 && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Approaching limit — consider upgrading
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Monthly Cost</p>
              <p className="mt-1 text-lg font-bold">${currentPlan.price * currentEmployees}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{currentEmployees} × ${currentPlan.price}/employee</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Storage Used</p>
              <p className="mt-1 text-lg font-bold">23.4 GB / 50 GB</p>
              <Progress value={46.8} className="mt-2 h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plan Features */}
      <Card className="animate-slide-up" style={{ animationDelay: "160ms" }}>
        <CardHeader>
          <CardTitle className="text-base">Your Plan Includes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {currentPlan.features.map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Billing History */}
      <Card className="animate-slide-up" style={{ animationDelay: "240ms" }}>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Billing History</CardTitle>
            <CardDescription>Download past invoices</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {INVOICES.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between rounded-xl border border-border/50 p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{invoice.id}</p>
                    <p className="text-xs text-muted-foreground">{invoice.plan} Plan — {invoice.date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold">{invoice.amount}</span>
                  <Badge className="status-active text-xs border-0">Paid</Badge>
                  <Button variant="ghost" size="icon-xs">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Upgrade Dialog */}
      <Dialog open={isUpgradeOpen} onOpenChange={setIsUpgradeOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Choose Your Plan</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4 sm:grid-cols-3">
            {SUBSCRIPTION_PLANS.map((plan) => {
              const isCurrent = plan.id === currentPlan.id;
              const isSelected = selectedPlan === plan.id;
              return (
                <div
                  key={plan.id}
                  onClick={() => !isCurrent && setSelectedPlan(plan.id)}
                  className={cn(
                    "relative rounded-xl border-2 p-5 cursor-pointer transition-all",
                    isCurrent && "border-primary bg-primary/5 cursor-default",
                    isSelected && !isCurrent && "border-primary ring-2 ring-primary/20",
                    !isCurrent && !isSelected && "border-border hover:border-primary/40"
                  )}
                >
                  {plan.popular && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 text-[10px]">
                      Popular
                    </Badge>
                  )}
                  {isCurrent && (
                    <Badge className="absolute -top-2.5 right-3 bg-primary text-primary-foreground border-0 text-[10px]">
                      Current
                    </Badge>
                  )}
                  <h3 className="font-semibold">{plan.name}</h3>
                  <div className="mt-2 flex items-baseline gap-0.5">
                    <span className="text-2xl font-extrabold">${plan.price}</span>
                    <span className="text-xs text-muted-foreground">/{plan.interval}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {plan.maxEmployees === -1 ? "Unlimited" : `Up to ${plan.maxEmployees}`} employees
                  </p>
                  <ul className="mt-4 space-y-2">
                    {plan.features.slice(0, 5).map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs">
                        <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                    {plan.features.length > 5 && (
                      <li className="text-xs text-muted-foreground">+{plan.features.length - 5} more features</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUpgradeOpen(false)}>Cancel</Button>
            <Button
              disabled={!selectedPlan || selectedPlan === currentPlan.id}
              className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0"
            >
              {selectedPlan && SUBSCRIPTION_PLANS.findIndex((p) => p.id === selectedPlan) > SUBSCRIPTION_PLANS.findIndex((p) => p.id === currentPlan.id)
                ? "Upgrade Plan"
                : "Switch Plan"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
