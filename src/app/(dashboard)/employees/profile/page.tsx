"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Mail, Phone, MapPin, Calendar, Building2, User, Shield, Heart,
  GraduationCap, Award, FileText, Clock, IndianRupee, Edit, Download,
  Briefcase, Star, TrendingUp, CheckCircle, AlertCircle, XCircle,
  BookOpen, Activity, CreditCard, Upload,
} from "lucide-react";
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, LineChart, Line, Legend,
} from "recharts";

const profileData = {
  id: "EMP001",
  name: "Aarav Sharma",
  email: "aarav.sharma@circuvent.in",
  phone: "+91 98765 43210",
  designation: "Senior Software Engineer",
  department: "Engineering",
  manager: "Vikram Patel",
  managerId: "EMP005",
  joiningDate: "2021-03-15",
  location: "Bengaluru",
  type: "Full-time",
  status: "active",
  dob: "1994-06-12",
  gender: "Male",
  bloodGroup: "B+",
  maritalStatus: "Married",
  nationality: "Indian",
  panNumber: "ABCDS1234F",
  aadhaar: "XXXX XXXX 4321",
  passport: "K1234567",
  currentAddress: "42, 4th Cross, Indiranagar, Bengaluru, Karnataka - 560038",
  permanentAddress: "15, MG Road, Lucknow, Uttar Pradesh - 226001",
  emergencyContacts: [
    { name: "Ramesh Sharma", relation: "Father", phone: "+91 99887 76655" },
    { name: "Priya Sharma", relation: "Spouse", phone: "+91 99887 76656" },
  ],
  salary: {
    annual: 1850000,
    basic: 740000,
    hra: 370000,
    specialAllowance: 277500,
    pf: 222000,
    gratuity: 88800,
    insurance: 50000,
    otherBenefits: 101700,
  },
  revisionHistory: [
    { date: "2025-04-01", from: 1550000, to: 1850000, hike: "19.4%", reason: "Annual Appraisal" },
    { date: "2024-04-01", from: 1320000, to: 1550000, hike: "17.4%", reason: "Promotion" },
    { date: "2023-04-01", from: 1150000, to: 1320000, hike: "14.8%", reason: "Annual Appraisal" },
    { date: "2021-03-15", from: 0, to: 1150000, hike: "—", reason: "Joining CTC" },
  ],
  bonuses: [
    { year: "2025", type: "Performance Bonus", amount: 185000 },
    { year: "2024", type: "Performance Bonus", amount: 155000 },
    { year: "2024", type: "Spot Award", amount: 25000 },
    { year: "2023", type: "Performance Bonus", amount: 120000 },
  ],
  skills: [
    { name: "React", level: 92 }, { name: "TypeScript", level: 88 }, { name: "Node.js", level: 80 },
    { name: "Next.js", level: 85 }, { name: "Python", level: 65 }, { name: "System Design", level: 78 },
    { name: "AWS", level: 70 }, { name: "GraphQL", level: 72 },
  ],
  certifications: [
    { name: "AWS Solutions Architect Associate", issuer: "Amazon Web Services", date: "2024-08", status: "active" },
    { name: "Google Cloud Professional Developer", issuer: "Google", date: "2023-11", status: "active" },
    { name: "MongoDB Developer Certification", issuer: "MongoDB Inc.", date: "2023-05", status: "expired" },
  ],
  education: [
    { degree: "B.Tech in Computer Science", institution: "IIT Kanpur", year: "2016", grade: "8.6 CGPA" },
    { degree: "XII (CBSE)", institution: "Delhi Public School, Lucknow", year: "2012", grade: "94.2%" },
  ],
  employmentHistory: [
    { company: "Circuvent Technologies", role: "Senior Software Engineer", from: "Mar 2021", to: "Present", duration: "5 yrs" },
    { company: "Infosys Ltd.", role: "Software Engineer", from: "Jul 2018", to: "Feb 2021", duration: "2 yrs 8 mo" },
    { company: "TCS", role: "Associate Developer", from: "Jul 2016", to: "Jun 2018", duration: "2 yrs" },
  ],
  documents: [
    { name: "Aadhaar Card", type: "Identity", uploaded: "2021-03-15", verified: true },
    { name: "PAN Card", type: "Identity", uploaded: "2021-03-15", verified: true },
    { name: "Passport", type: "Identity", uploaded: "2021-03-20", verified: true },
    { name: "Offer Letter", type: "Employment", uploaded: "2021-03-10", verified: true },
    { name: "Experience Letter - Infosys", type: "Employment", uploaded: "2021-03-15", verified: true },
    { name: "Experience Letter - TCS", type: "Employment", uploaded: "2021-03-15", verified: true },
    { name: "B.Tech Degree Certificate", type: "Education", uploaded: "2021-03-15", verified: true },
    { name: "XII Marksheet", type: "Education", uploaded: "2021-03-15", verified: true },
    { name: "Bank Passbook Copy", type: "Financial", uploaded: "2021-03-18", verified: true },
    { name: "Form 16 - FY2024-25", type: "Tax", uploaded: "2025-07-10", verified: false },
  ],
  recentActivity: [
    { date: "2026-03-20", type: "Performance Review", description: "Q1 2026 review completed — Rating: Exceeds Expectations", icon: "star" },
    { date: "2026-03-15", type: "Leave", description: "Casual Leave — 1 day (Personal reasons)", icon: "calendar" },
    { date: "2026-03-10", type: "Training", description: "Completed: Advanced React Patterns Workshop", icon: "book" },
    { date: "2026-02-28", type: "Expense", description: "Expense claim ₹4,500 — Team lunch (Approved)", icon: "credit" },
    { date: "2026-02-20", type: "Leave", description: "Sick Leave — 2 days (Approved)", icon: "calendar" },
    { date: "2026-02-10", type: "Training", description: "Enrolled: AWS Solutions Architect Professional", icon: "book" },
    { date: "2026-01-25", type: "Performance Review", description: "Annual Review 2025 — Rating: Outstanding (5/5)", icon: "star" },
    { date: "2026-01-15", type: "Expense", description: "Expense claim ₹12,300 — Conference travel (Approved)", icon: "credit" },
  ],
  leaveBalance: { casual: { total: 12, used: 5 }, sick: { total: 8, used: 3 }, earned: { total: 15, used: 2 }, wfh: { total: 24, used: 10 } },
  performanceRatings: [
    { year: "2025", rating: 5, label: "Outstanding" },
    { year: "2024", rating: 4, label: "Exceeds Expectations" },
    { year: "2023", rating: 4, label: "Exceeds Expectations" },
    { year: "2022", rating: 3, label: "Meets Expectations" },
  ],
};

const radarData = profileData.skills.map((s) => ({ subject: s.name, value: s.level, fullMark: 100 }));

const salaryTrend = profileData.revisionHistory.filter((r) => r.from > 0).map((r) => ({
  year: r.date.slice(0, 4),
  ctc: r.to / 100000,
})).reverse();

const taxComputation = {
  grossSalary: 1850000,
  standardDeduction: 75000,
  section80C: 150000,
  section80D: 25000,
  hra: 180000,
  nps: 50000,
  taxableIncome: 1370000,
  taxPayable: 198900,
  cess: 7956,
  totalTax: 206856,
};

export default function EmployeeProfilePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [editTab, setEditTab] = useState("personal");
  const p = profileData;

  const tenure = Math.floor((Date.now() - new Date(p.joiningDate).getTime()) / (365.25 * 24 * 3600000));
  const formatSalary = (n: number) => `₹${(n / 100000).toFixed(1)}L`;
  const formatMonthly = (n: number) => `₹${(n / 12000).toFixed(0)}K`;

  const activityIcon = (type: string) => {
    if (type === "star") return <Star className="h-4 w-4 text-yellow-500" />;
    if (type === "calendar") return <Calendar className="h-4 w-4 text-blue-500" />;
    if (type === "book") return <BookOpen className="h-4 w-4 text-green-500" />;
    return <CreditCard className="h-4 w-4 text-purple-500" />;
  };

  return (
    <div className="space-y-6 p-6 animate-slide-up">
      {/* Profile Header */}
      <Card className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <Avatar className="h-24 w-24 border-4 border-white/30">
              <AvatarFallback className="text-2xl bg-white/20 text-white">AS</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">{p.name}</h1>
                <Badge className="bg-white/20 text-white border-0">{p.status}</Badge>
              </div>
              <p className="text-white/80 mt-1">{p.designation} · {p.department}</p>
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-white/70">
                <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{p.email}</span>
                <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{p.phone}</span>
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.location}</span>
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Joined {p.joiningDate} ({tenure} yrs)</span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3 text-sm text-white/70">
                <span className="flex items-center gap-1"><User className="h-3 w-3" />Reports to: {p.manager}</span>
                <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />ID: {p.id}</span>
              </div>
            </div>
            <Button variant="secondary" onClick={() => setEditOpen(true)}><Edit className="h-4 w-4 mr-2" />Edit Profile</Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 stagger-children">
        {[
          { label: "Annual CTC", value: formatSalary(p.salary.annual), icon: IndianRupee },
          { label: "Leave Balance", value: `${p.leaveBalance.casual.total - p.leaveBalance.casual.used + p.leaveBalance.sick.total - p.leaveBalance.sick.used + p.leaveBalance.earned.total - p.leaveBalance.earned.used}d`, icon: Calendar },
          { label: "Certifications", value: p.certifications.filter((c) => c.status === "active").length.toString(), icon: Award },
          { label: "Last Rating", value: `${p.performanceRatings[0].rating}/5`, icon: Star },
          { label: "Tenure", value: `${tenure} yrs`, icon: Clock },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-4 flex items-center gap-3">
              <stat.icon className="h-8 w-8 text-indigo-500" />
              <div><p className="text-xs text-muted-foreground">{stat.label}</p><p className="text-xl font-bold">{stat.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="personal">Personal</TabsTrigger><TabsTrigger value="professional">Professional</TabsTrigger><TabsTrigger value="compensation">Compensation</TabsTrigger><TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Skills Radar</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <RadarChart data={radarData}><PolarGrid /><PolarAngleAxis dataKey="subject" fontSize={11} /><PolarRadiusAxis angle={30} domain={[0, 100]} fontSize={10} /><Radar name="Proficiency" dataKey="value" stroke="#6366f1" fill="#6366f180" /></RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">CTC Growth</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={salaryTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" fontSize={12} /><YAxis fontSize={12} /><RTooltip /><Bar dataKey="ctc" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="CTC (Lakhs)" /></BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Leave Balance</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(p.leaveBalance).map(([type, bal]) => (
                  <div key={type} className="space-y-1">
                    <div className="flex justify-between text-sm"><span className="capitalize">{type}</span><span>{bal.total - bal.used} / {bal.total}</span></div>
                    <Progress value={((bal.total - bal.used) / bal.total) * 100} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Performance History</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                {p.performanceRatings.map((r) => (
                  <div key={r.year} className="text-center p-3 bg-muted/50 rounded-md">
                    <p className="text-sm text-muted-foreground">{r.year}</p>
                    <p className="text-2xl font-bold text-indigo-600">{r.rating}/5</p>
                    <p className="text-xs text-muted-foreground">{r.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Personal Tab */}
        <TabsContent value="personal" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Personal Information</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                {[
                  { label: "Date of Birth", value: p.dob },
                  { label: "Gender", value: p.gender },
                  { label: "Blood Group", value: p.bloodGroup },
                  { label: "Marital Status", value: p.maritalStatus },
                  { label: "Nationality", value: p.nationality },
                  { label: "PAN Number", value: p.panNumber },
                  { label: "Aadhaar", value: p.aadhaar },
                  { label: "Passport", value: p.passport },
                  { label: "Employment Type", value: p.type },
                ].map((field) => (
                  <div key={field.label}><Label className="text-muted-foreground">{field.label}</Label><p className="font-medium mt-1">{field.value}</p></div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Addresses</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label className="text-muted-foreground">Current Address</Label><p className="font-medium mt-1">{p.currentAddress}</p></div>
              <Separator />
              <div><Label className="text-muted-foreground">Permanent Address</Label><p className="font-medium mt-1">{p.permanentAddress}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Emergency Contacts</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {p.emergencyContacts.map((ec, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
                    <div><p className="font-medium">{ec.name}</p><p className="text-sm text-muted-foreground">{ec.relation}</p></div>
                    <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" /><span>{ec.phone}</span></div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Professional Tab */}
        <TabsContent value="professional" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Employment History</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {p.employmentHistory.map((eh, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex flex-col items-center"><div className={cn("h-3 w-3 rounded-full mt-1.5", i === 0 ? "bg-indigo-500" : "bg-gray-300")} />{i < p.employmentHistory.length - 1 && <div className="w-px flex-1 bg-border" />}</div>
                    <div className="pb-4 flex-1">
                      <div className="flex items-start justify-between"><div><p className="font-semibold">{eh.role}</p><p className="text-sm text-muted-foreground">{eh.company}</p></div><Badge variant={i === 0 ? "default" : "secondary"}>{eh.duration}</Badge></div>
                      <p className="text-xs text-muted-foreground mt-1">{eh.from} — {eh.to}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Skills Matrix</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {p.skills.map((skill) => (
                  <div key={skill.name} className="space-y-1">
                    <div className="flex justify-between text-sm"><span>{skill.name}</span><span className="text-muted-foreground">{skill.level}%</span></div>
                    <Progress value={skill.level} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm text-muted-foreground">Certifications</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {p.certifications.map((cert, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
                    <div><p className="font-medium text-sm">{cert.name}</p><p className="text-xs text-muted-foreground">{cert.issuer} · {cert.date}</p></div>
                    <Badge variant={cert.status === "active" ? "default" : "destructive"}>{cert.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm text-muted-foreground">Education</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {p.education.map((edu, i) => (
                  <div key={i} className="p-3 bg-muted/50 rounded-md">
                    <p className="font-medium text-sm">{edu.degree}</p>
                    <p className="text-xs text-muted-foreground">{edu.institution} · {edu.year}</p>
                    <Badge variant="outline" className="mt-1">{edu.grade}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Compensation Tab */}
        <TabsContent value="compensation" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm text-muted-foreground">Current CTC Breakdown</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm font-semibold"><span>Annual CTC</span><span className="text-xl">{formatSalary(p.salary.annual)}</span></div>
                <Separator />
                {[
                  { label: "Basic Salary", value: p.salary.basic },
                  { label: "HRA", value: p.salary.hra },
                  { label: "Special Allowance", value: p.salary.specialAllowance },
                  { label: "PF (Employer)", value: p.salary.pf },
                  { label: "Gratuity", value: p.salary.gratuity },
                  { label: "Insurance", value: p.salary.insurance },
                  { label: "Other Benefits", value: p.salary.otherBenefits },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span>{formatSalary(item.value)} <span className="text-xs text-muted-foreground">({formatMonthly(item.value)}/mo)</span></span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between text-sm font-medium"><span>Monthly In-hand (est.)</span><span>{formatMonthly(p.salary.annual * 0.72)}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm text-muted-foreground">Tax Computation (FY 2025-26)</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: "Gross Salary", value: taxComputation.grossSalary, bold: true },
                  { label: "Less: Standard Deduction", value: -taxComputation.standardDeduction },
                  { label: "Less: Section 80C", value: -taxComputation.section80C },
                  { label: "Less: Section 80D", value: -taxComputation.section80D },
                  { label: "Less: HRA Exemption", value: -taxComputation.hra },
                  { label: "Less: NPS (80CCD)", value: -taxComputation.nps },
                ].map((item) => (
                  <div key={item.label} className={cn("flex justify-between text-sm", item.bold && "font-semibold")}>
                    <span className="text-muted-foreground">{item.label}</span>
                    <span>{item.value < 0 ? "-" : ""}₹{Math.abs(item.value).toLocaleString("en-IN")}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between text-sm font-medium"><span>Taxable Income</span><span>₹{taxComputation.taxableIncome.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax Payable</span><span>₹{taxComputation.taxPayable.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Health & Education Cess (4%)</span><span>₹{taxComputation.cess.toLocaleString("en-IN")}</span></div>
                <Separator />
                <div className="flex justify-between font-bold"><span>Total Tax</span><span className="text-rose-600">₹{taxComputation.totalTax.toLocaleString("en-IN")}</span></div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Salary Revision History</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50"><tr><th className="p-3 text-left">Effective Date</th><th className="p-3 text-left">Previous CTC</th><th className="p-3 text-left">Revised CTC</th><th className="p-3 text-left">Hike %</th><th className="p-3 text-left">Reason</th></tr></thead>
                  <tbody>{p.revisionHistory.map((rev, i) => (
                    <tr key={i} className="border-t"><td className="p-3">{rev.date}</td><td className="p-3">{rev.from > 0 ? formatSalary(rev.from) : "—"}</td><td className="p-3 font-medium">{formatSalary(rev.to)}</td><td className="p-3"><Badge variant={rev.hike === "—" ? "secondary" : "default"}>{rev.hike}</Badge></td><td className="p-3">{rev.reason}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Bonus History</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">{p.bonuses.map((b, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
                  <div><p className="font-medium text-sm">{b.type}</p><p className="text-xs text-muted-foreground">{b.year}</p></div>
                  <span className="font-semibold text-green-600">₹{b.amount.toLocaleString("en-IN")}</span>
                </div>
              ))}</div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{p.documents.length} documents uploaded</p>
            <Button variant="outline"><Upload className="h-4 w-4 mr-2" />Upload Document</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="p-3 text-left">Document</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Uploaded</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Actions</th></tr></thead>
                <tbody>{p.documents.map((doc, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-3 flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{doc.name}</td>
                    <td className="p-3"><Badge variant="outline">{doc.type}</Badge></td>
                    <td className="p-3">{doc.uploaded}</td>
                    <td className="p-3">{doc.verified ? <Badge className="status-active">Verified</Badge> : <Badge className="status-pending">Pending</Badge>}</td>
                    <td className="p-3"><Button size="sm" variant="ghost"><Download className="h-3 w-3" /></Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm text-muted-foreground">Recent Activity</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {p.recentActivity.map((act, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">{activityIcon(act.icon)}</div>
                      {i < p.recentActivity.length - 1 && <div className="w-px flex-1 bg-border" />}
                    </div>
                    <div className="pb-4 flex-1">
                      <div className="flex items-start justify-between">
                        <div><Badge variant="outline" className="mb-1">{act.type}</Badge><p className="text-sm">{act.description}</p></div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{act.date}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Profile</DialogTitle></DialogHeader>
          <Tabs value={editTab} onValueChange={setEditTab}>
            <TabsList className="w-full"><TabsTrigger value="personal">Personal</TabsTrigger><TabsTrigger value="contact">Contact</TabsTrigger><TabsTrigger value="emergency">Emergency</TabsTrigger></TabsList>
            <TabsContent value="personal" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Full Name</Label><Input defaultValue={p.name} /></div>
                <div className="space-y-2"><Label>Date of Birth</Label><Input type="date" defaultValue={p.dob} /></div>
                <div className="space-y-2"><Label>Gender</Label><Select defaultValue={p.gender.toLowerCase()}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="male">Male</SelectItem><SelectItem value="female">Female</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Blood Group</Label><Select defaultValue={p.bloodGroup}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bg) => <SelectItem key={bg} value={bg}>{bg}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Marital Status</Label><Select defaultValue={p.maritalStatus.toLowerCase()}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single</SelectItem><SelectItem value="married">Married</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Nationality</Label><Input defaultValue={p.nationality} /></div>
              </div>
            </TabsContent>
            <TabsContent value="contact" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Email</Label><Input defaultValue={p.email} /></div>
                <div className="space-y-2"><Label>Phone</Label><Input defaultValue={p.phone} /></div>
              </div>
              <div className="space-y-2"><Label>Current Address</Label><Textarea defaultValue={p.currentAddress} /></div>
              <div className="space-y-2"><Label>Permanent Address</Label><Textarea defaultValue={p.permanentAddress} /></div>
            </TabsContent>
            <TabsContent value="emergency" className="space-y-4 mt-4">
              {p.emergencyContacts.map((ec, i) => (
                <div key={i} className="grid grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Name</Label><Input defaultValue={ec.name} /></div>
                  <div className="space-y-2"><Label>Relation</Label><Input defaultValue={ec.relation} /></div>
                  <div className="space-y-2"><Label>Phone</Label><Input defaultValue={ec.phone} /></div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-indigo-600 to-purple-600" onClick={() => { toast.success("Profile updated successfully"); setEditOpen(false); }}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
