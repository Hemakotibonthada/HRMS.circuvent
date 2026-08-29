"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/hooks/use-auth";
import {
  Building2, Users, Clock, DollarSign, CalendarDays, Target, GraduationCap,
  UserPlus, BarChart3, Shield, Zap, Globe, ArrowRight, Check, Star,
  Briefcase, Award, ChevronRight, Menu, X, Sparkles, Lock, CheckCircle2,
  Heart, FileText, Smartphone, TrendingUp, Layers, ShieldCheck,
  Headphones, ChevronDown, HelpCircle, UserCheck, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GetTheApp } from "@/components/get-the-app";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { SUBSCRIPTION_PLANS } from "@/lib/constants";
import { MODULE_PERMISSION_MAP } from "@/lib/rbac";
import { PT_SLABS } from "@/lib/statutory-india";

function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          let start = 0;
          const duration = 1800;
          const steps = 60;
          const increment = target / steps;
          const interval = duration / steps;
          const timer = setInterval(() => {
            start += increment;
            if (start >= target) {
              setCount(target);
              clearInterval(timer);
            } else {
              setCount(Math.floor(start));
            }
          }, interval);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={ref} className="animate-counter-pulse font-extrabold tracking-tight">
      {count}
      {suffix}
    </span>
  );
}

function ScrollReveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.12 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8",
        className
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

const MODULE_COUNT = Object.keys(MODULE_PERMISSION_MAP).length;
const PT_STATE_COUNT = Object.keys(PT_SLABS).length;

const STATS = [
  { value: MODULE_COUNT, suffix: "+", label: "Integrated HR Modules", desc: "From hire to retire in one OS" },
  { value: PT_STATE_COUNT, suffix: "", label: "States PT Compliant", desc: "Automated Indian statutory tax" },
  { value: 100, suffix: "%", label: "Tenant Data Isolation", desc: "Postgres RLS enterprise privacy" },
  { value: 2, suffix: "", label: "Tax Regimes Supported", desc: "Old & New regime auto-switch" },
];

const SUITE_TABS = [
  {
    id: "people",
    title: "Employee Directory & Org",
    tagline: "Unify every employee record, document, and team hierarchy",
    badge: "Core HR",
    icon: Users,
    color: "from-violet-500 to-purple-600",
    image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=1000&q=80",
    features: [
      "Dynamic visual org chart with reporting chains & department matrix",
      "360° employee profiles with bank, statutory, emergency & asset data",
      "Encrypted document vault with policy acknowledgments & e-signatures",
      "Automated lifecycle workflows for onboarding, transfers, and promotions",
    ],
    metric: { value: "100%", label: "Digital Onboarding & Paperless Records" },
  },
  {
    id: "attendance",
    title: "Time, Shifts & Geofencing",
    tagline: "Effortless clock-in, biometric sync, and GPS-verified attendance",
    badge: "Time & Attendance",
    icon: Clock,
    color: "from-blue-500 to-cyan-500",
    image: "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1000&q=80",
    features: [
      "GPS geofenced mobile check-in with live boundary validation",
      "Multi-shift scheduling with rotation rules, grace periods & overtime",
      "Regularization request flow with 1-click manager approval routing",
      "Real-time attendance dashboard syncing seamlessly with payroll",
    ],
    metric: { value: "99.8%", label: "Time Tracking Accuracy & Sync" },
  },
  {
    id: "payroll",
    title: "Payroll & Statutory Compliance",
    tagline: "One-click salary disbursement with automated PF, ESI, PT & TDS",
    badge: "Payroll Engine",
    icon: DollarSign,
    color: "from-emerald-500 to-green-600",
    image: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=1000&q=80",
    features: [
      "Automated Indian payroll computation adhering to all central/state laws",
      "PF, ESI, Professional Tax across all states, and TDS regime calculations",
      "One-click bank transfer export file generation & digital payslip delivery",
      "Reimbursements, loans, overtime payouts, and salary advance deductions",
    ],
    metric: { value: "10x", label: "Faster Monthly Payroll Cycles" },
  },
  {
    id: "performance",
    title: "Performance, OKRs & Reviews",
    tagline: "Drive high performance with structured appraisals and milestones",
    badge: "Talent & Growth",
    icon: Target,
    color: "from-amber-500 to-orange-500",
    image: "https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1000&q=80",
    features: [
      "Quarterly & annual OKR tracking with weighted progress indicators",
      "360-degree appraisal cycles with multi-rater competency assessments",
      "Continuous feedback wall, milestone badges, and performance plans (PIP)",
      "Calibration matrix and analytics for merit cycles and promotions",
    ],
    metric: { value: "360°", label: "Holistic Review & Goal Alignment" },
  },
  {
    id: "culture",
    title: "Culture, Wellness & Recognition",
    tagline: "Empower employees with kudos, health challenges, and social wall",
    badge: "Employee Experience",
    icon: Heart,
    color: "from-pink-500 to-rose-600",
    image: "https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=1000&q=80",
    features: [
      "Peer-to-peer Kudos recognition wall with redeemable reward points",
      "Wellness tracker for physical fitness, mental health & balance programs",
      "Company social feed with team wins, announcements, and polls",
      "Automated celebration wishes for birthdays, promotions & work milestones",
    ],
    metric: { value: "94%", label: "Employee Engagement & Satisfaction" },
  },
];

const FEATURES_GRID = [
  { icon: Users, title: "Employee Directory", desc: "Complete 360° profiles, dynamic org charts, and life-cycle history.", color: "from-violet-500 to-purple-600" },
  { icon: Clock, title: "Smart Attendance & Shifts", desc: "Geofenced clock-in, overtime rules, shift rosters, and biometric sync.", color: "from-blue-500 to-cyan-500" },
  { icon: CalendarDays, title: "Leave Engine", desc: "Custom leave types, multi-tier approvals, encashment, and balance forecasting.", color: "from-amber-500 to-orange-500" },
  { icon: DollarSign, title: "Automated Payroll", desc: "One-click salary runs with built-in PF, ESI, PT, TDS, and direct bank payouts.", color: "from-emerald-500 to-green-600" },
  { icon: UserPlus, title: "Recruitment & ATS", desc: "Career portal, pipeline boards, resume parsing, and interview scheduling.", color: "from-pink-500 to-rose-600" },
  { icon: Target, title: "Goals & Performance", desc: "Strategic OKRs, 360° appraisals, competency scoring, and calibration.", color: "from-red-500 to-orange-500" },
  { icon: GraduationCap, title: "LMS & Skill Academy", desc: "Curriculum publishing, mandatory compliance courses, and certifications.", color: "from-indigo-500 to-blue-600" },
  { icon: Award, title: "Rewards & Kudos", desc: "Peer recognition wall, anniversary awards, and custom milestone badges.", color: "from-yellow-500 to-amber-500" },
  { icon: BarChart3, title: "HR Intelligence & Analytics", desc: "Real-time workforce headcount, attrition analysis, and payroll audits.", color: "from-purple-500 to-violet-600" },
  { icon: ShieldCheck, title: "Compliance Hub", desc: "Audit logs, statutory returns, NDA acknowledgments, and policy management.", color: "from-teal-500 to-emerald-600" },
  { icon: Headphones, title: "Helpdesk & Service Desk", desc: "SLA-tracked ticketing for IT access, hardware, facilities, and HR inquiries.", color: "from-sky-500 to-blue-600" },
  { icon: Smartphone, title: "Employee Self-Service", desc: "Mobile-first portal for leave applications, payslip downloads, and expenses.", color: "from-fuchsia-500 to-purple-600" },
];

const FAQS = [
  {
    q: "How does Circuvent HRMS handle Indian statutory payroll & compliance?",
    a: "Circuvent HRMS comes pre-configured with the latest Indian statutory formulas for Provident Fund (PF), Employee State Insurance (ESI), Professional Tax (PT) across all states/UTs, and Tax Deducted at Source (TDS) under both Old and New Tax Regimes.",
  },
  {
    q: "Is tenant data strictly isolated for enterprise security?",
    a: "Yes. Circuvent HRMS utilizes PostgreSQL Row-Level Security (RLS) and strict cryptographic tenant isolation verified by continuous automated compliance checks, ensuring no tenant can ever access another company's data.",
  },
  {
    q: "Can we track mobile attendance with GPS geofencing?",
    a: "Yes! Employees can clock in and out directly via mobile browser or app. HR can configure approved office locations with geofence radius restrictions, preventing punches outside verified workplaces.",
  },
  {
    q: "How fast can we migrate our existing employee database?",
    a: "You can import existing workforce data via bulk CSV/Excel upload in under 5 minutes. Profiles, departments, designations, and leave balances are mapped automatically.",
  },
  {
    q: "Is there a free trial, and do I need a credit card?",
    a: "All subscription tiers come with a full-featured 14-day free trial. No credit card is required to create your organisation and explore all 91 modules.",
  },
];

export default function LandingPage() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSuiteTab, setActiveSuiteTab] = useState("people");
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const ctaHref = user ? "/dashboard" : "/login";
  const currentTab = SUITE_TABS.find(t => t.id === activeSuiteTab) || SUITE_TABS[0];

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground selection:bg-violet-500 selection:text-white">
      {/* Animated background glowing ambiance */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[550px] w-[550px] rounded-full bg-violet-400/20 blur-3xl animate-blob" />
        <div className="absolute top-1/3 -right-32 h-[450px] w-[450px] rounded-full bg-purple-400/15 blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute -bottom-32 left-1/3 h-[500px] w-[500px] rounded-full bg-indigo-400/15 blur-3xl animate-blob animation-delay-4000" />
        <div className="absolute top-2/3 right-1/4 h-[380px] w-[380px] rounded-full bg-fuchsia-400/10 blur-3xl animate-blob animation-delay-3000" />
      </div>

      {/* Top Banner */}
      <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 py-1.5 px-4 text-center text-xs font-semibold text-white tracking-wide">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 animate-spin" />
          <span>Next-Gen Enterprise Workforce Platform &mdash; 91 Modules, 100% Tenant Isolation, India Statutory Ready</span>
        </span>
      </div>

      {/* Sticky Navbar */}
      <nav
        className={cn(
          "sticky top-0 left-0 right-0 z-50 transition-all duration-300",
          scrolled
            ? "bg-background/85 backdrop-blur-xl border-b border-border/60 shadow-sm"
            : "bg-background/60 backdrop-blur-md"
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md transition-transform group-hover:scale-105">
              <Building2 className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              Circuvent <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">HRMS</span>
            </span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#suite-explorer" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
              Product Suite
            </a>
            <a href="#features" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#experience" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
              Employee App
            </a>
            <a href="#pricing" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </a>
            <a href="#faq" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
              FAQ
            </a>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <ThemeToggle />
            {user ? (
              <Button asChild className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 border-0 shadow-md hover:shadow-lg transition-all hover:scale-102">
                <Link href="/dashboard">Open Dashboard <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild className="rounded-full text-xs h-9 px-4">
                  <Link href="/login">Sign In</Link>
                </Button>
                <Button asChild className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 border-0 shadow-md hover:shadow-lg transition-all hover:scale-102">
                  <Link href="/register">Get Started Free</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t bg-background/95 backdrop-blur-xl p-4 md:hidden animate-slide-up">
            <div className="flex flex-col gap-2">
              <a href="#suite-explorer" className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>Product Suite</a>
              <a href="#features" className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>Features</a>
              <a href="#experience" className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>Employee Experience</a>
              <a href="#pricing" className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
              <a href="#faq" className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
              <div className="flex gap-2 pt-2 border-t mt-2">
                <Button variant="outline" asChild className="flex-1 rounded-full text-xs">
                  <Link href="/login">Sign In</Link>
                </Button>
                <Button asChild className="flex-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs border-0">
                  <Link href="/register">Get Started Free</Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* HERO SECTION */}
      <section className="relative pt-20 pb-20 sm:pt-28 sm:pb-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-4xl text-center">
            <ScrollReveal>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-200/80 bg-violet-50/80 px-4 py-1.5 text-xs font-semibold text-violet-800 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-300 shadow-xs">
                <Zap className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                Next-Generation Cloud HR &amp; Workforce Operating System
              </div>
            </ScrollReveal>

            <ScrollReveal delay={100}>
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl text-foreground leading-[1.12]">
                Empower Your People.{" "}
                <span className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent animate-gradient">
                  Automate Everything.
                </span>
              </h1>
            </ScrollReveal>

            <ScrollReveal delay={200}>
              <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed">
                Streamline employee lifecycles, geofenced biometric attendance, one-click statutory payroll,
                OKR appraisals, and peer kudos — unified in one lightning-fast platform.
              </p>
            </ScrollReveal>

            <ScrollReveal delay={300}>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  size="lg"
                  asChild
                  className="h-12 px-8 bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold rounded-full border-0 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] gap-2"
                >
                  <Link href={ctaHref}>
                    Start 14-Day Free Trial <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="h-12 px-8 font-semibold rounded-full"
                >
                  <a href="#suite-explorer">
                    Explore 91 Modules <ChevronRight className="ml-1 h-4 w-4" />
                  </a>
                </Button>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={400}>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> 14-Day Free Trial</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> No Credit Card Required</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Instant Cloud Setup</span>
              </div>
            </ScrollReveal>
          </div>

          {/* Hero Visual Mockup with High-Resolution Workplace Photography & Floating Cards */}
          <ScrollReveal delay={500} className="mt-14">
            <div className="relative mx-auto max-w-5xl rounded-2xl p-2 bg-gradient-to-b from-border/80 via-border/40 to-transparent shadow-2xl border">
              <div className="relative overflow-hidden rounded-xl bg-card border shadow-inner aspect-video max-h-[560px]">
                {/* Background high-res workplace stock photo */}
                <Image
                  src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1400&q=80"
                  alt="Modern agile team collaborating with Circuvent HRMS"
                  fill
                  priority
                  className="object-cover object-center opacity-30 dark:opacity-20 transition-transform duration-700 hover:scale-102"
                />

                {/* Gradient tint overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />

                {/* In-app Dashboard Header Simulation */}
                <div className="absolute top-0 left-0 right-0 p-4 border-b bg-background/70 backdrop-blur-md flex items-center justify-between z-10">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="h-3 w-3 rounded-full bg-red-400/80" />
                      <div className="h-3 w-3 rounded-full bg-amber-400/80" />
                      <div className="h-3 w-3 rounded-full bg-emerald-400/80" />
                    </div>
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-violet-500" /> Circuvent HRMS Enterprise Console
                    </span>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 text-[10px] font-bold">
                    ● Live System Active
                  </Badge>
                </div>

                {/* Center Content & Floating UI Widgets */}
                <div className="absolute inset-0 pt-16 p-6 flex flex-col justify-between pointer-events-none">
                  {/* Top floating cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-background/90 backdrop-blur-md border shadow-lg space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground font-medium">Headcount Active</span>
                        <Badge variant="outline" className="text-[10px] text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40">98.4% Present</Badge>
                      </div>
                      <p className="text-lg font-black text-foreground">1,248 Employees</p>
                      <p className="text-[10px] text-muted-foreground">Across 6 Office Locations</p>
                    </div>

                    <div className="p-3 rounded-xl bg-background/90 backdrop-blur-md border shadow-lg space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground font-medium">Monthly Payroll</span>
                        <Badge variant="outline" className="text-[10px] text-violet-600 bg-violet-50 dark:bg-violet-950/40">Computed</Badge>
                      </div>
                      <p className="text-lg font-black text-foreground">₹48,25,000</p>
                      <p className="text-[10px] text-muted-foreground">PF, ESI &amp; TDS Pre-deducted</p>
                    </div>

                    <div className="hidden sm:block p-3 rounded-xl bg-background/90 backdrop-blur-md border shadow-lg space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground font-medium">Performance OKRs</span>
                        <Badge variant="outline" className="text-[10px] text-blue-600 bg-blue-50 dark:bg-blue-950/40">Q3 Pacing</Badge>
                      </div>
                      <p className="text-lg font-black text-foreground">87.5% On Track</p>
                      <p className="text-[10px] text-muted-foreground">360° Review Cycles Active</p>
                    </div>
                  </div>

                  {/* Bottom floating notification cards */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                    <div className="p-2.5 px-4 rounded-full bg-violet-600/90 text-white backdrop-blur-md shadow-xl flex items-center gap-2 text-xs font-semibold">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Aditi Rao awarded 'Team Player 🤝' Kudos (+100 pts)</span>
                    </div>

                    <div className="p-2.5 px-4 rounded-full bg-background/90 text-foreground border shadow-xl flex items-center gap-2 text-xs font-semibold">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Leave Request Approved &middot; 3 Days Annual Leave</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* STATS NUMERICAL BAR */}
      <section className="py-14 border-y border-border/40 bg-muted/20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {STATS.map((stat, i) => (
              <ScrollReveal key={i} delay={i * 90} className="text-center p-3">
                <div className="text-3xl font-black text-foreground sm:text-4xl">
                  <AnimatedCounter target={stat.value} suffix={stat.suffix} />
                </div>
                <p className="mt-1 text-xs font-bold text-foreground">{stat.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{stat.desc}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* INTERACTIVE PRODUCT SUITE EXPLORER (TABBED SHOWCASE WITH RICH IMAGERY) */}
      <section id="suite-explorer" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <ScrollReveal className="mx-auto max-w-3xl text-center mb-12">
            <Badge variant="outline" className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              Interactive Product Tour
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
              Explore the 5 Pillars of Modern{" "}
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                Workforce Management
              </span>
            </h2>
            <p className="mt-3 text-muted-foreground text-sm sm:text-base">
              Click through the modules below to see how Circuvent HRMS streamlines daily operations.
            </p>
          </ScrollReveal>

          {/* Navigation Pill Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
            {SUITE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeSuiteTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSuiteTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold transition-all cursor-pointer",
                    active
                      ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md scale-105"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground border border-border"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.title}</span>
                </button>
              );
            })}
          </div>

          {/* Active Tab Interactive Display Card */}
          <div className="card-glass rounded-2xl border p-6 sm:p-10 shadow-xl">
            <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
              {/* Left Column: Content & Features */}
              <div className="space-y-5 lg:col-span-6">
                <div className="flex items-center gap-2">
                  <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 text-xs font-bold">
                    {currentTab.badge}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{currentTab.metric.label}</span>
                </div>

                <div>
                  <h3 className="text-2xl font-bold text-foreground">{currentTab.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{currentTab.tagline}</p>
                </div>

                <div className="p-4 rounded-xl border bg-muted/20">
                  <div className="text-2xl font-black text-foreground">{currentTab.metric.value}</div>
                  <div className="text-xs text-muted-foreground">{currentTab.metric.label}</div>
                </div>

                <ul className="space-y-2.5">
                  {currentTab.features.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-xs text-foreground">
                      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        <Check className="h-3 w-3" />
                      </div>
                      <span className="leading-relaxed">{feat}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-2">
                  <Button asChild className="bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-full text-xs h-9 px-5 shadow-md gap-1.5">
                    <Link href={ctaHref}>
                      Experience {currentTab.badge} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Right Column: High-Res Stock Photography Card */}
              <div className="relative lg:col-span-6 overflow-hidden rounded-xl border shadow-lg h-[340px] sm:h-[400px]">
                <Image
                  src={currentTab.image}
                  alt={currentTab.title}
                  fill
                  className="object-cover object-center transition-transform duration-700 hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 p-3 rounded-xl bg-background/85 backdrop-blur-md border text-xs font-semibold flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <currentTab.icon className="h-4 w-4 text-violet-500" />
                    <span>Circuvent &middot; {currentTab.title}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/40">Verified</Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPREHENSIVE FEATURES GRID (ALL 12 CORE WORKFORCE CAPABILITIES) */}
      <section id="features" className="py-24 bg-muted/20 border-y border-border/40">
        <div className="mx-auto max-w-7xl px-6">
          <ScrollReveal className="mx-auto max-w-3xl text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
              Everything Needed to Run a High-Performance{" "}
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                Workforce
              </span>
            </h2>
            <p className="mt-3 text-muted-foreground text-sm sm:text-base">
              91 modules built from the ground up to replace fragmented point solutions.
            </p>
          </ScrollReveal>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES_GRID.map((feat, i) => {
              const Icon = feat.icon;
              return (
                <ScrollReveal key={i} delay={i * 60}>
                  <div className="card-glass rounded-2xl p-5 border hover:border-violet-500/50 hover:shadow-lg transition-all group h-full flex flex-col justify-between">
                    <div>
                      <div className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md mb-3 transition-transform group-hover:scale-110", feat.color)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="text-base font-bold text-foreground">{feat.title}</h3>
                      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{feat.desc}</p>
                    </div>
                    <div className="mt-4 pt-3 border-t flex items-center text-[11px] font-semibold text-violet-600 dark:text-violet-400">
                      <span>Included in All Plans</span>
                      <ChevronRight className="h-3.5 w-3.5 ml-1 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* MOBILE EMPLOYEE APP & SELF-SERVICE EXPERIENCE */}
      <section id="experience" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
            {/* Left Image Mockup */}
            <ScrollReveal className="lg:col-span-6 relative overflow-hidden rounded-2xl border shadow-2xl h-[380px] sm:h-[450px]">
              <Image
                src="https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=1000&q=80"
                alt="Employee mobile self-service app on modern smartphone"
                fill
                className="object-cover object-center"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 p-4 rounded-xl bg-background/90 backdrop-blur-md border space-y-1">
                <p className="font-bold text-xs text-foreground flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5 text-violet-500" /> Circuvent PWA &amp; Mobile Experience
                </p>
                <p className="text-[11px] text-muted-foreground">Fast attendance, payslip downloads, and instant leave approvals from any iOS or Android device.</p>
              </div>
            </ScrollReveal>

            {/* Right Copy */}
            <ScrollReveal delay={150} className="lg:col-span-6 space-y-6">
              <div>
                <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 text-xs font-bold mb-2">
                  Mobile First
                </Badge>
                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
                  Your Entire Office in Every Employee&apos;s Pocket
                </h2>
                <p className="mt-3 text-muted-foreground text-sm leading-relaxed">
                  Give staff self-service empowerment with instant digital requests, real-time geofenced clocking,
                  statutory salary slips, and peer recognition.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "1-Tap Attendance", desc: "GPS geofence verified check-ins" },
                  { label: "Digital Paystubs", desc: "Encrypted PDF download anytime" },
                  { label: "Instant Leave", desc: "Balance tracking and fast approvals" },
                  { label: "Peer Kudos", desc: "Send points & appreciation notes" },
                ].map((perk, i) => (
                  <div key={i} className="p-3 rounded-xl border bg-muted/20">
                    <p className="font-bold text-xs text-foreground">{perk.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{perk.desc}</p>
                  </div>
                ))}
              </div>

              <div>
                <GetTheApp />
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* PRICING SECTION */}
      <section id="pricing" className="py-24 bg-muted/20 border-y border-border/40">
        <div className="mx-auto max-w-7xl px-6">
          <ScrollReveal className="mx-auto max-w-3xl text-center mb-16">
            <Badge variant="outline" className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              Transparent Plans
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
              Predictable, Transparent Pricing for{" "}
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                Growing Teams
              </span>
            </h2>
            <p className="mt-3 text-muted-foreground text-sm sm:text-base">
              Start with a 14-day free trial. No hidden fees, no per-module add-ons.
            </p>
          </ScrollReveal>

          <div className="grid gap-8 lg:grid-cols-3 max-w-6xl mx-auto">
            {SUBSCRIPTION_PLANS.map((plan, i) => (
              <ScrollReveal key={plan.id} delay={i * 120}>
                <div
                  className={cn(
                    "relative card-glass rounded-2xl p-8 border flex flex-col justify-between h-full transition-all",
                    plan.popular ? "ring-2 ring-violet-500 shadow-xl scale-[1.02] bg-card" : "bg-card/70"
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-1 text-xs font-bold text-white shadow-md">
                      Most Popular
                    </div>
                  )}

                  <div>
                    <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-black text-foreground">${plan.price}</span>
                      <span className="text-xs text-muted-foreground">/{plan.interval}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {plan.maxEmployees === -1 ? "Unlimited employees" : `Up to ${plan.maxEmployees} team members`}
                    </p>

                    <ul className="mt-6 space-y-2.5 border-t pt-5">
                      {plan.features.map((feature, j) => (
                        <li key={j} className="flex items-start gap-2.5 text-xs text-foreground">
                          <Check className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-8 pt-4">
                    <Button
                      asChild
                      className={cn(
                        "w-full h-10 rounded-full text-xs font-semibold transition-all shadow-md",
                        plan.popular
                          ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 hover:shadow-lg"
                          : "border bg-background hover:bg-muted"
                      )}
                      variant={plan.popular ? "default" : "outline"}
                    >
                      <Link href={ctaHref}>
                        {plan.popular ? "Start Free Trial" : "Get Started"}
                      </Link>
                    </Button>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* FREQUENTLY ASKED QUESTIONS ACCORDION */}
      <section id="faq" className="py-24">
        <div className="mx-auto max-w-4xl px-6">
          <ScrollReveal className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl text-foreground">
              Frequently Asked Questions
            </h2>
            <p className="mt-3 text-muted-foreground text-sm">
              Answers to common questions about deployment, security, and statutory compliance.
            </p>
          </ScrollReveal>

          <div className="space-y-3">
            {FAQS.map((faq, i) => {
              const open = activeFaq === i;
              return (
                <div key={i} className="card-glass rounded-xl border overflow-hidden transition-all">
                  <button
                    onClick={() => setActiveFaq(open ? null : i)}
                    className="w-full p-4 text-left flex items-center justify-between text-xs sm:text-sm font-bold text-foreground hover:text-violet-600 transition-colors"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200", open && "rotate-180")} />
                  </button>
                  {open && (
                    <div className="px-4 pb-4 text-xs text-muted-foreground leading-relaxed border-t pt-3 bg-muted/10">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FINAL CALL TO ACTION */}
      <section className="py-20 relative overflow-hidden bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white">
        <div className="mx-auto max-w-5xl px-6 text-center relative z-10">
          <ScrollReveal>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">
              Transform Your Organization Today
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm sm:text-base text-white/80 leading-relaxed">
              Launch your company workspace in under 2 minutes. Free 14-day trial with full access to all 91 modules.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                asChild
                className="h-12 px-8 bg-white text-violet-900 font-bold rounded-full border-0 shadow-xl hover:bg-white/90 transition-all hover:scale-102"
              >
                <Link href={ctaHref}>
                  Start 14-Day Free Trial <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/50 bg-card py-14">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                  <Building2 className="h-4 w-4" />
                </div>
                <span className="font-bold text-foreground">Circuvent HRMS</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                Enterprise workforce management, attendance, statutory payroll, and employee performance system.
              </p>
              <GetTheApp className="mt-4" />
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">Product Suites</h4>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li><a href="#suite-explorer" className="hover:text-foreground transition-colors">Employee Directory</a></li>
                <li><a href="#suite-explorer" className="hover:text-foreground transition-colors">Time &amp; Attendance</a></li>
                <li><a href="#suite-explorer" className="hover:text-foreground transition-colors">Payroll &amp; Tax</a></li>
                <li><a href="#suite-explorer" className="hover:text-foreground transition-colors">Goals &amp; Performance</a></li>
                <li><Link href="/careers" className="hover:text-foreground transition-colors">Careers Portal</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">Company &amp; Legal</h4>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li><a href="https://circuvent.com" className="hover:text-foreground transition-colors">About Circuvent</a></li>
                <li><Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
                <li><Link href="/helpdesk" className="hover:text-foreground transition-colors">Support Desk</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground mb-3">Circuvent Ecosystem</h4>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li><a href="https://cv-365.web.app" className="hover:text-foreground transition-colors">CV-365 Office Suite</a></li>
                <li><a href="https://circuvent-mail.web.app" className="hover:text-foreground transition-colors">Circuvent Mail</a></li>
                <li><a href="https://auth.circuvent.com" className="hover:text-foreground transition-colors">Circuvent Auth SSO</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 border-t border-border/50 pt-6 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Circuvent Technologies. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
