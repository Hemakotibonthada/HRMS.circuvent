"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot, Send, User, Sparkles, Clock, Lightbulb, RotateCcw,
  ThumbsUp, ThumbsDown, Copy, Search, BookOpen, CalendarDays,
  DollarSign, Users, FileText, HelpCircle, ArrowRight, Zap,
  MessageSquare, Star, ChevronRight, Briefcase, Target,
  GraduationCap, Heart, Shield, Building2, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════
// HR AI ASSISTANT / CHATBOT
// Conversational AI for HR queries, policy lookups, leave balance,
// payslip info, FAQ answers, onboarding help, and quick actions
// ═══════════════════════════════════════════════════════════════

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  feedback?: "up" | "down";
  actions?: { label: string; href: string; icon: typeof ArrowRight }[];
  sources?: string[];
  typing?: boolean;
}

interface QuickAction {
  id: string;
  label: string;
  prompt: string;
  icon: typeof CalendarDays;
  color: string;
  category: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "q1", label: "Check leave balance", prompt: "What is my current leave balance?", icon: CalendarDays, color: "from-violet-500 to-purple-600", category: "Leave" },
  { id: "q2", label: "View my payslip", prompt: "Show me my latest payslip summary", icon: DollarSign, color: "from-emerald-500 to-green-600", category: "Payroll" },
  { id: "q3", label: "Apply for leave", prompt: "How do I apply for casual leave?", icon: CalendarDays, color: "from-blue-500 to-cyan-500", category: "Leave" },
  { id: "q4", label: "Company holidays", prompt: "What are the upcoming company holidays?", icon: CalendarDays, color: "from-amber-500 to-orange-500", category: "Calendar" },
  { id: "q5", label: "Expense policy", prompt: "What is the expense reimbursement policy?", icon: FileText, color: "from-pink-500 to-rose-600", category: "Policy" },
  { id: "q6", label: "WFH policy", prompt: "What is the work from home policy?", icon: Building2, color: "from-teal-500 to-cyan-600", category: "Policy" },
  { id: "q7", label: "IT helpdesk", prompt: "My VPN is not working. How do I raise a ticket?", icon: HelpCircle, color: "from-red-500 to-orange-500", category: "IT" },
  { id: "q8", label: "Performance review", prompt: "When is the next performance review cycle?", icon: Target, color: "from-indigo-500 to-blue-600", category: "Performance" },
  { id: "q9", label: "Training courses", prompt: "What training courses are available for me?", icon: GraduationCap, color: "from-purple-500 to-violet-600", category: "Learning" },
  { id: "q10", label: "Onboarding help", prompt: "I am a new joiner. What do I need to do first?", icon: Users, color: "from-cyan-500 to-blue-500", category: "Onboarding" },
  { id: "q11", label: "Salary structure", prompt: "Explain my salary structure and components", icon: DollarSign, color: "from-green-500 to-emerald-600", category: "Payroll" },
  { id: "q12", label: "Referral bonus", prompt: "What is the employee referral bonus amount?", icon: Heart, color: "from-fuchsia-500 to-pink-500", category: "Benefits" },
];

const AI_RESPONSES: Record<string, { content: string; actions?: Message["actions"]; sources?: string[] }> = {
  "leave balance": {
    content: "Here's your current leave balance for FY 2025-26:\n\n🟢 **Casual Leave**: 6 remaining (12 total, 4 used, 2 pending)\n🔴 **Sick Leave**: 10 remaining (12 total, 2 used)\n🟢 **Earned Leave**: 5 remaining (15 total, 3 used, 7 pending)\n🟡 **Comp Off**: 2 remaining (3 total, 1 used)\n🔵 **WFH**: 13 remaining (24 total, 8 used, 3 pending)\n\nYou have a total of **36 leave days** remaining this year.",
    actions: [
      { label: "Apply Leave", href: "/leave", icon: ArrowRight },
      { label: "View Calendar", href: "/holidays", icon: ArrowRight },
    ],
    sources: ["Leave Management System", "HR Policy v3.2"],
  },
  "payslip": {
    content: "To view your payslip, please visit the **Payslip** page where you can see your complete earnings and deductions breakdown.\n\nYour payslip includes:\n• **Earnings:** Basic Pay, HRA, Special Allowance, Other Allowances\n• **Deductions:** PF, Professional Tax, Income Tax (TDS)\n• **Net Pay** after all deductions\n\nYou can also download your payslip as PDF from there.",
    actions: [
      { label: "View Full Payslip", href: "/payslip", icon: ArrowRight },
      { label: "Tax Details", href: "/tax", icon: ArrowRight },
    ],
    sources: ["Payroll System", "Tax Module"],
  },
  "casual leave": {
    content: "To apply for **Casual Leave**, follow these steps:\n\n1. Go to **Leave Management** → Click **Apply Leave**\n2. Select **Casual Leave** as the leave type\n3. Choose your **From** and **To** dates\n4. Enter the **reason** for leave\n5. Click **Apply**\n\n📌 **Key rules:**\n• Max 3 consecutive CL days without manager pre-approval\n• Apply at least 1 day in advance (except emergencies)\n• CL cannot be carried forward to next year\n• You have **6 CL remaining** for this year\n\nWould you like me to start a leave application for you?",
    actions: [
      { label: "Apply Leave Now", href: "/leave", icon: ArrowRight },
    ],
    sources: ["Leave Policy v2.1", "Employee Handbook"],
  },
  "holidays": {
    content: "Here are the **upcoming company holidays** in 2026:\n\n📅 **April 2026:**\n• Apr 14 — Ambedkar Jayanti (Tuesday)\n• Apr 18 — Good Friday (Friday) 🎉\n\n📅 **May 2026:**\n• May 1 — May Day / Labour Day (Thursday)\n\n📅 **June-August:**\n• Aug 15 — Independence Day (Friday) 🇮🇳\n• Aug 27 — Ganesh Chaturthi (Wednesday)\n\n📅 **Oct-Dec:**\n• Oct 2 — Gandhi Jayanti / Dussehra (Thursday)\n• Oct 20 — Diwali (Monday) 🪔\n• Dec 25 — Christmas (Thursday) 🎄\n\nTotal remaining holidays this year: **8 days**",
    actions: [
      { label: "View Full Calendar", href: "/holidays", icon: ArrowRight },
    ],
    sources: ["Holiday Calendar 2026"],
  },
  "expense": {
    content: "Here's the **Expense Reimbursement Policy** summary:\n\n💳 **Approval Limits:**\n• Up to ₹5,000 — Auto-approved\n• ₹5,001 - ₹25,000 — Manager approval\n• ₹25,001 - ₹1,00,000 — Department Head\n• Above ₹1,00,000 — CEO approval\n\n📋 **Categories:** Travel, Equipment, Training, Software, Books, Events, Client Meetings, Marketing\n\n📎 **Receipt Required:** Mandatory for all claims above ₹500\n\n⏱️ **Submission Deadline:** Within 30 days of expense\n\n💰 **Reimbursement Cycle:** Processed with next payroll\n\n**Your pending claims:** ₹3,200 (1 claim awaiting approval)",
    actions: [
      { label: "Submit Expense", href: "/expenses", icon: ArrowRight },
      { label: "View Claims", href: "/expenses", icon: ArrowRight },
    ],
    sources: ["Expense Policy v1.5", "Finance Guidelines"],
  },
  "wfh": {
    content: "Here's the **Work From Home Policy:**\n\n🏠 **Eligibility:** All confirmed employees (post-probation)\n\n📅 **WFH Allowance:** Up to 2 days/week (48 days/year)\n\n📋 **How to Apply:**\n1. Go to **WFH** page → Click **Request WFH**\n2. Select dates and provide reason\n3. Submit for manager approval\n\n⚡ **Rules:**\n• Apply at least 1 day in advance\n• Must be reachable during work hours (9 AM - 6 PM)\n• Internet connectivity required\n• Attend all scheduled meetings\n• Manager can recall to office if needed\n\n📊 **Your WFH this month:** 3 days used, 5 remaining",
    actions: [
      { label: "Request WFH", href: "/wfh", icon: ArrowRight },
    ],
    sources: ["WFH Policy v2.0", "HR Guidelines"],
  },
  "vpn": {
    content: "I can help you raise an **IT Helpdesk ticket** for VPN issues! Here are some quick troubleshooting steps first:\n\n🔧 **Try these first:**\n1. Restart your VPN client\n2. Check your internet connection\n3. Try connecting to a different VPN server\n4. Clear VPN cache/reinstall the client\n5. Check if your corporate password has expired\n\n⚠️ **Still not working?** Let me raise a ticket:\n• **Category:** IT Support\n• **Priority:** High (VPN is critical for remote work)\n• **SLA:** 4 hours resolution\n\nWould you like me to create this ticket?",
    actions: [
      { label: "Create IT Ticket", href: "/helpdesk", icon: ArrowRight },
      { label: "Contact IT Team", href: "/helpdesk", icon: ArrowRight },
    ],
    sources: ["IT Support Knowledge Base"],
  },
  "performance": {
    content: "Here's your **Performance Review** information:\n\n📊 **Current Cycle:** Q1 FY26 (Apr 1 - Apr 30, 2026)\n• Status: **Active** — Self-assessment opens Apr 1\n• Manager review deadline: Apr 20\n• Calibration: Apr 25-30\n\n🎯 **Your Q4 Results:**\n• Self Rating: 4.2/5\n• Manager Rating: 4.0/5\n• Final Rating: **4.1/5 (Exceeds Expectations)**\n\n📈 **Goals Status:**\n• 4 goals set for Q1\n• 2 on track, 1 at risk, 1 completed\n• Overall weighted progress: 68%\n\n🏆 **Next Review:** Annual Review in July 2026",
    actions: [
      { label: "View My Reviews", href: "/performance", icon: ArrowRight },
      { label: "Update Goals", href: "/goals", icon: ArrowRight },
    ],
    sources: ["Performance Management System"],
  },
  "training": {
    content: "Here are **training courses** available for you:\n\n🚀 **Recommended Based on Your Role:**\n1. **React & Next.js Mastery** — 24 hrs, Self-paced ⭐4.7\n2. **AWS Solutions Architect** — 40 hrs, Certification 🏆\n3. **DevOps & CI/CD Pipeline** — 18 hrs, Self-paced ⭐4.5\n\n📋 **Mandatory (Due Soon):**\n• ⚠️ POSH Compliance Training — Due Apr 15\n• ✅ Data Privacy & GDPR — Completed\n\n📚 **Learning Paths:**\n• Full Stack Developer (4 courses, 74 hrs)\n• Engineering Manager (3 courses, 36 hrs)\n\n💡 **Learning Budget:** ₹50,000/year (₹35,000 remaining)",
    actions: [
      { label: "Browse Courses", href: "/training", icon: ArrowRight },
      { label: "My Enrollments", href: "/training", icon: ArrowRight },
    ],
    sources: ["LMS", "Learning & Development"],
  },
  "new joiner": {
    content: "Welcome to the team! 🎉 Here is your onboarding checklist:\n\n📋 **This Week:**\n• Complete HR document submission\n• Set up development environment\n• POSH training enrollment\n• Security awareness training\n• Read company handbook\n\n📋 **First Month:**\n• Submit first deliverable\n• 2-week manager check-in\n• 30-day HR check-in\n\nCheck the **Onboarding Dashboard** for your buddy assignment, manager details, and full task list.",
    actions: [
      { label: "Onboarding Dashboard", href: "/onboarding", icon: ArrowRight },
      { label: "Employee Handbook", href: "/documents", icon: ArrowRight },
    ],
    sources: ["Onboarding Guide", "Employee Handbook"],
  },
  "salary structure": {
    content: "Your salary structure typically follows this breakdown:\n\n📊 **Standard CTC Components:**\n• **Basic Pay:** ~40% of CTC\n• **HRA:** ~20% of CTC\n• **Special Allowance:** ~15-18% of CTC\n• **Other Allowances:** ~2-5% of CTC\n\n📊 **Employer Contributions:**\n• PF (Employer): 12% of Basic (capped at ₹1,800/month)\n• Gratuity: ~4.81% of Basic\n• Insurance: As per company policy\n\nFor your exact breakdown, please visit the **Payslip** page or use the **Salary Calculator**.",
    actions: [
      { label: "View Payslip", href: "/payslip", icon: ArrowRight },
      { label: "Tax Calculator", href: "/calculator", icon: ArrowRight },
    ],
    sources: ["Compensation Structure", "Payroll System"],
  },
  "referral": {
    content: "Here's the **Employee Referral Program** details:\n\n💰 **Referral Bonus:**\n• Engineering roles: **₹50,000**\n• Design roles: **₹40,000**\n• Non-tech roles: **₹25,000**\n• Leadership roles: **₹75,000**\n\n📋 **How it works:**\n1. Check open positions on **Careers** page\n2. Submit referral via **Referrals** module\n3. Your referral goes through normal hiring pipeline\n4. Bonus paid after referral completes 90 days\n\n📊 **Your Referrals:**\n• Total referred: 3\n• Hired: 1 (Kavya Menon ✅)\n• In pipeline: 1\n• Rejected: 1\n\n💵 **Pending bonus:** ₹50,000 (pays Apr 2026)",
    actions: [
      { label: "Refer Someone", href: "/referrals", icon: ArrowRight },
      { label: "Open Positions", href: "/recruitment", icon: ArrowRight },
    ],
    sources: ["Referral Policy v3.0"],
  },
};

function getAIResponse(query: string): { content: string; actions?: Message["actions"]; sources?: string[] } {
  const q = query.toLowerCase();
  if (q.includes("leave balance") || q.includes("leave remaining")) return AI_RESPONSES["leave balance"];
  if (q.includes("payslip") || q.includes("salary credited")) return AI_RESPONSES["payslip"];
  if (q.includes("casual leave") || q.includes("apply") && q.includes("leave")) return AI_RESPONSES["casual leave"];
  if (q.includes("holiday") || q.includes("company holiday")) return AI_RESPONSES["holidays"];
  if (q.includes("expense") || q.includes("reimbursement")) return AI_RESPONSES["expense"];
  if (q.includes("wfh") || q.includes("work from home") || q.includes("remote")) return AI_RESPONSES["wfh"];
  if (q.includes("vpn") || q.includes("ticket") || q.includes("helpdesk")) return AI_RESPONSES["vpn"];
  if (q.includes("performance") || q.includes("review cycle") || q.includes("appraisal")) return AI_RESPONSES["performance"];
  if (q.includes("training") || q.includes("course") || q.includes("learning")) return AI_RESPONSES["training"];
  if (q.includes("new joiner") || q.includes("onboarding") || q.includes("first day")) return AI_RESPONSES["new joiner"];
  if (q.includes("salary structure") || q.includes("ctc") || q.includes("salary component")) return AI_RESPONSES["salary structure"];
  if (q.includes("referral") || q.includes("refer")) return AI_RESPONSES["referral"];
  
  return {
    content: `I understand you're asking about "${query}". While I don't have a specific answer for that right now, here are some things I can help with:\n\n• 📅 Leave balance & applications\n• 💰 Payslip & salary details\n• 📋 Company policies (WFH, expenses, etc.)\n• 🎯 Performance reviews & goals\n• 📚 Training & learning\n• 🎫 IT helpdesk & support\n• 👋 Onboarding help\n• 💼 Referral program\n\nTry asking me about any of these topics!`,
    actions: [
      { label: "Browse FAQ", href: "/knowledgebase", icon: ArrowRight },
      { label: "Contact HR", href: "/helpdesk", icon: ArrowRight },
    ],
  };
}

const SUGGESTED_QUESTIONS = [
  "What is my leave balance?",
  "Show me my latest payslip",
  "When is the next holiday?",
  "How do I apply for WFH?",
  "What training should I complete?",
  "When is my performance review?",
  "What is the referral bonus?",
  "Explain my salary structure",
];

const CATEGORIES = ["All", "Leave", "Payroll", "Policy", "IT", "Performance", "Learning", "Benefits", "Calendar", "Onboarding"];

const GRADIENTS = ["from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600","from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600"];

export default function ChatbotPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! 👋 I'm your **HR AI Assistant**. I can help you with leave balances, payslip queries, company policies, performance reviews, and much more.\n\nWhat would you like to know?",
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [tab, setTab] = useState("chat");
  const [catFilter, setCatFilter] = useState("All");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    // Simulate AI thinking
    await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));

    const response = getAIResponse(text);
    const aiMsg: Message = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: response.content,
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      actions: response.actions,
      sources: response.sources,
    };
    setMessages(prev => [...prev, aiMsg]);
    setIsTyping(false);
  }, []);

  const giveFeedback = useCallback((msgId: string, type: "up" | "down") => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: type } : m));
    toast.success(type === "up" ? "Thanks for the feedback!" : "Sorry about that. We'll improve.");
  }, []);

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content.replace(/\*\*/g, "").replace(/[•📅💰📋🎯📚🎫👋💼🟢🔴🟡🔵⚠️✅💡⏱️💳📎📊🏆💵🎉🔧🏠📈🪔🎄🇮🇳⭐]/g, ""));
    toast.success("Copied to clipboard");
  }, []);

  const filteredActions = catFilter === "All" ? QUICK_ACTIONS : QUICK_ACTIONS.filter(a => a.category === catFilter);

  return (
    <div className="p-6 space-y-4 h-[calc(100vh-64px)] flex flex-col">
      <div className="flex items-center justify-between animate-slide-up shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg"><Bot className="h-6 w-6" /></div>
          <div><h1 className="text-xl font-bold tracking-tight">HR Assistant</h1><p className="text-muted-foreground text-xs flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />Online — Powered by AI</p></div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs gap-1"><Sparkles className="h-3 w-3" />AI Beta</Badge>
          <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => { setMessages([messages[0]]); toast.success("Chat cleared"); }}><RotateCcw className="h-3 w-3" />Clear</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0"><TabsTrigger value="chat">Chat</TabsTrigger><TabsTrigger value="actions">Quick Actions ({QUICK_ACTIONS.length})</TabsTrigger><TabsTrigger value="faq">Suggested</TabsTrigger></TabsList>

        {/* CHAT TAB */}
        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-2">
          <Card className="flex-1 flex flex-col min-h-0">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4 pb-4">
                {messages.map(msg => (
                  <div key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "")}>
                    {msg.role === "assistant" && (
                      <Avatar className="h-8 w-8 shrink-0 mt-0.5"><AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs"><Bot className="h-4 w-4" /></AvatarFallback></Avatar>
                    )}
                    <div className={cn("max-w-[80%] rounded-2xl px-4 py-3", msg.role === "user" ? "bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-br-md" : "bg-muted rounded-bl-md")}>
                      <div className={cn("text-sm whitespace-pre-wrap leading-relaxed", msg.role === "user" ? "text-white" : "")} dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>") }} />
                      {/* Actions */}
                      {msg.actions && msg.actions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">{msg.actions.map(action => (
                          <Button key={action.label} size="sm" variant={msg.role === "user" ? "secondary" : "outline"} className="h-7 text-[10px] gap-1" onClick={() => toast.success(`Opening ${action.label}...`)}>{action.label}<ChevronRight className="h-2.5 w-2.5" /></Button>
                        ))}</div>
                      )}
                      {/* Sources */}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">{msg.sources.map(s => <Badge key={s} variant="outline" className="text-[8px]">{s}</Badge>)}</div>
                      )}
                      {/* Feedback + Meta */}
                      <div className="flex items-center gap-2 mt-2">
                        <span className={cn("text-[9px]", msg.role === "user" ? "text-white/60" : "text-muted-foreground")}>{msg.timestamp}</span>
                        {msg.role === "assistant" && msg.id !== "welcome" && (
                          <div className="flex items-center gap-0.5 ml-auto">
                            <button className={cn("p-1 rounded hover:bg-background/50", msg.feedback === "up" && "text-emerald-500")} onClick={() => giveFeedback(msg.id, "up")}><ThumbsUp className="h-3 w-3" /></button>
                            <button className={cn("p-1 rounded hover:bg-background/50", msg.feedback === "down" && "text-red-500")} onClick={() => giveFeedback(msg.id, "down")}><ThumbsDown className="h-3 w-3" /></button>
                            <button className="p-1 rounded hover:bg-background/50" onClick={() => copyMessage(msg.content)}><Copy className="h-3 w-3" /></button>
                          </div>
                        )}
                      </div>
                    </div>
                    {msg.role === "user" && (
                      <Avatar className="h-8 w-8 shrink-0 mt-0.5"><AvatarFallback className="bg-gradient-to-br from-blue-500 to-cyan-500 text-white text-xs"><User className="h-4 w-4" /></AvatarFallback></Avatar>
                    )}
                  </div>
                ))}
                {isTyping && (
                  <div className="flex gap-3">
                    <Avatar className="h-8 w-8 shrink-0"><AvatarFallback className="bg-gradient-to-br from-violet-500 to-purple-600 text-white text-xs"><Bot className="h-4 w-4" /></AvatarFallback></Avatar>
                    <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3"><div className="flex gap-1"><span className="h-2 w-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} /><span className="h-2 w-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} /><span className="h-2 w-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} /></div></div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="p-3 border-t">
              <form onSubmit={e => { e.preventDefault(); sendMessage(input); }} className="flex gap-2">
                <Input className="flex-1" placeholder="Ask me anything about HR..." value={input} onChange={e => setInput(e.target.value)} disabled={isTyping} />
                <Button type="submit" className="bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 gap-1" disabled={!input.trim() || isTyping}><Send className="h-4 w-4" /></Button>
              </form>
              <div className="flex flex-wrap gap-1 mt-2">
                {SUGGESTED_QUESTIONS.slice(0, 4).map(q => (
                  <button key={q} className="text-[9px] px-2 py-1 rounded-full border hover:bg-muted/50 transition-all text-muted-foreground hover:text-foreground" onClick={() => sendMessage(q)}>{q}</button>
                ))}
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* QUICK ACTIONS TAB */}
        <TabsContent value="actions" className="mt-2">
          <div className="flex flex-wrap gap-1 mb-3">{CATEGORIES.map(c => (
            <Button key={c} variant={catFilter === c ? "default" : "outline"} size="sm" className={cn("h-7 text-[10px]", catFilter === c && "bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0")} onClick={() => setCatFilter(c)}>{c}</Button>
          ))}</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredActions.map(action => (
              <Card key={action.id} className="group cursor-pointer hover:shadow-lg transition-all" onClick={() => { setTab("chat"); sendMessage(action.prompt); }}>
                <CardContent className="p-4 text-center">
                  <div className={`mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${action.color} text-white shadow-md transition-transform group-hover:scale-110 mb-2`}><action.icon className="h-5 w-5" /></div>
                  <p className="text-xs font-semibold">{action.label}</p>
                  <Badge variant="outline" className="mt-1.5 text-[8px]">{action.category}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* FAQ TAB */}
        <TabsContent value="faq" className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground mb-3">Click any question to get an instant answer</p>
          {SUGGESTED_QUESTIONS.map((q, i) => (
            <Card key={q} className="group cursor-pointer hover:shadow-sm transition-all" onClick={() => { setTab("chat"); sendMessage(q); }}>
              <CardContent className="p-3.5 flex items-center gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} text-white shadow-sm`}><MessageSquare className="h-4 w-4" /></div>
                <p className="text-sm font-medium flex-1">{q}</p>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
