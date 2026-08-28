# HRMS.circuvent — Architecture Documentation

Reverse-engineered technical documentation for `hrms.circuvent.com`, the system of record for **who works here** — and the largest application in the Circuvent suite.

---

## Where to start

| You are… | Read this |
| --- | --- |
| **New to the team** | `01_SYSTEM_OVERVIEW.md` §1–§6, then `04` §1 to get it running |
| **A backend engineer** | `02_DATABASE_AND_DATA_MODELS.md` in full — especially §4, row-level security |
| **Working on integrations** | `03_INTEGRATIONS_AND_ECOSYSTEM.md`, then `01` §5 |
| **On call** | `04_MAINTENANCE_AND_OPERATIONS.md` §10, the debugging playbook |
| **A security reviewer** | `02` §4 and §6, `03` §10, `05` §2 |
| **A CTO or EM** | `01` §1 and §10, then `05` §1, §6 and §8 |
| **In a hurry** | `05` §8 — *If you only do five things* |

---

## Source documents

| File | Covers |
| --- | --- |
| `01_SYSTEM_OVERVIEW.md` | Executive summary · topology · module map · the security model · core workflows · design patterns · health scorecard |
| `02_DATABASE_AND_DATA_MODELS.md` | 117 tables across 2 schemas · 44 enums · full ER model · **row-level security and the incident** · 39 migrations · field encryption · the 5 database guards |
| `03_INTEGRATIONS_AND_ECOSYSTEM.md` | The four ways in · 150 routes grouped · suite SSO · SCIM · API keys · the Paystub outbox · every failure mode · risk register |
| `04_MAINTENANCE_AND_OPERATIONS.md` | Local setup · configuration · **the only real CI in the suite** · the 9 guard scripts · test suite · deployment · debugging playbook |
| `05_AREAS_OF_ENHANCEMENT.md` | Gap analysis · 36-item debt log · the float seam · three codebases problem · phased roadmap · what not to change |

## Generated deliverables

| File | Format |
| --- | --- |
| `Architecture_Guide.md` | All five documents aggregated into one master reference |
| `Architecture_Guide.docx` | Word — styled headings, tables, callouts |
| `Architecture_Guide.pdf` | PDF — cover page, table of contents, vector diagrams |
| `Architecture_Overview.pptx` | Slide deck — overview, topology, data, integrations, roadmap |

Regenerate all four with:

```bash
python generate_docs.py
```

Requires `python-docx`, `python-pptx`, `reportlab`, `markdown`.

---

## Headline findings

```
   ╔══════════════════════════════════════════════════════════════════════╗
   ║  SCALE                                                               ║
   ║    1,454 files · 574 src TypeScript · 144,146 lines                  ║
   ║    150 API routes · 102 pages · 117 database tables · 44 enums       ║
   ║    92 test files · 2,664 tests passing · 39 migrations               ║
   ║    Plus a shipped Kotlin Android app at v1.8.0 / versionCode 10      ║
   ╠══════════════════════════════════════════════════════════════════════╣
   ║  THE DEFINING FINDING                                                ║
   ║                                                                      ║
   ║    "ninety-one correct policies and seventy-five passing isolation   ║
   ║     tests, while DATABASE_URL pointed at a role with BYPASSRLS and   ║
   ║     every query returned every tenant's rows.                        ║
   ║     Nothing that ran in CI could have noticed."                      ║
   ║                                    — scripts/smoke-live.ts           ║
   ║                                                                      ║
   ║    Fixed by migration 0028 and guarded at runtime by                 ║
   ║    assertConnectionIsolatesTenants(). The two verification scripts   ║
   ║    that would have caught it are STILL not in CI.                    ║
   ╠══════════════════════════════════════════════════════════════════════╣
   ║  WHAT IS GENUINELY EXCELLENT                                         ║
   ║    • Nine verification scripts that check what tests cannot          ║
   ║    • FORCE ROW LEVEL SECURITY on 117 tables, swept by one function   ║
   ║    • Argon2id with auto-rehash; refresh-token family revocation      ║
   ║    • MFA that will not issue backup codes for an unproven secret     ║
   ║    • orgId derived from the verified token in 149 of 150 routes      ║
   ║    • Transactional outbox, used four times                           ║
   ║    • Hash-chained, append-only audit log                             ║
   ║    • Modules that open by naming the bug they exist to prevent       ║
   ╠══════════════════════════════════════════════════════════════════════╣
   ║  WHAT NEEDS ATTENTION                                                ║
   ║    🔴 CI runs no live-database check — the exact blind spot that     ║
   ║       let the BYPASSRLS incident through                             ║
   ║    🔴 A float round-trip inside the bigint payroll pipeline          ║
   ║    🔴 bank_details stored as plaintext jsonb                         ║
   ║    🔴 next.config.ts has no security headers at all                  ║
   ║    🔴 Business rules exist in three codebases; nothing checks them   ║
   ║    🔴 Two architecture documents describe a system that no longer    ║
   ║       exists (they claim Firestore, no Neon, no main branch)         ║
   ║    🟠 Two migrations are missing from the journal and would never    ║
   ║       run in a fresh environment — a currently failing check         ║
   ╚══════════════════════════════════════════════════════════════════════╝
```

---

## Accuracy

Every claim in these documents is traceable to a file in the repository, the live output of a script executed during the audit, or a comment in the source itself. Where the codebase's own documentation contradicts its code, the code is treated as authoritative and the contradiction is recorded as a finding.

Line counts were measured directly over `src/**/*.{ts,tsx}`. The five database guard scripts were **executed live** against the real Neon instance; their pass/fail counts in `02` §9 and `04` §5 are actual results, not descriptions.

*Audit date: 2026-01 · Repository state: `main` + `develop`, 122 commits, working tree dirty*
