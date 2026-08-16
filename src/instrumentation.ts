import { actorFromHeaders, reportFailure } from "./lib/insights-reporter";

/**
 * Reports every unhandled server error to Circuvent App Insights.
 *
 * Next calls `onRequestError` for anything thrown while handling a request —
 * route handlers, server components, server actions — so one file covers the
 * whole application without touching a single route. That matters here: the
 * alternative was wrapping several hundred handlers across nine repositories,
 * which is the sort of change that is 95% done for ever.
 *
 * What it deliberately does not catch is a handler that swallows its own error
 * and returns a tidy 500. Those are invisible to Next, and the ones worth
 * having are wrapped with `withInsights` at the route instead.
 *
 * Failing to report must never affect the request: `reportFailure` swallows
 * everything and gives up after three seconds.
 */
export async function onRequestError(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context?: { routePath?: string; routeType?: string }
): Promise<void> {
  await reportFailure({
    // `context.routePath` is already the parameterised form (/api/x/[id]) when
    // Next knows it, which groups better than the concrete path.
    route: context?.routePath || request.path,
    method: request.method,
    status: 500,
    actor: actorFromHeaders(request.headers),
    error,
    requestId:
      (Array.isArray(request.headers["x-request-id"])
        ? request.headers["x-request-id"][0]
        : request.headers["x-request-id"]) ?? null,
  });
}
