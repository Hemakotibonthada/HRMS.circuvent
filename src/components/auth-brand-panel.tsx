/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { CalendarCheck, ShieldCheck, Wallet } from "lucide-react";

/**
 * The illustrated half of the sign-in and sign-up screens.
 *
 * Hidden below `lg`. On a phone the form is the only thing worth showing, and a
 * 720px-tall decoration above it would push the password field off the fold.
 *
 * The artwork is a plain <img> rather than next/image on purpose: it is an
 * animated SVG, and the image optimiser either refuses SVG outright without
 * `dangerouslyAllowSVG` or rasterises it, and a rasterised SVG has no
 * animation left in it. It is marked decorative — the headline beside it
 * already carries the meaning, so announcing it again would only add noise for
 * a screen-reader user.
 */
const POINTS = [
  { icon: CalendarCheck, text: "Attendance, leave and shifts in one timeline" },
  { icon: Wallet, text: "Payslips and reimbursements without the email chain" },
  { icon: ShieldCheck, text: "One Circuvent account across every app" },
];

export function AuthBrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-gradient-to-br from-violet-600 via-purple-700 to-indigo-800 lg:flex lg:flex-col lg:justify-between">
      {/* Depth behind the artwork. Kept subtle so the copy stays readable. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl animate-blob" />
        <div className="absolute -bottom-28 -right-20 h-[26rem] w-[26rem] rounded-full bg-fuchsia-400/15 blur-3xl animate-blob animation-delay-3000" />
      </div>

      <div className="relative z-10 shrink-0 p-8 xl:p-10">
        <Link href="/" className="inline-flex items-center gap-3">
          <img src="/logo-mark-64.png" alt="" width={40} height={40} className="h-10 w-10" />
          <span className="text-lg font-bold tracking-tight text-white">
            Circuvent <span className="text-violet-200">HRMS</span>
          </span>
        </Link>
      </div>

      {/*
        The cap is in `vh`, not `%`, on purpose. `max-h-full` resolves against
        the flex track whose height this image is itself contributing to, so it
        never actually constrains anything and the copy below still gets pushed
        off a short laptop screen. A viewport-relative cap breaks that loop and
        leaves a predictable budget for the headline and the list.
      */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-hidden px-8">
        <img
          src="/img/auth-people.svg"
          alt=""
          aria-hidden="true"
          width={640}
          height={720}
          className="h-auto max-h-[38vh] w-auto max-w-md object-contain animate-fade-in"
        />
      </div>

      <div className="relative z-10 shrink-0 p-8 xl:p-10">
        <h2 className="max-w-md text-xl font-bold leading-snug text-white animate-slide-up xl:text-2xl">
          Everything your people need, in one place.
        </h2>
        <ul className="stagger-children mt-5 space-y-2.5">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-violet-100">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
