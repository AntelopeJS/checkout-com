# checkout-com

The AntelopeJS module that implements `@antelopejs/interface-payment` on Checkout.com's unified Payments API, published as `@antelopejs/checkout-com`.

## Layout

- `src/implementations/payment/` implements the interface; `src/config.ts` holds the module config and the base URL derived from the key.
- `src/test/` holds the suites, compiled with the package and run from `dist/test`. `src/test/antelope.test.ts` is the `antelopeJs.test` config that `ajs module test` reads. `src/test/standin/` is the local HTTP stand-in for Checkout.com.
- `test/renewal-probe/` is a private module the renewal test loads by path. Nothing imports it, so do not delete it as dead code.
- `docs/` and `skills/` ship in the npm package. `docs/5.testing.md` documents the stand-in and the live run; when a change alters behaviour or config, update the matching doc page and `skills/checkout-com/SKILL.md`.

## Versioning

- Every 0.x `@antelopejs/*` range, consumed interfaces included, sits on the newest minor on npm and stops below the next one (`>=0.5.1 <0.6.0`); every 1.x range uses `~`. The `dependency:ranges` step of `pnpm run checks` enforces it.
- `@antelopejs/interface-payment` (a dependency) uses `>=0.2.1 <0.3.0`. This module implements interface-payment, and a new minor may add functions it has to implement, so move to the next minor only after implementing what it adds.
- `@antelopejs/payment-subscriptions` (a devDependency, loaded by the renewal test) stays on the minor built against the same interface versions as this module. When you bump the interfaces, move it to a release built against them.

## Tests

- `pnpm test` builds `dist` once, then runs `ajs module test .` (the `ajs` CLI comes from the `@antelopejs/core` devDependency). The setup starts the stand-in and an in-memory MongoDB 8.0.8, and loads the installed `@antelopejs/payment-subscriptions` for the renewal test. The first run downloads the MongoDB binary, so it needs network access.
- Without `CKO_SECRET_KEY` and `CKO_PROCESSING_CHANNEL_ID`, the suites run against the stand-in. CI sets neither, so it runs the stand-in.
- CI never runs the live suite against Checkout.com's sandbox, and `pnpm run checks` runs it only if both keys are exported. Run it with `CKO_SECRET_KEY=sk_sbox_… CKO_PROCESSING_CHANNEL_ID=pc_… pnpm test`, adding `CKO_BASE_URL` and `CKO_PUBLIC_KEY` as `docs/5.testing.md` describes. A production key is refused. Live, the stand-in-only tests are skipped.
- `src/test/exclusions.test.ts` skips two conformance tests by name in every run; `customers.test.ts` and `saved-methods.test.ts` cover the same flows.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-module/SKILL.md`](.agents/skills/verify-module/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
