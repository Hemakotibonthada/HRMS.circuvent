"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { auth, signInWithEmailAndPassword } from "@/lib/firebase";
import {
  isLocalCredentialsMode,
  validateLocalCredentials,
  setLocalSession,
  LOCAL_USERS,
} from "@/lib/local-auth";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const isLocalMode = isLocalCredentialsMode();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in all fields");
      return;
    }
    setLoading(true);

    // LOCAL CREDENTIALS MODE
    if (isLocalMode) {
      // Small delay to mimic network
      await new Promise((r) => setTimeout(r, 400));
      const localUser = validateLocalCredentials(email, password);
      if (localUser) {
        setLocalSession(localUser);
        window.dispatchEvent(new Event("local-auth-change"));
        toast.success(`Welcome back, ${localUser.displayName}!`);
        router.push("/dashboard");
      } else {
        toast.error("Invalid email or password");
      }
      setLoading(false);
      return;
    }

    // FIREBASE MODE
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast.success("Welcome back!");
      router.push("/dashboard");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Login failed";
      if (message.includes("invalid-credential") || message.includes("wrong-password")) {
        toast.error("Invalid email or password");
      } else if (message.includes("user-not-found")) {
        toast.error("No account found with this email");
      } else if (message.includes("too-many-requests")) {
        toast.error("Too many attempts. Try again later.");
      } else {
        toast.error("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-violet-400/20 blur-3xl animate-blob" />
        <div className="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-purple-400/15 blur-3xl animate-blob animation-delay-2000" />
      </div>

      <div className="w-full max-w-md animate-scale-in">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg">
              <Building2 className="h-6 w-6" />
            </div>
            <span className="text-xl font-bold tracking-tight">
              Circuvent <span className="text-primary">HRMS</span>
            </span>
          </Link>
        </div>

        <Card className="border-0 shadow-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Sign in to your HRMS account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
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
                    Signing in...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Sign In <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </form>

            {/* Quick login buttons for local mode */}
            {isLocalMode && (
              <div className="mt-5 border-t pt-4">
                <p className="text-xs text-center text-muted-foreground mb-3 flex items-center justify-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Local Credentials Mode
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {LOCAL_USERS.map((localUser) => (
                    <Button
                      key={localUser.email}
                      variant="outline"
                      size="sm"
                      className="text-xs h-9 justify-start gap-2"
                      onClick={() => {
                        // Only prefills the email — the dev password comes from
                        // NEXT_PUBLIC_LOCAL_DEV_PASSWORD and is never bundled here.
                        setEmail(localUser.email);
                        setPassword(process.env.NEXT_PUBLIC_LOCAL_DEV_PASSWORD ?? "");
                      }}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-purple-600 text-[9px] text-white font-bold">
                        {localUser.displayName.split(" ").map(n => n[0]).join("").slice(0, 2)}
                      </span>
                      <span className="truncate">{localUser.displayName}</span>
                      <span className="ml-auto rounded bg-muted px-1 py-0.5 text-[9px] capitalize text-muted-foreground">{localUser.role}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-primary font-medium hover:underline">
                Create one
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
