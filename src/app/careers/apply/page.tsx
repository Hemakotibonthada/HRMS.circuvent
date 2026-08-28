"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { Building2, ArrowLeft, Upload, CheckCircle2, Briefcase } from "lucide-react";
import { toast } from "sonner";

export default function ApplyPage() {
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"><div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-400/15 blur-3xl animate-blob" /></div>
        <div className="text-center animate-scale-in">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mb-4"><CheckCircle2 className="h-8 w-8 text-emerald-600" /></div>
          <h1 className="text-2xl font-bold">Application Submitted!</h1>
          <p className="text-muted-foreground mt-2 max-w-md">Thank you for your interest. Our hiring team will review your application and get back to you within 5-7 business days.</p>
          <Button asChild className="mt-6"><Link href="/careers">Back to Careers</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"><div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-violet-400/15 blur-3xl animate-blob" /><div className="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-purple-400/10 blur-3xl animate-blob animation-delay-2000" /></div>

      <nav className="border-b bg-background/80 backdrop-blur-xl"><div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <Link href="/careers" className="flex items-center gap-2"><ArrowLeft className="h-4 w-4" /><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white"><Building2 className="h-4 w-4" /></div><span className="font-bold text-sm">Careers</span></Link>
        <ThemeToggle />
      </div></nav>

      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="animate-slide-up">
          <div className="flex items-center gap-3 mb-6"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Briefcase className="h-5 w-5" /></div><div><h1 className="text-xl font-bold">Apply for Position</h1><p className="text-sm text-muted-foreground">Fill out the form below to submit your application</p></div></div>
        </div>

        <Card className="animate-slide-up border-0 shadow-xl" style={{ animationDelay: "100ms" }}>
          <CardContent className="p-6">
            <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>First Name *</Label><Input placeholder="John" required /></div>
                <div className="space-y-2"><Label>Last Name *</Label><Input placeholder="Doe" required /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Email *</Label><Input type="email" placeholder="john@email.com" required /></div>
                <div className="space-y-2"><Label>Phone *</Label><Input placeholder="+91 98765 43210" required /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Position *</Label>
                  <Select required><SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger><SelectContent>
                    <SelectItem value="senior-fullstack">Senior Full Stack Developer</SelectItem>
                    <SelectItem value="hr-partner">HR Business Partner</SelectItem>
                    <SelectItem value="product-designer">Product Designer</SelectItem>
                    <SelectItem value="devops">DevOps Engineer</SelectItem>
                    <SelectItem value="intern">Summer Intern - Engineering</SelectItem>
                  </SelectContent></Select>
                </div>
                <div className="space-y-2"><Label>Experience *</Label>
                  <Select required><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>
                    <SelectItem value="0-1">0-1 years</SelectItem><SelectItem value="1-3">1-3 years</SelectItem>
                    <SelectItem value="3-5">3-5 years</SelectItem><SelectItem value="5-8">5-8 years</SelectItem>
                    <SelectItem value="8+">8+ years</SelectItem>
                  </SelectContent></Select>
                </div>
              </div>
              <div className="space-y-2"><Label>Current Company</Label><Input placeholder="e.g. Google, TCS" /></div>
              <div className="space-y-2"><Label>LinkedIn Profile</Label><Input placeholder="https://linkedin.com/in/..." /></div>
              <div className="space-y-2"><Label>Portfolio / GitHub</Label><Input placeholder="https://github.com/..." /></div>
              <div className="space-y-2"><Label>Resume *</Label>
                <div className="border-2 border-dashed rounded-xl p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"><Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" /><p className="text-sm font-medium">Drop your resume here or click to upload</p><p className="text-xs text-muted-foreground mt-1">PDF, DOC, DOCX — Max 10 MB</p></div>
              </div>
              <div className="space-y-2"><Label>Cover Letter (Optional)</Label><Textarea placeholder="Tell us why you're interested in this role..." rows={4} /></div>
              <div className="space-y-2"><Label>Expected CTC (₹ LPA)</Label><Input placeholder="e.g. 20" /></div>
              <div className="space-y-2"><Label>Notice Period</Label>
                <Select><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>
                  <SelectItem value="immediate">Immediate</SelectItem><SelectItem value="15">15 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem><SelectItem value="60">60 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent></Select>
              </div>
              <Button type="submit" className="w-full h-11 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md hover:shadow-lg transition-all text-base">Submit Application</Button>
              <p className="text-xs text-center text-muted-foreground">By submitting, you agree to our <Link href="/privacy" className="underline">Privacy Policy</Link></p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
