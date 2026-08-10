"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { toast.error("Please enter your email"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };

      if (!res.ok) {
        toast.error(body.error || "Could not send a reset link. Please try again.");
        return;
      }

      // The server answers the same way whether or not the account exists, and
      // so does this screen: showing "no such account" here would give away who
      // is registered.
      setSent(true);
      toast.success(body.message || "If that address has an account, a reset link is on its way.");
    } catch {
      toast.error("Could not reach the service. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"><div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-400/20 blur-3xl animate-blob" /></div>
      <div className="w-full max-w-md animate-scale-in">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2.5"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg"><Building2 className="h-6 w-6" /></div><span className="text-xl font-bold tracking-tight">Circuvent <span className="text-primary">HRMS</span></span></Link>
        </div>
        <Card className="border-0 shadow-xl">
          <CardHeader className="text-center"><CardTitle className="text-xl">{sent ? "Check your email" : "Reset Password"}</CardTitle><CardDescription>{sent ? `We've sent a reset link to ${email}` : "Enter your email and we'll send a reset link"}</CardDescription></CardHeader>
          <CardContent>
            {sent ? (
              <div className="text-center space-y-4"><p className="text-sm text-muted-foreground">Didn&apos;t receive it? Check spam or try again.</p><Button variant="outline" onClick={() => setSent(false)} className="w-full">Try Again</Button><Link href="/login" className="block text-sm text-primary hover:underline mt-2"><ArrowLeft className="inline h-3 w-3 mr-1" />Back to Login</Link></div>
            ) : (
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-2"><Label>Email</Label><Input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <Button type="submit" disabled={loading} className="w-full h-10 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0">{loading ? "Sending..." : "Send Reset Link"}</Button>
                <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="inline h-3 w-3 mr-1" />Back to Login</Link>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
