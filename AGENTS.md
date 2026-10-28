# checkout-com

The AntelopeJS module that implements `@antelopejs/interface-payment` on Checkout.com's unified Payments API, published as `@antelopejs/checkout-com`.

## Layout

- `src/implementations/payment/` implements the interface; `src/config.ts` holds the module config and the base URL derived from the key.
- `src/test/` holds the suites, compiled with the package and run from `dist/test`. `src/test/antelope.test.ts` is the `antelopeJs.test` config that `ajs module test` reads. `src/test/standin/` is the local HTTP stand-in for Checkout.com.
- `test/renewal-probe/` is a private module the renewal test loads by path. Nothing imports it, so do not delete it as dead code.
- `docs/` and `skills/` ship in the npm package. `docs/5.testing.md` documents the stand-in and the live run; when a change alters behaviour or config, update the matching doc page and `skills/checkout-com/SKILL.md`.

## Versioning

- `@antelopejs/interface-payment` (a dependency) uses `>=0.1.0 <0.2.0` and `@antelopejs/interface-subscriptions` (a devDependency) uses `>=0.0.2 <0.1.0`. This module implements interface-payment, and a new minor may add functions it has to implement, so raise the upper bound only after implementing what that minor adds.
- `src/test/fallback-module.ts` clones `@antelopejs/payment-subscriptions` at a pinned commit (its v0.0.2 release) for the renewal test. When you bump the interfaces, move that pin to a release built against the same interface versions.

## Tests

- `pnpm test` builds `dist` once, then runs `ajs module test .` (the `ajs` CLI comes from the `@antelopejs/core` devDependency). The setup starts the stand-in and an in-memory MongoDB 8.0.8, and clones and builds `payment-subscriptions` under `.antelope/` on first run, so the first run needs network access.
- Without `CKO_SECRET_KEY` and `CKO_PROCESSING_CHANNEL_ID`, the suites run against the stand-in. CI sets neither, so it runs the stand-in.
- CI never runs the live suite against Checkout.com's sandbox, and `pnpm run checks` runs it only if both keys are exported. Run it with `CKO_SECRET_KEY=sk_sbox_… CKO_PROCESSING_CHANNEL_ID=pc_… pnpm test`, adding `CKO_BASE_URL` and `CKO_PUBLIC_KEY` as `docs/5.testing.md` describes. A production key is refused. Live, the stand-in-only tests are skipped.
- `src/test/exclusions.test.ts` skips two conformance tests by name in every run; `customers.test.ts` and `saved-methods.test.ts` cover the same flows.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
