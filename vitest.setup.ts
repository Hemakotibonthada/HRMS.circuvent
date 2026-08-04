import "@testing-library/jest-dom/vitest";

// Firebase config is now required rather than falling back to hardcoded keys
// (see src/lib/firebase-env.ts). Tests that import modules touching Firebase
// need these present so module evaluation does not throw.
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= "test-api-key";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= "test.firebaseapp.com";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= "test-project";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||= "1:000:web:test";
