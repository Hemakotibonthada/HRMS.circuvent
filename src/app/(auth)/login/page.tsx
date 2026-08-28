"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { SsoButton } from "@/components/sso-button";
import { SsoError } from "@/components/sso-error";
import { AuthBrandPanel } from "@/components/auth-brand-panel";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Sticky once the server has asked for a second factor.
  //
  // It has to be sticky, because a *wrong* code comes back as `mfa_invalid`
  // rather than `mfa_required` — the server has already accepted the password
  // and is answering a narrower question. Deriving the step from the latest
  // response alone would drop the field the moment someone mistyped, which
  // reads as "my password stopped working".
  const [needsSecondFactor, setNeedsSecondFactor] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [code, setCode] = useState("");

  // Focus is moved to the code field when the step appears, rather than with
  // `autoFocus`. The distinction matters: `autoFocus` fires on mount, which on
  // a page like this steals focus before the user has read anything. Moving it
  // in response to the step changing is the deliberate version — a keyboard or
  // screen-reader user is otherwise left at the bottom of a form whose new
  // field appeared above them, with no announcement that it did.
  const codeInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (needsSecondFactor) codeInputRef.current?.focus();
  }, [needsSecondFactor, useBackupCode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in all fields");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          // Sent only on the second step, and only in the field the user
          // actually filled — an empty string would be a code the server has
          // to reject.
          ...(needsSecondFactor && code.trim()
            ? useBackupCode
              ? { backupCode: code.trim() }
              : { totpCode: code.trim() }
            : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        mfaRequired?: boolean;
        passwordResetRequired?: boolean;
        retryAfterSeconds?: number;
        user?: { displayName?: string };
      };

      if (!res.ok) {
        // The server already decides what is safe to disclose — an unknown
        // account and a wrong password deliberately produce the same message —
        // so its wording is shown rather than second-guessed here.
        if (body.mfaRequired) {
          setNeedsSecondFactor(true);
          toast.error("Enter your two-step verification code to continue.");
        } else if (body.passwordResetRequired) {
          toast.error("Your password must be reset before signing in.");
          router.push("/forgot-password");
        } else if (body.retryAfterSeconds) {
          toast.error(
            `Too many attempts. Try again in ${Math.ceil(body.retryAfterSeconds / 60)} minute(s).`
          );
        } else {
          // Covers `mfa_invalid`, which arrives without `mfaRequired`. The
          // field stays put; only the entry is cleared.
          if (needsSecondFactor) setCode("");
          toast.error(body.error || "Login failed. Please try again.");
        }
        return;
      }

      // Tells every useAuth instance to re-read the session it now has.
      window.dispatchEvent(new Event("circuvent-auth-change"));
      toast.success(body.user?.displayName ? `Welcome back, ${body.user.displayName}!` : "Welcome back!");
      router.push("/dashboard");
    } catch {
      toast.error("Could not reach the sign-in service. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <AuthBrandPanel />

      <div className="relative flex items-center justify-center p-4 py-10">
        {/* Background blobs. Only below `lg` — above it the illustrated panel
            already supplies the colour, and a second set behind the form made
            the card edge hard to find. */}
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden lg:hidden" aria-hidden="true">
          <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-violet-400/20 blur-3xl animate-blob" />
          <div className="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-purple-400/15 blur-3xl animate-blob animation-delay-2000" />
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
              <CardTitle className="text-xl">Welcome back</CardTitle>
              <CardDescription>Sign in to your HRMS account</CardDescription>
            </CardHeader>
            <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <SsoError />
              <SsoButton />
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
              {needsSecondFactor && (
                <div className="space-y-2">
                  <Label htmlFor="code">
                    {useBackupCode ? "Recovery code" : "Authenticator code"}
                  </Label>
                  <Input
                    id="code"
                    ref={codeInputRef}
                    // `text` with a numeric hint rather than `type="number"`:
                    // a number input strips the leading zeros a TOTP code can
                    // start with, and recovery codes are not numbers at all.
                    type="text"
                    inputMode={useBackupCode ? "text" : "numeric"}
                    placeholder={useBackupCode ? "XXXXX-XXXXX" : "123456"}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    // Lets a password manager or the iOS SMS/TOTP suggestion
                    // fill it, instead of forcing a copy-paste out of the app.
                    autoComplete="one-time-code"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setUseBackupCode((previous) => !previous);
                      setCode("");
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {useBackupCode
                      ? "Use your authenticator app instead"
                      : "Lost your device? Use a recovery code"}
                  </button>
                </div>
              )}
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
                    {needsSecondFactor ? "Verify" : "Sign In"} <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </form>

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
    </div>
  );
}
