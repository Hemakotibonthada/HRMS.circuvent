// @vitest-environment node
//
// `attemptDocumentPdfStorage` and everything above it in this file talk to
// Postgres through `withTenant`, exactly like every other `*.neon.ts`
// repository and `paystub-sync-outbox.ts` itself — none of those have a
// dedicated unit test, because there is no live database in this run. What
// is new here, and does not exist in the paystub outbox at all, is
// `deliverDocumentPdfStorage`: the render → hash → key → upload pipeline,
// deliberately built with no `ctx` and no DB access so that the three things
// this feature exists to get right — a failed upload is never reported as a
// success, storage that is not configured fails loudly, and the storage key
// can never be steered by anything a person typed — are provable without one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deliverDocumentPdfStorage,
  documentPdfRetryDelayMinutes,
  type DocumentPdfSource,
} from "@/lib/document-pdf-outbox";
import { putObject } from "@/lib/storage/object-store";
import type { RenderDocumentPdfParams } from "@/lib/documents/render-pdf";

function source(over: Partial<DocumentPdfSource> = {}): DocumentPdfSource {
  return {
    documentId: "doc-1",
    orgId: "org-1",
    title: "Offer Letter",
    companyName: "Acme Inc",
    renderedBody: "<p>Hello</p>",
    signatories: [],
    ...over,
  };
}

describe("documentPdfRetryDelayMinutes", () => {
  it("doubles with each attempt", () => {
    expect(documentPdfRetryDelayMinutes(1)).toBe(2);
    expect(documentPdfRetryDelayMinutes(2)).toBe(4);
    expect(documentPdfRetryDelayMinutes(3)).toBe(8);
  });

  it("stops doubling at the same 1024-minute ceiling as the other two outboxes", () => {
    expect(documentPdfRetryDelayMinutes(10)).toBe(1024);
    expect(documentPdfRetryDelayMinutes(50)).toBe(1024);
  });
});

describe("deliverDocumentPdfStorage: the happy path", () => {
  it("renders, hashes, uploads under the resulting key, and reports success with it", async () => {
    const pdfBytes = new Uint8Array([1, 2, 3]);
    const render = vi.fn(async () => pdfBytes);
    const hash = vi.fn(async () => "a".repeat(64));
    const upload = vi.fn(async () => undefined);
    const success = vi.fn(async () => undefined);
    const failure = vi.fn(async () => undefined);

    const result = await deliverDocumentPdfStorage(source(), { success, failure }, { render, hash, upload });

    const expectedKey = `documents/org-1/doc-1/${"a".repeat(64)}.pdf`;
    expect(result).toEqual({ ok: true, key: expectedKey });
    expect(hash).toHaveBeenCalledWith(pdfBytes);
    expect(upload).toHaveBeenCalledWith(expectedKey, pdfBytes, "application/pdf");
    expect(success).toHaveBeenCalledWith(expectedKey);
    expect(failure).not.toHaveBeenCalled();
  });

  it("maps the source's fields onto renderDocumentPdf's own parameter names", async () => {
    // A mismatch here (e.g. `companyName` landing in `title`) would render a
    // structurally valid PDF with the wrong letterhead, and nothing about
    // the "it uploaded fine" outcome would ever surface that.
    let seen: RenderDocumentPdfParams | undefined;
    const render = vi.fn(async (params: RenderDocumentPdfParams) => {
      seen = params;
      return new Uint8Array([1]);
    });
    const upload = vi.fn(async () => undefined);
    const signatories = [
      { name: "Jane Doe", role: "employee", signedAt: new Date("2026-01-01T00:00:00Z") },
    ];

    await deliverDocumentPdfStorage(
      source({ title: "Relieving Letter", companyName: "Acme Inc", renderedBody: "<p>Body</p>", signatories }),
      { success: vi.fn(), failure: vi.fn() },
      { render, upload }
    );

    expect(seen).toEqual({
      title: "Relieving Letter",
      companyName: "Acme Inc",
      bodyHtmlOrText: "<p>Body</p>",
      signingReference: "doc-1",
      signatories,
    });
  });
});

describe("deliverDocumentPdfStorage: a signature that fails to upload", () => {
  it("records a failure and never calls success when the upload rejects", async () => {
    const render = vi.fn(async () => new Uint8Array([1]));
    const upload = vi.fn(async () => {
      throw new Error("R2 unreachable");
    });
    const success = vi.fn(async () => undefined);
    const failure = vi.fn(async () => undefined);

    const result = await deliverDocumentPdfStorage(source(), { success, failure }, { render, upload });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("R2 unreachable");
    expect(success).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith(expect.stringContaining("R2 unreachable"));
  });

  it("records a failure without ever attempting an upload when rendering itself throws", async () => {
    // Proving `upload` is not called here matters as much as the error being
    // recorded: it would be worse to upload zero bytes, or garbage, under a
    // key that then reads back as "this document is archived."
    const render = vi.fn(async () => {
      throw new Error("template contained an unsupported control character");
    });
    const upload = vi.fn(async () => undefined);
    const success = vi.fn(async () => undefined);
    const failure = vi.fn(async () => undefined);

    const result = await deliverDocumentPdfStorage(source(), { success, failure }, { render, upload });

    expect(result.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith(expect.stringContaining("unsupported control character"));
  });

  it("truncates an excessively long error message rather than risk it failing to save at all", async () => {
    const render = vi.fn(async () => {
      throw new Error("x".repeat(2000));
    });
    const upload = vi.fn(async () => undefined);
    const failure = vi.fn(async () => undefined);

    const result = await deliverDocumentPdfStorage(source(), { success: vi.fn(), failure }, { render, upload });

    expect(result.error).toHaveLength(500);
    expect(failure).toHaveBeenCalledWith(expect.stringMatching(/^x{500}$/));
  });
});

describe("deliverDocumentPdfStorage: storage that is not configured", () => {
  // Deliberately uses the real `putObject` rather than a mock upload: the
  // behaviour worth proving is `object-store.ts`'s own refusal to pretend an
  // upload happened, exercised the same way `attemptDocumentPdfStorage`
  // actually calls it in production, not a stand-in for it.
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("fails loudly instead of reporting success for a document that was never stored", async () => {
    const render = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const success = vi.fn(async () => undefined);
    const failure = vi.fn(async () => undefined);

    const result = await deliverDocumentPdfStorage(source(), { success, failure }, { render, upload: putObject });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
    expect(success).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledWith(expect.stringMatching(/not configured/i));
  });
});

describe("deliverDocumentPdfStorage: the key is never derived from user input", () => {
  it("keeps the key to org id, document id and content hash no matter what a person typed as the title", async () => {
    // `render` here deliberately echoes the title into the bytes it returns,
    // so the (real, unmocked) hash genuinely depends on it — the strongest
    // version of this test is not "the title is never read" but "even when
    // it legitimately affects the content, it never appears in the key
    // itself," which is what an attacker or a URL/log viewer would see.
    const maliciousTitle = "../../../etc/passwd\u0000 DROP TABLE documents;-- <script>alert(1)</script>";
    const render = vi.fn(async (params: RenderDocumentPdfParams) =>
      new TextEncoder().encode(`PDF:${params.title}`)
    );
    const upload = vi.fn(async () => undefined);

    const result = await deliverDocumentPdfStorage(
      source({ title: maliciousTitle }),
      { success: vi.fn(), failure: vi.fn() },
      { render, upload }
    );

    expect(result.ok).toBe(true);
    expect(result.key).toMatch(/^documents\/org-1\/doc-1\/[0-9a-f]{64}\.pdf$/);
    expect(result.key).not.toContain("passwd");
    expect(result.key).not.toContain("etc");
    expect(result.key ?? "").not.toContain("DROP TABLE");
    expect(result.key ?? "").not.toContain("script");
  });

  it("changes the key when the rendered content changes, so two different signed copies are never conflated", async () => {
    const upload = vi.fn(async () => undefined);
    const first = await deliverDocumentPdfStorage(
      source(),
      { success: vi.fn(), failure: vi.fn() },
      { render: async () => new Uint8Array([1]), upload }
    );
    const second = await deliverDocumentPdfStorage(
      source(),
      { success: vi.fn(), failure: vi.fn() },
      { render: async () => new Uint8Array([2]), upload }
    );

    expect(first.key).not.toBe(second.key);
  });
});
