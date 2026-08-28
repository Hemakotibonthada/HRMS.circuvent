// @vitest-environment node
//
// This module's whole reason to exist is "never claim success when nothing
// was stored," so most of these tests are about the unhappy paths: no
// credentials, a rejected upload, a bodiless response. The `@aws-sdk/client-s3`
// client itself is mocked — there is no R2 bucket to hit in CI — but the
// mock is only ever told to succeed or fail; it never fabricates a body,
// which is exactly the shortcut that would make a bug like "we return before
// confirming the write" invisible.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class MockS3Client {
    send = sendMock;
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: vi.fn(function PutObjectCommand(input: unknown) {
      return { input };
    }),
    GetObjectCommand: vi.fn(function GetObjectCommand(input: unknown) {
      return { input };
    }),
  };
});

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  documentPdfKey,
  getObjectBytes,
  putObject,
  r2ObjectStore,
  sha256Hex,
  storageConfigured,
  StorageConfigError,
  StorageRequestError,
} from "./object-store";

const original = { ...process.env };

function setConfigured() {
  process.env.S3_ENDPOINT = "https://test-account.r2.cloudflarestorage.com";
  process.env.S3_REGION = "auto";
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_ACCESS_KEY_ID = "test-key-id";
  process.env.S3_SECRET_ACCESS_KEY = "test-secret";
}

beforeEach(() => {
  sendMock.mockReset();
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_REGION;
  delete process.env.S3_BUCKET;
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;
});

afterEach(() => {
  process.env = { ...original };
});

describe("storageConfigured", () => {
  it("is false with no credentials at all", () => {
    expect(storageConfigured()).toBe(false);
  });

  it("is true once every required variable is set", () => {
    setConfigured();
    expect(storageConfigured()).toBe(true);
  });

  it("is false when only some variables are set", () => {
    process.env.S3_ENDPOINT = "https://x.r2.cloudflarestorage.com";
    process.env.S3_BUCKET = "bucket";
    expect(storageConfigured()).toBe(false);
  });
});

describe("unconfigured storage", () => {
  it("refuses to upload rather than pretending to succeed", async () => {
    await expect(putObject("documents/o/d/hash.pdf", new Uint8Array([1]), "application/pdf")).rejects.toThrow(
      StorageConfigError
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses to download rather than returning empty bytes", async () => {
    await expect(getObjectBytes("documents/o/d/hash.pdf")).rejects.toThrow(StorageConfigError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("names what to set instead of a generic error", async () => {
    await expect(putObject("k", new Uint8Array(), "text/plain")).rejects.toThrow(/S3_ENDPOINT/);
  });
});

describe("configured storage", () => {
  beforeEach(setConfigured);

  it("uploads the exact key, bytes and content type given", async () => {
    sendMock.mockResolvedValueOnce({});
    const body = new Uint8Array([1, 2, 3]);

    await putObject("documents/org/doc/hash.pdf", body, "application/pdf");

    expect(vi.mocked(PutObjectCommand)).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "documents/org/doc/hash.pdf",
      Body: body,
      ContentType: "application/pdf",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("wraps an upload rejection instead of letting it look like nothing happened", async () => {
    sendMock.mockRejectedValueOnce(new Error("network unreachable"));

    await expect(putObject("k", new Uint8Array([1]), "application/pdf")).rejects.toThrow(StorageRequestError);
  });

  it("downloads by key and buffers the returned body", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    sendMock.mockResolvedValueOnce({ Body: { transformToByteArray: async () => bytes } });

    const result = await getObjectBytes("documents/org/doc/hash.pdf");

    expect(result).toBe(bytes);
    expect(vi.mocked(GetObjectCommand)).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "documents/org/doc/hash.pdf",
    });
  });

  it("fails instead of returning an empty buffer when there is no body", async () => {
    sendMock.mockResolvedValueOnce({ Body: undefined });
    await expect(getObjectBytes("k")).rejects.toThrow(StorageRequestError);
  });

  it("wraps a download failure", async () => {
    sendMock.mockRejectedValueOnce(new Error("access denied"));
    await expect(getObjectBytes("k")).rejects.toThrow(StorageRequestError);
  });

  it("exposes the same behaviour through the ObjectStore interface object", async () => {
    sendMock.mockResolvedValueOnce({});
    await r2ObjectStore.putObject("k", new Uint8Array([1]), "application/pdf");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("documentPdfKey", () => {
  const hash = "a".repeat(64);

  it("builds a deterministic path from orgId, documentId and the content hash", () => {
    expect(documentPdfKey({ orgId: "org1", documentId: "doc1", sha256Hex: hash })).toBe(
      `documents/org1/doc1/${hash}.pdf`
    );
  });

  it("is stable across calls with the same inputs", () => {
    // Nothing else — no timestamp, no random suffix — is allowed to leak in.
    const a = documentPdfKey({ orgId: "org1", documentId: "doc1", sha256Hex: hash });
    const b = documentPdfKey({ orgId: "org1", documentId: "doc1", sha256Hex: hash });
    expect(a).toBe(b);
  });

  it("rejects a hash-shaped path traversal attempt instead of building an escaping key", () => {
    expect(() =>
      documentPdfKey({ orgId: "org1", documentId: "doc1", sha256Hex: "../../../etc/passwd" })
    ).toThrow();
  });

  it("rejects a hash of the wrong length or casing", () => {
    expect(() => documentPdfKey({ orgId: "o", documentId: "d", sha256Hex: "AB".repeat(32) })).toThrow();
    expect(() => documentPdfKey({ orgId: "o", documentId: "d", sha256Hex: "abc" })).toThrow();
  });
});

describe("sha256Hex", () => {
  it("matches the known SHA-256 of an empty input", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("is deterministic for the same bytes", async () => {
    const bytes = new TextEncoder().encode("signed document");
    expect(await sha256Hex(bytes)).toBe(await sha256Hex(bytes));
  });

  it("differs for different bytes", async () => {
    const a = await sha256Hex(new TextEncoder().encode("a"));
    const b = await sha256Hex(new TextEncoder().encode("b"));
    expect(a).not.toBe(b);
  });
});
