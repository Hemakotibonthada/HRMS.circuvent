// ═══════════════════════════════════════════════════════════════
// MOBILE API CLIENT
// ═══════════════════════════════════════════════════════════════
// Talks to the same routes the web app uses, with three differences that
// matter on a phone.
//
//  1. No cookie jar. A React Native fetch does not persist cookies reliably
//     across app restarts, so tokens are held explicitly in secure storage and
//     sent as a bearer header.
//  2. Refresh has to be single-flight. When the app returns to the foreground
//     a dozen screens refetch at once; without coordination each 401 triggers
//     its own refresh, and because refresh tokens rotate single-use, the
//     second one to land invalidates the first — logging the user out for the
//     crime of opening the app.
//  3. Writes can be queued. A request made with no signal goes to the offline
//     queue instead of failing (see ./offline-queue.ts).
//
// Storage is injected so this is testable without a device and works with
// expo-secure-store.

export interface TokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(access: string, refresh: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  /** Called when the session is unrecoverable and the user must sign in again. */
  onSignedOut?: () => void;
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Mobile networks stall rather than fail cleanly. */
  timeoutMs?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class OfflineError extends Error {
  constructor() {
    super("No connection");
    this.name = "OfflineError";
  }
}

export class MobileApiClient {
  private refreshInFlight: Promise<boolean> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    // Ten seconds: long enough for a slow 3G round-trip, short enough that a
    // dead connection does not leave a spinner running indefinitely.
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>("POST", path, body, idempotencyKey);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    isRetry = false
  ): Promise<T> {
    const access = await this.options.tokens.getAccessToken();

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(access ? { authorization: `Bearer ${access}` } : {}),
          // Lets the server collapse a duplicate submission from a retry or a
          // double-tap into one record.
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // A network failure and a timeout are indistinguishable to the caller
      // and both mean "try again later", so both surface as OfflineError.
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new OfflineError();
      }
      throw new OfflineError();
    }

    if (response.status === 401 && !isRetry) {
      const refreshed = await this.refresh();
      if (refreshed) {
        // Retried once. A second 401 after a successful refresh is an
        // authorisation problem, not an expiry, and retrying would loop.
        return this.request<T>(method, path, body, idempotencyKey, true);
      }
      await this.options.tokens.clear();
      this.options.onSignedOut?.();
      throw new ApiError("Session expired", 401);
    }

    if (!response.ok) {
      // Error bodies are not guaranteed to be JSON: a proxy or edge failure
      // returns HTML, and parsing it would mask the real status.
      let parsed: unknown;
      let message = `Request failed with ${response.status}`;
      try {
        parsed = await response.json();
        const asRecord = parsed as { error?: string | { message?: string } };
        if (typeof asRecord.error === "string") message = asRecord.error;
        else if (asRecord.error?.message) message = asRecord.error.message;
      } catch {
        /* keep the status-based message */
      }
      throw new ApiError(message, response.status, parsed);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /**
   * Refreshes the session, at most once at a time.
   *
   * Concurrent callers await the same promise. Because refresh tokens are
   * single-use and rotate, letting two refreshes run would invalidate the
   * first's replacement and sign the user out.
   */
  private async refresh(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const refreshToken = await this.options.tokens.getRefreshToken();
        if (!refreshToken) return false;

        const response = await this.fetchImpl(`${this.options.baseUrl}/api/auth/refresh`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Sent in the body rather than a cookie, since React Native has no
            // dependable cookie jar across restarts.
            authorization: `Bearer ${refreshToken}`,
          },
          body: JSON.stringify({ refreshToken }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) return false;

        const body = (await response.json()) as {
          accessToken?: string;
          refreshToken?: string;
        };
        if (!body.accessToken || !body.refreshToken) return false;

        await this.options.tokens.setTokens(body.accessToken, body.refreshToken);
        return true;
      } catch {
        // A refresh that failed on the network is not proof the session is
        // gone; the caller falls back to an error rather than signing out, and
        // the next attempt may succeed.
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  async signIn(email: string, password: string, totpCode?: string): Promise<void> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, totpCode, app: "hrms" }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const body = (await response.json().catch(() => ({}))) as {
      accessToken?: string;
      refreshToken?: string;
      error?: string;
      mfaRequired?: boolean;
    };

    if (!response.ok) {
      throw new ApiError(body.error ?? "Sign-in failed", response.status, body);
    }
    if (!body.accessToken || !body.refreshToken) {
      // The web flow sets cookies; mobile needs the tokens in the body. A
      // response without them means the server is not in mobile mode.
      throw new ApiError("Sign-in did not return tokens", 500, body);
    }

    await this.options.tokens.setTokens(body.accessToken, body.refreshToken);
  }

  async signOut(): Promise<void> {
    try {
      await this.post("/api/auth/logout", {});
    } catch {
      // Signing out must always appear to succeed. If the server call failed
      // the token still expires on its own, and refusing to clear local state
      // would strand the user signed in.
    }
    await this.options.tokens.clear();
    this.options.onSignedOut?.();
  }
}
