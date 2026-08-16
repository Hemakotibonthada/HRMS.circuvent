// Reports a failed API request to the Circuvent App Insights collector.
//
// Copy this file into any application in the suite. It has no dependencies
// beyond `fetch`, so it works unchanged in every Next.js app here and in a
// plain Node service.
//
// Two environment variables:
//   INSIGHTS_INGEST_URL    https://circuvent.com/api/telemetry/failure
//   INSIGHTS_INGEST_TOKEN  the shared bearer token
//
// When either is missing the reporter does nothing at all — quietly, and by
// design. An observability client that throws, or that blocks a response while
// it retries, converts a handled 500 into an outage. It is allowed to lose a
// report; it is not allowed to affect the request it is reporting on.
//
// SERVER ONLY.

export interface FailureReport {
  /** The route as your framework knows it, ids and all — it is normalised for you. */
  route: string;
  method: string;
  status: number;
  /**
   * The signed-in person, if there was one.
   *
   * This is the whole point of the collector: "which API failed for which
   * employee". Pass the address you have already authenticated — never one
   * read from a request body or a query string.
   */
  actor?: string | null;
  actorRole?: string | null;
  error?: unknown;
  /** Ties this to the same request as seen by another application. */
  requestId?: string | null;
  durationMs?: number;
}

const APP = process.env.INSIGHTS_APP || "unknown";

/**
 * Best-effort identity for a failing request.
 *
 * These applications carry the signed-in person in a bearer token, so the
 * claim is read straight out of it. Read, not verified — this value is a label
 * on a diagnostic record and nothing is authorised by it. Verifying would mean
 * fetching JWKS from inside an error handler, which is a network call on the
 * unhappy path for no gain: a forged token can put a wrong name on a failure
 * report, and can do nothing else.
 *
 * `x-cv-actor` wins when present, for callers that already know who it is.
 */
export function actorFromHeaders(
  headers: Record<string, string | string[] | undefined> | Headers
): string | undefined {
  const get = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const v = (headers as Record<string, string | string[] | undefined>)[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const explicit = get("x-cv-actor");
  if (explicit) return explicit.trim().toLowerCase().slice(0, 160);

  const auth = get("authorization");
  const token = auth?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return undefined;

  const parts = token.split(".");
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { email?: unknown; preferred_username?: unknown; sub?: unknown };
    const candidate = payload.email ?? payload.preferred_username ?? payload.sub;
    if (typeof candidate !== "string" || !candidate.includes("@")) return undefined;
    return candidate.trim().toLowerCase().slice(0, 160);
  } catch {
    return undefined;
  }
}

function endpoint(): string | null {
  const url = process.env.INSIGHTS_INGEST_URL?.trim();
  const token = process.env.INSIGHTS_INGEST_TOKEN?.trim();
  return url && token ? url : null;
}

/** Pulls a type, a message and a short stack out of whatever was thrown. */
export function describeError(error: unknown): {
  errorType: string;
  errorMessage: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      // `constructor.name` rather than `name`: a PostgresError and a TypeError
      // are different problems with different owners, and both report "Error"
      // when only `name` is consulted.
      errorType: error.constructor?.name || error.name || "Error",
      errorMessage: error.message || String(error),
      stack: error.stack,
    };
  }
  if (typeof error === "string") return { errorType: "Error", errorMessage: error };
  if (error && typeof error === "object") {
    const o = error as { message?: unknown; code?: unknown; name?: unknown };
    return {
      errorType: String(o.name ?? o.code ?? "Error"),
      errorMessage: String(o.message ?? JSON.stringify(error).slice(0, 300)),
    };
  }
  return { errorType: "Error", errorMessage: error === undefined ? "unknown" : String(error) };
}

/**
 * Sends one failure. Never throws, never rejects.
 *
 * Not awaited by callers in a hot path — but do not fire it and return either:
 * a serverless function that responds before its promises settle is frozen,
 * and the report is lost. Use your framework's `after()` where you have one,
 * or await it; it is a single small POST with a short timeout.
 */
export async function reportFailure(report: FailureReport): Promise<void> {
  const url = endpoint();
  if (!url) return;

  try {
    const { errorType, errorMessage, stack } = describeError(report.error);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.INSIGHTS_INGEST_TOKEN!.trim()}`,
      },
      body: JSON.stringify({
        app: APP,
        failures: [
          {
            at: new Date().toISOString(),
            route: report.route,
            method: report.method,
            status: report.status,
            actor: report.actor ?? undefined,
            actorRole: report.actorRole ?? undefined,
            errorType,
            errorMessage,
            stack,
            requestId: report.requestId ?? undefined,
            durationMs: report.durationMs,
          },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));
  } catch {
    // Losing a diagnostic must never cost the request it describes.
  }
}

type Handler = (request: Request, ...rest: never[]) => Promise<Response> | Response;

export interface WrapOptions {
  /**
   * Who the request is for, resolved from your own session — never from the
   * request body. Called only when something has gone wrong, so it costs
   * nothing on the successful path.
   */
  actor?: (request: Request) => Promise<string | null | undefined> | string | null | undefined;
  /**
   * Your framework's "keep working after the response" hook — `after` from
   * `next/server`. Without one the report is awaited before responding, which
   * is correct but adds its latency to a request that has already failed.
   */
  defer?: (task: () => Promise<void>) => void;
}

/**
 * Wraps a route handler so its failures are reported.
 *
 * Catches two different things, because they look the same to a user and
 * completely different in code: a handler that throws, and a handler that
 * returns 5xx perfectly calmly. Reporting only thrown errors misses every
 * route that already has a try/catch — which, in this codebase, is most of
 * them.
 *
 * A thrown error is re-thrown after reporting. Swallowing it here would change
 * what the caller sees in order to make a graph look tidier.
 */
export function withInsights(handler: Handler, options: WrapOptions = {}): Handler {
  return async (request: Request, ...rest: never[]) => {
    const started = Date.now();
    const url = new URL(request.url);

    const send = async (status: number, error: unknown) => {
      let actor: string | null | undefined;
      try {
        actor = await options.actor?.(request);
      } catch {
        actor = undefined;
      }
      await reportFailure({
        route: url.pathname,
        method: request.method,
        status,
        actor,
        error,
        requestId: request.headers.get("x-request-id"),
        durationMs: Date.now() - started,
      });
    };

    const dispatch = (status: number, error: unknown) => {
      if (options.defer) options.defer(() => send(status, error));
      else return send(status, error);
      return Promise.resolve();
    };

    try {
      const response = await handler(request, ...rest);
      if (response.status >= 500) {
        await dispatch(response.status, new Error(`Handler returned ${response.status}`));
      }
      return response;
    } catch (error) {
      await dispatch(500, error);
      throw error;
    }
  };
}
