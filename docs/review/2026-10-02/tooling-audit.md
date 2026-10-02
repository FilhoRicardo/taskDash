# TaskDash tooling audit — 2026-10-02

Scope: `/Users/ricardofilho/Documents/Projects/active/taskdash-2-2`, recovered upstream workflows in `/tmp/taskdash-source-review.RtoY4j/.github/workflows`. Read-only evaluation; this report is the only intentional file edit. Matt Pocock's local `.agents/skills/tdd/SKILL.md` and `retro/SKILL.md` informed behavior-test and automated-check assessment; no setup or writing workflows executed.

## Baseline evidence

- Current commit: `4420d20` (Restore verified TaskDash 2.2 source and test suite). `git diff --check` passed; no tracked diff. An untracked `docs/review/2026-10-02/skills-coverage.md` appeared during concurrent work; this audit did not create or edit it.
- Fresh `npm test`: **89/89 tests, 11/11 files passed**, Node 22.23.1 / npm 10.9.8. Fresh `tsc --noEmit --skipLibCheck` passed.
- Production build success and byte parity are supplied baseline evidence, also recorded in `SOURCE_PROVENANCE.md`; not independently rebuilt here because the build overwrites `main.js` and `styles.css`. No install or vault access performed.
- Lockfile v3 root dependency declarations match package.json; `npm ls --depth=0` succeeds. Runtime packages: React/React DOM 18.3.1, react-markdown 10.1.0, remark-gfm 4.0.1. No confirmed runtime dependency alert.
- Fresh `npm audit --json`: exit 1, **8 affected packages: 1 critical, 2 high, 5 moderate** (package counts, not eight distinct exploits). Fresh `npm audit --omit=dev --json`: exit 0, **zero alerts**. Every affected lock entry is `dev: true`.

## Dependency findings and actual exposure

| Locked development dependency/path | Official advisory evidence and fix floor | TaskDash exposure |
| --- | --- | --- |
| happy-dom 15.11.7 | [VM escape](https://github.com/capricorn86/happy-dom/security/advisories/GHSA-37j7-fg3j-429f): fixed 20.0.0; [module compiler injection](https://github.com/capricorn86/happy-dom/security/advisories/GHSA-6q6h-j7hj-3r64): 20.8.8; [cookie disclosure](https://github.com/capricorn86/happy-dom/security/advisories/GHSA-w4gp-fjgq-3q4g): 20.8.9. Use at least 20.8.9 for these three. | Used by plugin integration tests. Untrusted script/module/HTML or credentialed fetch conditions matter; existing fake-vault fixtures do not establish exploitation. Highest-priority dev-tool update; major upgrade requires testing. |
| Direct esbuild 0.24.2 | [Development server CORS](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99), fixed 0.25.0. | `npm run dev` uses `context.watch()`, not `serve()`; the advisory's HTTP-server path is not configured. Build dependency hygiene, not demonstrated source disclosure. |
| vitest / @vitest/mocker 4.1.10 | [Redirect-mock file read](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), fixed 4.1.11. | Config uses Node and happy-dom, not browser mode/public mocker server. Alert concerns an accessible dev-server path; not demonstrated by `vitest run`. Update within current major. |
| vitest → Vite 8.1.3 → postcss 8.5.16 → nanoid 3.3.15 | PostCSS audit reports GHSA-r28c-9q8g-f849 and [GHSA-fxqj-rqcc-2cmp](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp); fix floor 8.5.23 covers both. Nanoid audit reports GHSA-28wg-ghj8-5hjv and [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8); 3.3.18 covers both. | Test-tool chain. Requires attacker-controlled source maps or generator sizes. Production CSS is concatenated by the build script; no PostCSS production pipeline identified. Compatible transitive lock refresh is preferable to new direct dependencies. |
| obsidian 1.13.1 → moment 2.29.4 | [Non-string locale path traversal](https://github.com/moment/moment/security/advisories/GHSA-4p3w-j4w9-5jqw), fixed 2.31.0. | Obsidian npm package supplies typings; `obsidian` is external in the plugin bundle. No application Moment import found. Obsidian itself is counted because it pins Moment. This audit does not evaluate the host application's dependencies. |

Do not apply npm's proposed Obsidian downgrade to 0.14.5 or blanket `npm audit fix --force`. That would trade away current API typings to satisfy a transitive alert. A separately reviewed Moment override, or documented time-bounded exception pending an upstream pin update, is narrower. Zero production audit alerts is dependency evidence, not proof of overall plugin security.

## Independently confirmed issue units (avoid duplicate chats)

All current-repo references below are relative to `/Users/ricardofilho/Documents/Projects/active/taskdash-2-2`. Upstream workflow references are relative to `/tmp/taskdash-source-review.RtoY4j`.

1. **TOOL-1 — Development dependency alerts.** One dependency-maintenance issue encompassing the table above; do not split propagated Obsidian/Moment or Vitest/mocker alerts into duplicates. Evidence: `package.json:27-34`, lock entries and fresh audits. Fix: targeted development-only updates, with explicit handling of the Moment pin. Acceptance: full suite/build and both audits; no runtime dependency changes.
2. **TOOL-2 — CI/release checks missing or disconnected.** Current workflows are absent. Recovered `.github/workflows/ci.yml:17-21` runs install/build/tests; `.github/workflows/release.yml:20-37` omits tests before publishing. Its equality guard at `release.yml:25-28` rejects the default `v` tag confirmed by `npm config get tag-version-prefix`; `package.json:11` and `version-bump.mjs:1-14` document/use npm's version lifecycle. Fix as one workflow issue: restore CI, gate release on tests/build, reconcile tag convention, validate version agreement. Acceptance: checks run on the actual commit; intended tags pass and incorrect tags fail without publishing. Workflow files alone do not prove any historical remote run.
3. **TOOL-3 — No regression coverage for shipped Close handlers.** Exact handlers: `src/app/App.jsx:4178` (recurring Archive series) and `:4184` (ordinary Close/Archive), calling `closeTask` at `:2477-2522`. Current native-view integration cases are `src/__tests__/pluginIntegration.test.jsx:172,222,260,332,376,408`; none clicks these controls and confirms persisted completion/archive. Fix: two behavior cases through the existing fake-vault/native-view seam, including confirmation and preservation of unrelated note content. Acceptance: both fail with the respective old event-as-ID handler restored, then pass with the shipped fixes; all 89 baseline tests still pass. This is a coverage gap, not a newly found Close defect.
4. **TOOL-4 — Main JSX lacks a correctness check.** `tsconfig.json:9-10,17` imports JS/JSX but disables `checkJs`; `package.json:7-12` has no lint/check script. Passing TypeScript checks do not validate App.jsx's body. Fix: a minimal JSX correctness lint check, wired into TOOL-2's CI; no broad TypeScript conversion. Acceptance: the check passes existing code or exposes specifically reviewed baseline failures and catches an intentional undefined JSX identifier in an isolated fixture. Do not claim it would necessarily catch the Close callback mistake.
5. **TOOL-5 — Ignored Vitest transform option.** `vitest.config.ts:5` sets esbuild JSX config; fresh tests explicitly warn that OXC overrides and ignores it. Fix: remove the stale option or configure the active transform only if needed. Acceptance: all tests pass without the warning. Keep this separate from audit-alert resolution unless one dependency update already resolves it.

## Explicit limitations and related decisions

- **Host minimum remains unverified, not a confirmed compatibility failure.** `manifest.json:5` and `versions.json` claim 1.5.0; typings resolve to 1.13.1 (`package.json:32`). `src/main.ts:104` awaits `revealLeaf`; its [official Promise/deferred-view contract](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts) is marked since 1.7.2. Older method existence and runtime behavior were not tested. Verify the promised floor in a disposable vault before retaining it or adopting a tested 1.7.2+ floor. No automatic bug chat for a proven 1.5.0 crash is justified.
- **Node baseline:** local 22.23.1 passes; locked Vite requires `^20.19.0 || >=22.12.0`. Generic Node 20 in the recovered workflows is not a demonstrated failure. Document/pin the chosen supported line as part of TOOL-2; no separate issue needed.
- No exploit reproduction, real-host smoke test, clean reinstall, remote CI run or release publication was performed. The existing source/artifact parity is proven baseline evidence; this audit does not invalidate it. Loose three-file release assets are valid; a ZIP is not a required tooling fix.

## Narrow fix brief (not implemented)

- Restore the CI checks with an explicit Node version; make release run the same tests/build before publishing. Resolve the `v` convention explicitly (e.g. normalize one leading `v`), and verify package/lock/manifest/current versions-map agreement and the exact three release assets.
- Update development tools in small reviewable steps: Vitest >=4.1.11 and compatible PostCSS/Nanoid lock refresh; happy-dom >=20.8.9; direct esbuild >=0.25.0. Preserve runtime dependencies. Review each build diff: an esbuild update can change bundle bytes without changing behavior, so previous byte parity must remain recorded as baseline rather than demanded from a new compiler.
- Resolve/document the dev-only Moment alert without downgrading Obsidian; decide and verify the host compatibility floor; add the two Close regression cases; address ignored transform config and minimal JSX linting. No unrelated refactor or setup flow.

## Acceptance commands and observations

Run these **later in an isolated fix checkout**, not against a real vault. `npm ci` and build intentionally change installed/generated files; they were not run by this audit.

```sh
node --version
npm ci
npm ls --depth=0
npm test
npm run build
npm audit --omit=dev --audit-level=low
npm audit --json
git diff --check
node --input-type=commonjs -e 'const p=require("./package.json"),l=require("./package-lock.json"),m=require("./manifest.json"),v=require("./versions.json"); if(p.version!==l.version || p.version!==l.packages[""].version || p.version!==m.version || v[m.version]!==m.minAppVersion) process.exit(1)'
node --input-type=commonjs -e 'const fs=require("fs"); for(const f of ["main.js","manifest.json","styles.css"]) if(!fs.statSync(f).size) process.exit(1)'
shasum -a 256 main.js manifest.json styles.css
```

Expected: all original 89 tests plus Close regression cases pass; no ignored JSX transform warning; production audit stays zero; full audit clears targeted alerts or reports only an explicitly justified Moment exception. Run the added lint command in CI. Exercise tag/version validation for both intended accepted and rejected tags without publishing a release. Observe a successful CI run on the actual fix commit, including release checks. Smoke-test startup, settings/folder suggestion, dashboard opening and task completion on the declared minimum Obsidian version using only a disposable vault; do not assert compatibility until observed. Preserve `data.json` and installed-vault artifacts throughout.
