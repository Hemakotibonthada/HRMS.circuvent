// ═══════════════════════════════════════════════════════════════
// CONTRACTS — re-exports of the shared, platform-neutral core
// ═══════════════════════════════════════════════════════════════
// The interesting logic — token refresh coordination, the offline queue and
// its backoff, geofence evaluation — lives in ../../src/lib/mobile and is
// shared with the server. It is plain TypeScript with no React Native or DOM
// dependency, deliberately, so that both ends reach the same answer from the
// same code.
//
// This file exists so the rest of the app imports from one place and metro's
// resolution of the parent directory is configured in exactly one location
// (metro.config.js watchFolders, tsconfig paths). It re-exports; it does not
// redeclare. A second copy of TokenStore here would drift from the real one,
// which is the same defect as having had two geofence implementations that
// disagreed about the radius of the Earth.

export type {
  ApiClientOptions,
  TokenStore,
} from "@shared/mobile/api-client";

export {
  ApiError,
  MobileApiClient,
  OfflineError,
} from "@shared/mobile/api-client";

export type {
  OperationKind,
  QueuedOperation,
  QueueStatus,
  QueueStorage,
  Sender,
  SyncResult,
} from "@shared/mobile/offline-queue";

export {
  backoffMs,
  classifyResponse,
  isDue,
  OfflineQueue,
} from "@shared/mobile/offline-queue";

export type {
  ClockInVerdict,
  Coordinates,
  FenceConfidence,
  FenceResult,
  Geofence,
  SpoofSignal,
} from "@shared/mobile/geofence";

export {
  distanceMetres,
  evaluateClockIn,
  locateWithin,
  spoofSignals,
} from "@shared/mobile/geofence";
