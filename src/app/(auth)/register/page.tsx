"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { AuthBrandPanel } from "@/components/auth-brand-panel";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password || !company) {
      toast.error("Please fill in all fields");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      // The organisation, the owner account and its roles are created together
      // in one server transaction. Doing it here meant a half-made tenant
      // whenever any single write failed.
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, company, email, password }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        signedIn?: boolean;
        message?: string;
      };

      if (!res.ok) {
        toast.error(body.error || "Registration failed. Please try again.");
        return;
      }

      if (body.signedIn === false) {
        toast.success(body.message || "Account created. Please sign in.");
        router.push("/login");
        return;
      }

      window.dispatchEvent(new Event("circuvent-auth-change"));
      toast.success("Account created! Welcome to Circuvent HRMS.");
      router.push("/dashboard");
    } catch {
      toast.error("Could not reach the sign-up service. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <AuthBrandPanel />

      <div className="relative flex items-center justify-center p-4 py-10">
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden lg:hidden" aria-hidden="true">
          <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-400/20 blur-3xl animate-blob" />
          <div className="absolute -bottom-40 -right-40 h-[400px] w-[400px] rounded-full bg-purple-400/15 blur-3xl animate-blob animation-delay-2000" />
        </div>

        <div className="w-full max-w-md animate-scale-in">
          <div className="mb-8 text-center lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg">
                <Building2 className="h-6 w-6" />
              </div>
              <span className="text-xl font-bold tracking-tight">
                Circuvent <span className="text-primary">HRMS</span>
              </span>
            </Link>
          </div>

          <Card className="border-0 shadow-xl transition-shadow duration-500 hover:shadow-2xl">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Create your account</CardTitle>
              <CardDescription>Start your 14-day free trial</CardDescription>
            </CardHeader>
            <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company Name</Label>
                <Input
                  id="company"
                  placeholder="Acme Corporation"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Work Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-gradient-to-r from-violet-500 to-purple-600 text-white border-0 shadow-md hover:shadow-lg transition-all"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Creating account...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Create Account <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary font-medium hover:underline">
                Sign in
              </Link>
            </p>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              By creating an account, you agree to our{" "}
              <Link href="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
              <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
