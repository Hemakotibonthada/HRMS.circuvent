"use client";

// ═══════════════════════════════════════════════════════════════
// GET THE APP
// ═══════════════════════════════════════════════════════════════
// Renders nothing when no store URL is configured. See src/lib/mobile-app.ts:
// a store button that 404s reads as "the app was withdrawn", which is a worse
// outcome than never having advertised it.
//
// This is a plain styled link, not Google's "Get it on Google Play" badge.
// That badge is Google's artwork and its use is governed by their brand
// guidelines — it has to be downloaded from the Play brand resource centre and
// used unmodified, at the stated minimum sizes, and it must not be recreated.
// Drawing an approximation of it here would be both a trademark problem and a
// worse-looking button. If you want the official badge, download it and drop
// it in `public/`; the layout below has room for it.

import { Smartphone } from "lucide-react";
import { MOBILE_APP } from "@/lib/mobile-app";
import { cn } from "@/lib/utils";

export interface GetTheAppProps {
  /** `inline` for a nav or footer, `card` for a section with an explanation. */
  variant?: "inline" | "card";
  className?: string;
}

export function GetTheApp({ variant = "inline", className }: GetTheAppProps) {
  const { play, appStore } = MOBILE_APP;

  // Not "coming soon" either. A promise with no date is a thing to be held to.
  if (!play && !appStore) return null;

  const links = (
    <div className="flex flex-wrap items-center gap-3">
      {play ? (
        <a
          href={play}
          target="_blank"
          // `noopener` closes the reverse-tabnabbing hole; `noreferrer` keeps
          // the internal URL out of the store's referrer logs.
          rel="noopener noreferrer"
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-xl bg-foreground px-5",
            "text-sm font-semibold text-background transition-opacity hover:opacity-90",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          )}
        >
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          {/* The destination is named. "Download" alone gives a screen-reader
              user a link with no idea where it goes or that it leaves the site. */}
          <span>Get it on Google Play</span>
        </a>
      ) : null}

      {appStore ? (
        <a
          href={appStore}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-5",
            "text-sm font-semibold transition-colors hover:bg-muted",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          )}
        >
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          <span>Download on the App Store</span>
        </a>
      ) : null}
    </div>
  );

  if (variant === "inline") {
    return <div className={className}>{links}</div>;
  }

  return (
    <section
      aria-labelledby="get-the-app-heading"
      className={cn("rounded-2xl border border-border/60 bg-card/60 p-6", className)}
    >
      <h2 id="get-the-app-heading" className="text-lg font-semibold">
        Circuvent HR on your phone
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Clock in and out, book leave, check your shifts and read your payslip.
        Clock-in works with no signal — it is saved on the phone and sent when
        you reconnect. Sign in with the same account you use here.
      </p>
      <div className="mt-4">{links}</div>
    </section>
  );
}
