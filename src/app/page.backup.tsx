"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import {
  Building2, Users, Clock, DollarSign, CalendarDays, Target, GraduationCap,
  UserPlus, BarChart3, Shield, Zap, Globe, ArrowRight, Check, Star,
  Briefcase, Award, ChevronRight, Menu, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <span ref={ref} className="animate-counter-pulse">
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
      { threshold: 0.15 }
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

const FEATURES = [
  { icon: Users, title: "Employee Management", desc: "Complete directory with profiles, org charts, and document management", color: "from-violet-500 to-purple-600" },
  { icon: Clock, title: "Attendance & Time", desc: "Real-time clock in/out, GPS tracking, overtime calculations", color: "from-blue-500 to-cyan-500" },
  { icon: CalendarDays, title: "Leave Management", desc: "Smart leave requests, approvals, balance tracking, and policies", color: "from-amber-500 to-orange-500" },
  { icon: DollarSign, title: "Payroll Processing", desc: "Automated salary calculations, tax deductions, and payslips", color: "from-emerald-500 to-green-600" },
  { icon: UserPlus, title: "Recruitment & ATS", desc: "Job posting, applicant tracking, interview scheduling", color: "from-pink-500 to-rose-600" },
  { icon: Target, title: "Performance Reviews", desc: "Goal setting, OKRs, 360-degree feedback, and appraisals", color: "from-red-500 to-orange-500" },
  { icon: GraduationCap, title: "Training & LMS", desc: "Course management, certifications, and skill tracking", color: "from-indigo-500 to-blue-600" },
  { icon: Award, title: "Awards & Recognition", desc: "Employee appreciation, badges, and milestone celebrations", color: "from-yellow-500 to-amber-500" },
  { icon: BarChart3, title: "HR Analytics", desc: "Workforce insights, attrition reports, and trend analysis", color: "from-purple-500 to-violet-600" },
];

const MODULE_COUNT = Object.keys(MODULE_PERMISSION_MAP).length;
const PT_STATE_COUNT = Object.keys(PT_SLABS).length;

const STATS = [
  { value: MODULE_COUNT, suffix: "", label: "HR Modules" },
  { value: PT_STATE_COUNT, suffix: "", label: "States: Professional Tax" },
  { value: 100, suffix: "%", label: "Tenant Data Isolation" },
  { value: 2, suffix: "", label: "Tax Regimes: Old & New" },
];

export default function LandingPage() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const ctaHref = user ? "/dashboard" : "/login";

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Animated background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-400/20 blur-3xl animate-blob" />
        <div className="absolute top-1/3 -right-32 h-[400px] w-[400px] rounded-full bg-purple-400/15 blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute -bottom-32 left-1/3 h-[450px] w-[450px] rounded-full bg-indigo-400/15 blur-3xl animate-blob animation-delay-4000" />
        <div className="absolute top-2/3 right-1/4 h-[350px] w-[350px] rounded-full bg-fuchsia-400/10 blur-3xl animate-blob animation-delay-3000" />
      </div>

      {/* Navbar */}
      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-500",
          scrolled
            ? "bg-background/80 backdrop-blur-xl border-b border-border/50 shadow-sm"
            : "bg-transparent"
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md">
              <Building2 className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              Circuvent <span className="text-primary">HRMS</span>
            </span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
            <a href="#pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </a>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <ThemeToggle />
            {user ? (
              <Button asChild className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md hover:shadow-lg transition-shadow">
                <Link href="/dashboard">Open Dashboard <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
                <Button asChild className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md hover:shadow-lg transition-shadow">
                  <Link href="/register">Get Started Free</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile menu */}
          <button className="md:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t bg-background/95 backdrop-blur-xl p-4 md:hidden animate-slide-up">
            <div className="flex flex-col gap-3">
              <a href="#features" className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>Features</a>
              <a href="#pricing" className="px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" asChild className="flex-1">
                  <Link href="/login">Sign In</Link>
                </Button>
                <Button asChild className="flex-1 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">
                  <Link href="/register">Get Started</Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-3xl text-center">
            <ScrollReveal>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-1.5 text-sm font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
                <Zap className="h-3.5 w-3.5" />
                Built for Indian payroll and statutory compliance
              </div>
            </ScrollReveal>

            <ScrollReveal delay={100}>
              <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
                Modern HR Management{" "}
                <span className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent animate-gradient">
                  Made Simple
                </span>
              </h1>
            </ScrollReveal>

            <ScrollReveal delay={200}>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed">
                Streamline your entire HR workflow — from hiring to retiring.
                Manage employees, attendance, payroll, performance, and more in one
                beautiful, lightning-fast platform.
              </p>
            </ScrollReveal>

            <ScrollReveal delay={300}>
              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Button
                  size="lg"
                  asChild
                  className="h-12 px-8 bg-gradient-to-r from-violet-500 to-purple-600 text-white text-base border-0 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Link href={ctaHref}>
                    Start Free Trial <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="h-12 px-8 text-base"
                >
                  <a href="#features">
                    Explore Features <ChevronRight className="ml-1 h-5 w-5" />
                  </a>
                </Button>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={400}>
              <div className="mt-8 flex items-center justify-center gap-6 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-500" /> 14-day free trial</span>
                <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-500" /> No credit card</span>
                <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-500" /> Cancel anytime</span>
              </div>
            </ScrollReveal>
          </div>

          {/* Dashboard Preview */}
          <ScrollReveal delay={500} className="mt-16">
            <div className="relative mx-auto max-w-5xl">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-10 -inset-y-6 -z-10 rounded-[2.5rem] bg-gradient-to-tr from-violet-500/20 via-purple-500/10 to-indigo-500/20 blur-3xl"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/hero-dashboard.svg"
                alt="Illustration of the Circuvent HRMS dashboard, showing headcount, attendance and team panels"
                width={1000}
                height={680}
                className="h-auto w-full animate-float drop-shadow-2xl"
              />
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 border-y border-border/30 bg-muted/20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {STATS.map((stat, i) => (
              <ScrollReveal key={i} delay={i * 100} className="text-center">
                <div className="text-3xl font-extrabold text-foreground sm:text-4xl">
                  <AnimatedCounter target={stat.value} suffix={stat.suffix} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <ScrollReveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to manage your{" "}
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                workforce
              </span>
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              A comprehensive suite of HR tools designed for modern teams. From small startups to large enterprises.
            </p>
          </ScrollReveal>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, i) => (
              <ScrollReveal key={i} delay={i * 80}>
                <div className="group card-glass rounded-2xl p-6 cursor-default">
                  <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${feature.color} text-white shadow-md transition-transform group-hover:scale-110 group-hover:shadow-lg`}>
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-24 bg-muted/20 border-y border-border/30">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <ScrollReveal>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Built for companies of{" "}
                <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                  every size
                </span>
              </h2>
              <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
                Whether you&apos;re a 10-person startup or a 10,000-employee enterprise,
                Circuvent HRMS scales with your needs. Use it for your own company or
                purchase a subscription for any organization.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  { icon: Shield, text: "Enterprise-grade security with role-based access control" },
                  { icon: Globe, text: "Multi-tenant architecture — one platform, many companies" },
                  { icon: Zap, text: "Lightning-fast performance with real-time updates" },
                  { icon: Briefcase, text: "Flexible subscription plans that grow with you" },
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <item.icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm text-foreground/80">{item.text}</span>
                  </li>
                ))}
              </ul>
            </ScrollReveal>

            <ScrollReveal delay={200}>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: Users, label: "Employee Portal", val: "Self-service" },
                  { icon: CalendarDays, label: "Leave Tracking", val: "Automated" },
                  { icon: DollarSign, label: "Payroll", val: "One-click" },
                  { icon: Target, label: "Performance", val: "360° Reviews" },
                ].map((card, i) => (
                  <div
                    key={i}
                    className="card-glass rounded-xl p-5 text-center animate-float"
                    style={{ animationDelay: `${i * 300}ms` }}
                  >
                    <card.icon className="mx-auto h-8 w-8 text-primary mb-3" />
                    <p className="text-sm font-semibold">{card.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{card.val}</p>
                  </div>
                ))}
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <ScrollReveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Simple, transparent{" "}
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                pricing
              </span>
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Start free, upgrade when you&apos;re ready. No hidden fees, no surprises.
            </p>
          </ScrollReveal>

          <div className="mt-16 grid gap-8 lg:grid-cols-3">
            {SUBSCRIPTION_PLANS.map((plan, i) => (
              <ScrollReveal key={plan.id} delay={i * 150}>
                <div
                  className={cn(
                    "relative card-glass rounded-2xl p-8",
                    plan.popular && "ring-2 ring-primary shadow-xl scale-[1.03]"
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-1 text-xs font-semibold text-white shadow-md">
                      Most Popular
                    </div>
                  )}
                  <h3 className="text-lg font-bold">{plan.name}</h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold">${plan.price}</span>
                    <span className="text-sm text-muted-foreground">/{plan.interval}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {plan.maxEmployees === -1 ? "Unlimited employees" : `Up to ${plan.maxEmployees} employees`}
                  </p>
                  <ul className="mt-6 space-y-3">
                    {plan.features.map((feature, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    asChild
                    className={cn(
                      "mt-8 w-full h-11 transition-all",
                      plan.popular
                        ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md hover:shadow-lg"
                        : ""
                    )}
                    variant={plan.popular ? "default" : "outline"}
                  >
                    <Link href={ctaHref}>
                      {plan.popular ? "Start Free Trial" : "Get Started"}
                    </Link>
                  </Button>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <ScrollReveal>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to transform your HR?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
              Create your organisation in a few minutes. No credit card is asked
              for at sign-up.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                size="lg"
                asChild
                className="h-12 px-10 bg-gradient-to-r from-violet-500 to-purple-600 text-white text-base border-0 shadow-lg hover:shadow-xl transition-all hover:scale-[1.02]"
              >
                <Link href={ctaHref}>
                  Get Started Free <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-muted/30 py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                  <Building2 className="h-4 w-4" />
                </div>
                <span className="font-bold">Circuvent HRMS</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Modern HR management for modern teams. Built by Circuvent Technologies.
              </p>
              <GetTheApp className="mt-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
                <li><Link href="/careers" className="hover:text-foreground transition-colors">Careers Portal</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="https://circuvent.com" className="hover:text-foreground transition-colors">About</a></li>
                <li><Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3">Other Products</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="https://cv-365.web.app" className="hover:text-foreground transition-colors">CV-365 Suite</a></li>
                <li><a href="https://circuvent-mail.web.app" className="hover:text-foreground transition-colors">Circuvent Mail</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 border-t border-border/50 pt-6 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Circuvent Technologies. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
