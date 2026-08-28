"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import {
  ANSWERABLE_QUESTIONS,
  detectIntent,
  formatHolidays,
  formatLeaveBalance,
  navigationAnswer,
  unknownAnswer,
  type AssistantAnswer,
} from "@/lib/assistant";
import { dateKeyInZone } from "@/lib/date-keys";

/**
 * Answers a question, fetching real data where there is a route for it.
 *
 * A failed fetch says so. It does not fall back to a plausible number, which
 * is the behaviour that made the previous assistant dangerous: an employee
 * asking their leave balance got a confident answer whether or not anything
 * had been read.
 */
async function answerQuestion(query: string): Promise<AssistantAnswer> {
  const intent = detectIntent(query);

  if (intent === "leave_balance") {
    try {
      const year = new Date().getFullYear();
      const response = await fetch(`/api/leave/balances?year=${year}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as {
        balances: { leaveType: string; available: number; used: number; pending: number }[];
      };
      return formatLeaveBalance(body.balances ?? [], year);
    } catch {
      return {
        kind: "unknown",
        content:
          "I could not read your leave balance just now. The Leave page shows it directly, and it is the same figure your manager sees.",
        actions: [{ label: "Leave management", href: "/leave" }],
      };
    }
  }

  if (intent === "holidays") {
    try {
      const response = await fetch(`/api/holidays?year=${new Date().getFullYear()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error();
      const body = (await response.json()) as {
        items: { name: string; holidayDate: string; isOptional: boolean }[];
      };
      return formatHolidays(body.items ?? [], dateKeyInZone(new Date()));
    } catch {
      return {
        kind: "unknown",
        content: "I could not read the holiday calendar just now.",
        actions: [{ label: "Holiday calendar", href: "/holidays" }],
      };
    }
  }

  return navigationAnswer(intent) ?? unknownAnswer(query);
}

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

// Answers come from `@/lib/assistant`, which either fetches real data or says
// where to look. The bank of hardcoded replies that used to live here reported
// invented leave balances, a fabricated performance rating and a made-up
// learning budget — each with a "source" attached, which is what made them
// believable.

const SUGGESTED_QUESTIONS = [...ANSWERABLE_QUESTIONS];

const CATEGORIES = ["All", "Leave", "Payroll", "Policy", "IT", "Performance", "Learning", "Benefits", "Calendar", "Onboarding"];

const GRADIENTS = ["from-violet-500 to-purple-600","from-blue-500 to-cyan-500","from-emerald-500 to-green-600","from-amber-500 to-orange-500","from-pink-500 to-rose-600","from-teal-500 to-cyan-600"];

export default function ChatbotPage() {
  const router = useRouter();
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

    // No artificial delay. The previous version waited 800-2000ms to look like
    // it was thinking, which dressed a table lookup up as reasoning.
    const answer = await answerQuestion(text);

    const aiMsg: Message = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: answer.content,
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      actions: answer.actions.map((a) => ({ ...a, icon: ArrowRight })),
      // Only ever set on an answer that really read something.
      sources: answer.source ? [answer.source] : undefined,
    };
    setMessages(prev => [...prev, aiMsg]);
    setIsTyping(false);
  }, []);

  const giveFeedback = useCallback((msgId: string, type: "up" | "down") => {
    // Highlighting the clicked thumb is real — it's just component state.
    // The toast that used to follow ("Thanks for the feedback! ... We'll
    // improve.") is not: nothing persists this anywhere, so it promised a
    // human would read it and act on it when no one ever will.
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, feedback: type } : m));
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
                        // Each action already carries a real href (e.g. /leave, /holidays) —
                        // it used to fire toast.success("Opening ...") and go nowhere, which
                        // looked like a working link until you clicked it.
                        <div className="flex flex-wrap gap-1.5 mt-3">{msg.actions.map(action => (
                          <Button key={action.label} size="sm" variant={msg.role === "user" ? "secondary" : "outline"} className="h-7 text-[10px] gap-1" onClick={() => router.push(action.href)}>{action.label}<ChevronRight className="h-2.5 w-2.5" /></Button>
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
