import Link from "next/link";
import { Building2, Download, ShieldAlert, Monitor } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { readManifest } from "@/app/api/downloads/windows/route";

export const metadata = pageMetadata({
  title: "Download Circuvent HR for Windows",
  description:
    "Install the Circuvent HR desktop app for Windows 10 and 11. Clock in, book leave, approve requests and see who is in, from a desktop rather than a phone.",
  path: "/download",
});

// The manifest lives in object storage and changes on every release, so this
// page must not be baked at build time — it would keep advertising whichever
// version happened to be current when the site was last deployed.
export const dynamic = "force-dynamic";

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function published(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * The Windows download page.
 *
 * Three things are on it that a marketing page would leave off, and each is
 * there because leaving it off costs somebody something:
 *
 *  - The SmartScreen warning is described before it happens. The installer is
 *    not code-signed, so Windows will say "unrecognised app" in red. Somebody
 *    who meets that cold reasonably concludes they have downloaded malware and
 *    stops; somebody who was told it would happen carries on.
 *  - The SHA-256 is printed. Without a signature it is the only way to tell a
 *    genuine download from a corrupted or substituted one, and a checksum
 *    nobody can see protects nobody.
 *  - The size is stated. A 98MB download on a phone tether is a decision, and
 *    it should be made before the click rather than discovered after it.
 */
export default async function DownloadPage() {
  const manifest = await readManifest();

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
              <Building2 className="h-4 w-4" />
            </div>
            <span className="font-semibold">Circuvent HR</span>
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            <Monitor className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Circuvent HR for Windows</h1>
            <p className="text-sm text-muted-foreground">
              Your working day, from the machine you already have open.
            </p>
          </div>
        </div>

        {manifest ? (
          <>
            <div className="mt-8 rounded-xl border bg-card p-6">
              <a
                href="/api/downloads/windows"
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-violet-700"
              >
                <Download className="h-4 w-4" />
                Download for Windows
              </a>

              <dl className="mt-6 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                <div className="flex justify-between border-b pb-2 sm:border-0 sm:pb-0">
                  <dt className="text-muted-foreground">Version</dt>
                  <dd className="font-medium">{manifest.version}</dd>
                </div>
                <div className="flex justify-between border-b pb-2 sm:border-0 sm:pb-0">
                  <dt className="text-muted-foreground">Size</dt>
                  <dd className="font-medium">{megabytes(manifest.sizeBytes)}</dd>
                </div>
                <div className="flex justify-between border-b pb-2 sm:border-0 sm:pb-0">
                  <dt className="text-muted-foreground">Requires</dt>
                  <dd className="font-medium">{manifest.minimumWindows}</dd>
                </div>
                <div className="flex justify-between border-b pb-2 sm:border-0 sm:pb-0">
                  <dt className="text-muted-foreground">Published</dt>
                  <dd className="font-medium">{published(manifest.publishedAt)}</dd>
                </div>
              </dl>

              {manifest.notes ? (
                <p className="mt-4 text-sm text-muted-foreground">{manifest.notes}</p>
              ) : null}
            </div>

            {!manifest.codeSigned ? (
              <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40">
                <div className="flex gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-900 dark:text-amber-200">
                      Windows will warn you about this installer
                    </p>
                    <p className="mt-1 text-amber-900/90 dark:text-amber-100/90">
                      This build is not code-signed yet, so SmartScreen shows{" "}
                      <em>&ldquo;Windows protected your PC&rdquo;</em> with an unknown
                      publisher. That is expected. Choose{" "}
                      <strong>More info</strong> and then <strong>Run anyway</strong>.
                    </p>
                    <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
                      If you would rather check before trusting it, compare the checksum
                      below with the file you downloaded.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-6 rounded-xl border bg-card p-5">
              <h2 className="text-sm font-semibold">Verify your download</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                In PowerShell, run this against the file you downloaded. The result should
                match exactly.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                <code>Get-FileHash .\{manifest.fileName} -Algorithm SHA256</code>
              </pre>
              <p className="mt-3 text-xs text-muted-foreground">SHA-256</p>
              <p className="mt-1 break-all font-mono text-xs">{manifest.sha256}</p>
            </div>

            <div className="mt-8">
              <h2 className="text-lg font-semibold">What it does</h2>
              <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <li>Clock in and out, and correct a day you missed</li>
                <li>Book leave, and see what it costs before you send it</li>
                <li>See who is in, who is late and who has not arrived</li>
                <li>Approve leave, work-from-home and corrections in one place</li>
                <li>Payslips, expenses, advances and your tax declaration</li>
                <li>Goals, learning, benefits and the equipment you hold</li>
              </ul>
              <p className="mt-4 text-sm text-muted-foreground">
                It signs in to the same account as the phone app and the website. You will
                be asked to sign in each time it starts — nothing is kept on the machine.
              </p>
            </div>
          </>
        ) : (
          <div className="mt-8 rounded-xl border bg-card p-6">
            <h2 className="font-semibold">Not published yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              No Windows build has been published. If you were expecting one, the release
              has not finished uploading.
            </p>
          </div>
        )}

        <p className="mt-10 text-xs text-muted-foreground">
          Looking for the phone app? It is on{" "}
          <Link href="/" className="underline">
            the home page
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
