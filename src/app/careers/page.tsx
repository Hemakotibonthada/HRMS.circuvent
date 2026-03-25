"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Building2, MapPin, Clock, Briefcase, Search, ArrowRight, ChevronRight,
} from "lucide-react";

const OPEN_JOBS = [
  { title: "Senior Full Stack Developer", dept: "Engineering", location: "Remote", type: "Full Time", experience: "4-6 years", salary: "₹18-24 LPA", posted: "5 days ago" },
  { title: "HR Business Partner", dept: "Human Resources", location: "Bangalore", type: "Full Time", experience: "5-8 years", salary: "₹15-20 LPA", posted: "1 week ago" },
  { title: "Product Designer", dept: "Design", location: "Hybrid", type: "Full Time", experience: "3-5 years", salary: "₹12-18 LPA", posted: "3 days ago" },
  { title: "DevOps Engineer", dept: "Engineering", location: "Remote", type: "Contract", experience: "3-5 years", salary: "₹16-22 LPA", posted: "2 weeks ago" },
  { title: "Summer Intern - Engineering", dept: "Engineering", location: "Bangalore", type: "Internship", experience: "0-1 years", salary: "₹25K/month", posted: "1 day ago" },
];

export default function CareersPage() {
  return (
    <div className="min-h-screen">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-400/15 blur-3xl animate-blob" />
        <div className="absolute -bottom-32 right-1/4 h-[400px] w-[400px] rounded-full bg-purple-400/10 blur-3xl animate-blob animation-delay-3000" />
      </div>

      {/* Navbar */}
      <nav className="border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
              <Building2 className="h-4 w-4" />
            </div>
            <span className="font-bold">Circuvent HRMS</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="outline" size="sm" asChild>
              <Link href="/login">Employer Login</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl animate-slide-up">
            Join Our{" "}
            <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
              Growing Team
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground animate-slide-up" style={{ animationDelay: "100ms" }}>
            Build the future of HR technology. We&apos;re looking for passionate people to help us transform how companies manage their workforce.
          </p>
          <div className="mx-auto mt-8 max-w-md animate-slide-up" style={{ animationDelay: "200ms" }}>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search open positions..." className="pl-10 h-12 text-base" />
            </div>
          </div>
        </div>
      </section>

      {/* Job Listings */}
      <section className="pb-24">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-lg font-semibold mb-6">{OPEN_JOBS.length} Open Positions</h2>
          <div className="space-y-4 stagger-children">
            {OPEN_JOBS.map((job, i) => (
              <Card key={i} className="group cursor-pointer hover:shadow-md transition-all">
                <CardContent className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                      <Briefcase className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold group-hover:text-primary transition-colors">{job.title}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {job.dept}</span>
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {job.location}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {job.experience}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{job.type}</Badge>
                        <span className="text-xs font-medium text-primary">{job.salary}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-muted-foreground hidden sm:block">{job.posted}</span>
                    <Button size="sm" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1">
                      Apply <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Circuvent Technologies. All rights reserved.</p>
      </footer>
    </div>
  );
}
