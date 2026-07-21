# Changelog

## v5.4.0 — Senior Model Selection: the orchestrator picks who thinks, and how hard

Token autonomy through judgment, not static config.

### Model cascade with senior defaults (active out of the box)
`tier_models` now defaults to version-proof aliases: fast→haiku, standard/deep→sonnet, architect→opus. Cheap thinks the cheap without any setup. Opt-out per tier or globally with `"cli"`.

### Confidence-driven escalation (the real LLM-cascade pattern)
The routed (cheap) tier answers first. The brain escalates ONE step up the ladder when:
- the cheap tier **fails** (parse/schema/confidence floor) — before ever falling back to heuristics;
- confidence < `min_confidence` (default 0.75) — the senior double-checks, and its answer wins only if at least as confident;
- **high risk flagged from a low tier** — risky decisions deserve a stronger thinker.

Escalation is recorded (`brain.escalation`: from/to, models, confidences, reason), surfaces in the `ask` output ("Brain: ai · model: haiku · escalated standard→deep (confidence 0.6 < 0.75)"), and both attempts count against the per-REQ budget — the circuit breaker still rules.

### Orchestrator-decided executor reasoning effort
The brain's own classification now sets Codex's `model_reasoning_effort` per REQ: trivial/simple+low-risk → `low`, high-risk/complex → `high`, else `medium`. This is the intelligent fix for the live `xhigh`-on-a-contact-form timeout. Explicit user flags always win; `execution.adaptive_reasoning: false` disables.

Suite: 169/169 (6 new, including stateful-mock escalation e2e and cost-discipline no-escalation guard).



## v5.3.1 — Contract consistency (the executor obeyed a contradiction)

Live forensics: after `override-workflow` to direct-patch, the executor contract still contained the pre-override rule "do not implement frontend visual work without approved design" (in Forbidden) plus "No approved design yet... do not implement visual UI until approved" — alongside "Implement now: yes". Codex read the contradiction and (correctly) refused: exit 0, zero files, honest-success guard tripped. The system's guards worked; the contract was the bug.

- The contract now reflects the CURRENT decision, not the decision history: with design-first OFF, the stale design rule is filtered from Forbidden and the Approved Design Policy states "Design-first is NOT required for this REQ".
- With design-first ON, both remain intact (regression-tested in both directions).
- TROUBLESHOOTING: documented Codex `reasoning effort: xhigh` as a timeout amplifier for scoped executor tasks.

Suite: 163/163.


## v5.3.0 — Clarity OS: the 4-verb flow, the guide, and real documentation

The "make it obvious" release. A tool is simple when it always tells you the next step.

### The 4-verb daily flow
`start` (ask) → `continue` (cycle) → `review` (decision packet) → `accept` (visual-accept + merge, one verb). Every specialized command remains available by name; the verbs cover the daily 90%.

### `acf` with no command = the guide
Reads the REAL state of the active REQ (intake, execution, gates, visual, approvals) and prints where you are plus the exact next command — including context-aware advice (e.g. executor timeout → "close other Codex sessions first — parallel sessions throttle your account"). Zero tokens, instant. Guide states covered by regression tests: idle, backlog waiting, needs answers, design pending (pre-execution only), ready, execution failed/timeout, awaiting visual, awaiting approval, blocked, done.

### `acf review [REQ]` — the human decision packet
Intent, type/risk/workflow, branch, real `git diff --stat` vs base, files touched, quality signals (execution/validation/acceptance/deterministic gates), close blockers, token cost, and the exact merge command. Everything needed to decide "merge or not" in one view.

### Documentation rewritten from live experience
- **QUICKSTART.md** — setup in 2 min, the 4-verb flow, the guardrails explained.
- **TROUBLESHOOTING.md** — every entry born from a real failure hit during live Windows testing (`.cmd` shims, executor timeouts from parallel Codex sessions, design-first blocks, stale acceptance, honest-success guard) with the proven fix.
- **CONFIG.md** — complete reference for every config key across v5.x (brain, cascade, budgets, executor, git workflow, deterministic gates, hooks, prompt budget).
- **README.md** — rewritten front door pointing at all of it.
- `setup` now ends by teaching the 4-verb flow.

Suite: 162/162 (6 new guide/review regressions, including a state-ordering fix found while testing: design-pending no longer shadows the visual gate after an override-executed run).

## v5.2.1 — Audit hardening (full-pipeline E2E verified live)

A complete lifecycle was executed live during the audit — setup → ask → cycle → validate → gates → **merge to main** — plus resume and hook-interaction scenarios. Findings fixed:

- **`pre_execute` hook no longer fires on resumed cycles.** It gates actual execution; a resume (nothing to run) proceeded even with a blocking hook present, while `--force-execute` correctly gets blocked. Verified live in both directions.
- **`hooks init`** scaffolds `.ai/hooks/` with a commented, working example (`pre_merge.example.js`: block high-risk merges after hours / npm audit gate). Rename to activate.
- **`.ai/progress/` added to git-policy runtime ignores** — it changes on every stage; the evidence pack remains the versioned audit artifact.
- **`playbooks match` (CLI) no longer inflates the `uses` counter** — consulting is not using; only real context injection counts.
- Confirmed (already native, now documented): `git_workflow.delete_branch_after_merge: true` removes the REQ branch post-merge; default keeps it for auditability.

Suite: 156/156, including a new resume-immunity regression.

## v5.2.0 — Resilience & Observability OS

Four upgrades selected from a survey of 2026 state-of-the-art harness engineering (Anthropic long-running-agent research, Claude Code hooks/dynamic-workflows patterns, harness-engineering literature). Chosen for value-per-complexity; the rest of the survey (harness mutation testing, harnessability score, self-improving rules, subagent isolation) stays on the v5.3 radar pending real usage data.

### 1. Progress file (`npm run ai -- progress [REQ]`)
Every cycle stage appends to `.ai/progress/REQ-XXX.md` — branch created, files touched, validation result, blockers. The file is embedded in the executor contract with a "DO NOT redo completed stages" header, so a Codex run resuming after a timeout knows the state of work instead of starting from zero. This is Anthropic's key pattern for agents that work across many sessions, and directly addresses the executor-timeout scenario from live testing.

### 2. Lifecycle hooks (`npm run ai -- hooks`)
Claude Code-style deterministic enforcement: drop a script in `.ai/hooks/{pre_execute,post_execute,post_validate,pre_merge}.js` (or configure `config.hooks`). Payload arrives as JSON on stdin and in `ACF_HOOK_PAYLOAD`. `pre_*` hooks with non-zero exit BLOCK the stage (stderr becomes the reason); `post_*` hooks never block. Absence = silent no-op. Zero tokens, user-owned rules — the hook enforces what a prompt can only suggest.

### 3. Draft-commit for high-risk work
The REQ branch is the draft; the merge is the commit. `risk: high` work that passes all gates still stops before merge until a human reviews the diff and re-runs `cycle --approved`. Validated code is not the same as approved code when payments/auth/data are involved.

### 4. Stats (`npm run ai -- stats`)
Observability as queryable data: REQ completion rate, top close-blocking gates, token spend by pipeline stage, activity by event type. Built on the existing NDJSON event log — the view that turns evidence from audit trail into improvement system.

Suite: 156/156 (6 new).

## v5.1.4 — Override-workflow clears design-first gate

- `override-workflow REQ-XXX direct-patch-with-validation` now clears `design_first_required` in the intake, so cycle proceeds without demanding an approved design. Previously the workflow field changed but the gate kept reading the original flag — cycle was stuck in a loop.

## v5.1.3 — Brain-First Guard + Live-Run Fixes

Four issues from the first `setup → ask → cycle` run on a fresh project:

- **Cycle now respects `needs_input`.** The brain asked a blocking question ("form submission behavior?") and cycle implemented anyway — exactly the prompt-coding this harness exists to prevent. Cycle now stops with the question(s) and points to `npm run ai -- answer REQ-XXX "..."`; answers are injected into the executor contract and unblock the run.
- **`[object Object]` in gate output fixed at the root.** Brains sometimes return `{question, why}` objects inside missing-info arrays; schema normalization now extracts the meaningful field.
- **Executor failures point at the log.** Timeout failures explain the limit (`execution.timeout_ms`, default 900000ms) and how to raise it or slice the REQ; every failure message includes the exact execution log path.
- **`state_integrity` false positive removed.** A fresh project with an empty backlog has no active request by design; only a dangling pointer (backlog without active request) is flagged now.

Suite: 150/150 (3 new guard regressions).

## v5.1.2 — Cycle Resumability + Fresh Acceptance (from the first fully-live run)

The first end-to-end live run (brain + codex + branch + validate, all green) surfaced two workflow bugs:

- **`cycle` is now resumable.** Re-running cycle on a REQ whose execution already succeeded re-invoked Codex on finished work; Codex changed nothing and the honest-success guard (correctly) stopped everything. Cycle now detects a prior successful execution with files touched, records `resumed_previous_success`, and continues from validation → gates → merge. `--force-execute` re-runs implementation on purpose.
- **`visual-accept` re-evaluates acceptance criteria.** Acceptance persisted during cycle predates the visual acceptance, so visual-dependent criteria were evaluated as failed and `gate-check` kept reading that stale snapshot ("14/17 passed" after accepting). Acceptance is refreshed the moment visual acceptance is recorded.

Regression coverage: the e2e cycle test now re-runs the cycle and asserts resume semantics. Suite: 147/147.

## v5.1.1 — Post-live-run polish

The first fully successful live run (brain → branch → codex → validate → gates, all green on Windows) surfaced three small items:

- **Setup e2e test fixed for Windows**: `URL.pathname` yields `/C:/...` which node reads as `C:\C:\...`; now uses `fileURLToPath`. (146/147 → 147/147 on Windows.)
- **Cost report counts cached input tokens**: the Claude Code envelope splits `input_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`; only the non-cached slice was summed ("2 in / 2951 out"). Now totals all three.
- **Branch slugs deaccent**: `acf/req-004-agreg-una-secci-n-...` → `acf/req-004-agrega-una-seccion-...`.

## v5.1.0 — Windows Runtime Hardening + Adaptive Setup

The release that closes every issue found in live Windows testing, plus one-command onboarding.

### Fixed (from the live `ask` run on v5.0.2)
- **`spawnSync claude ENOENT`, root cause #2.** `where claude` returns MULTIPLE matches and the extensionless sh shim lists FIRST; v5.0.2 took the first line and never saw `claude.cmd`. The resolver now scans all candidates, prefers `.cmd`/`.bat` (routed through the safe cmd.exe wrapper), and respects PATH order when a native `.exe` comes earlier. Covers npm-shim installs, native installs and mixed PATHs — zero config.
- **`init` now actually fixes version drift.** The doctor tells users to run `init` when `.ai/config.json` version differs from the code — but init never re-stamped it. It now migrates the version field on existing configs (user settings preserved, `previous_version` recorded). `DEFAULT_CONFIG.version` also derives from package.json now.
- **Spanish word order broke `small_change` detection.** "Agregá una **sección de contacto simple** en la home" classified as `frontend_visual` + design-first (demanding logo/brand assets for a trivial section). The pattern now tolerates noun complements ("sección … simple", "formulario … simple"). The exact real-world ask is captured as golden-006 so it can never regress silently.
- **`deterministic-gates` no longer uses `shell:true` on Windows.** Routed through `spawnSyncPortable` like the rest of the codebase (also fixes semgrep/ast-grep `.cmd` entrypoints).

### Added
- **`npm run ai -- setup`** — one-command onboarding that adapts: detects NEW vs EXISTING project and runs init → project-bootstrap → repo-map (skipped when no source yet) → agents-md sync → git-policy apply → golden-set seed, with a next-steps summary. One harness, both worlds.

### Tests
147/147 (8 new): multi-candidate `where` regression (extensionless-first), PATH-order exe-vs-cmd, setup end-to-end on a real repo, golden-006, version single-sourcing.

## v5.0.2 — Windows Runtime: dynamic .cmd shim resolution + version single-sourcing

Fixes from the first live `ask` on Windows (v5.0.1):

- **`spawnSync claude ENOENT` fixed at the root.** npm-installed CLIs on Windows are `.cmd` shims that `CreateProcess` cannot spawn with `shell:false`. v4.7 fixed this for npm/npx/yarn/pnpm via a static map; v5.0.2 generalizes it: any bare command not in the map is resolved through `where` (cached, once per name). A `.cmd`/`.bat` match routes through the existing safe cmd.exe wrapper; `.exe` (native installs) keeps direct spawn. Both Claude install styles now work with zero config, and the same applies to codex or any future CLI.
- **Version single-sourced from package.json.** `VERSION` was hardcoded ('4.7.1') in src/defaults.js, so the doctor announced the wrong version and `config_version` could never drift-check honestly. All banners (init/status/help/doctor) now derive from package.json.
- 6 new regression tests (shim routing, native-exe passthrough, honest ENOENT, where-cache, static-map fast path, version single-source). Suite: 145/145.

Note for existing sandboxes: re-run `npm run ai -- init` once so the project config version is re-stamped by the new code.

## v5.0.1 — Windows Test Reliability (hotfix)

Fixes from the first full `npm test` run on a real Windows machine (135/139 → 139/139 expected):

- **`commandExists` now handles absolute paths.** Windows `where` fails on fully-qualified paths (e.g. `C:\Program Files\nodejs\node.exe`), which made the design engine report an existing executable as missing and fall back to `prompt_pack_ready`. Paths with separators are now checked via the filesystem directly. Fixes `design-codex-html-v45` and `senior-autonomous-os` failures.
- **Test isolation: unit tests can no longer reach a real installed `codex`.** `approve rejects options without real artifacts` ran the real codex CLI for ~300s on machines where codex is installed (burning wall time and plan tokens). The test now pins a guaranteed-missing design command.
- **ESM file URLs on Windows.** The concurrent-ID test imported `src/core/state.js` by raw absolute path inside child processes, throwing `ERR_UNSUPPORTED_ESM_URL_SCHEME` on Windows. Now uses `pathToFileURL()`.
- **All bash test mocks replaced with Node mocks** (`feature-proposer`, `brain-first-cycle`, `prompt-budget`). Bash mocks cannot spawn on Windows (or spawn non-deterministically via WSL association), masking real assertions.

No production-code behavior changes except the `commandExists` path fix, which also benefits real usage (custom absolute-path commands in config now resolve correctly on Windows).

## v5.0.0 — Reliable Brain, Token Economy & Deterministic Quality OS

- Brain: `--output-format json` envelope by default, semantic strict retry, full raw traces per attempt in `.ai/reasoning/brain/raw/REQ-xxx/`.
- Token economy: model cascade (`brain_routing.tier_models`), per-REQ hard budget + brain-call circuit breaker, `repo-map` signature skeleton injected into context packs, `cost-report` per REQ/stage.
- Deterministic quality: `det-gates` (migration gate, executable standards rules in `.ai/standards/rules.json`, optional semgrep/ast-grep) scoped to the REQ diff and integrated into `gate-check` as `deterministic_quality`.
- Diff-scoped senior reviews (backend/security/frontend review the change, not the repo).
- Playbooks: graduate proven plans from closed REQs, Spanish/English morphology-tolerant matching, automatic injection into brain context.
- `agents-md sync` (AGENTS.md/CLAUDE.md with managed blocks), `brain-eval` golden-set regression for the harness intelligence, `git-policy apply` hybrid .ai versioning.
- Heuristics: refunds classify as high risk; "flujo completo" signals fullstack.
- 139 tests green (19 new). No breaking changes.


## v4.7.0 — Windows Reliability & Git Branch Workflow

- Fixed Windows validation runner by normalizing npm/npx/yarn/pnpm to .cmd shims under shell:false.
- Added portable runner regression tests and validation runner smoke coverage.
- Added project-bootstrap for new projects to add validation scripts and git baseline.
- Added request branch workflow: each implementing REQ runs on acf/req-* branch and merges back after gates pass.
- Added Codex --skip-git-repo-check for automated local executor runs.

# Changelog

All notable changes to AI Code Factory. This file is the single source of
truth for release history; the per-version `RELEASE-NOTES-*.md` files are kept
for historical detail but new entries go here.

The version of record lives in `src/defaults.js` (`VERSION`) and is mirrored in
`package.json` and the seeded `.ai/config.json`. `acf doctor` reports drift.

## [4.6.0] — Production Hardening + Brain-First Autonomy

### Added
- **Brain-first routing** — Claude is the thinking brain on every non-trivial
  ask (threshold lowered to `simple`). The heuristic is a true last-resort
  fallback: when Claude is unavailable, implementing work is **held** (visible
  `BRAIN DEGRADED` warning + a `brain_quality` gate that blocks), never silently
  green-lit.
- **`cycle`** — full engineering cycle in one command: plan -> execute (Codex) ->
  validate -> acceptance -> self-review -> gates -> bounded auto-iterate ->
  evidence -> learn -> close. Stops at the first safety gate (degraded brain,
  design-first, human approval, epic, no-op executor); never fakes progress.
- **Brain-powered `propose-features`** — scans the real codebase (stack, test
  ratio, large files, `any` usage, missing scripts, CI/ESLint, TODOs) and the
  brain proposes prioritized, evidence-cited features and weakness fixes. Falls
  back to deterministic, evidence-based proposals when the brain is down.
  `create-req-from-proposal` now runs the proposal through the full brain pipeline.
- **Prompt-budget discipline** (`src/core/prompt-budget.js`) — fixes the
  "prompt too long" failures that broke Codex/Claude. The executor passes a
  short, file-referencing instruction (<=7 KB argv) instead of inlining the whole
  contract; the contract embeds a bounded context pack; brain prompts are
  hard-capped at 60 KB regardless of config. Verified: a 132 KB context yields a
  758-char argv instruction.
- **`acf doctor`** — global health: brain, design, state, executor, MCP,
  version/config drift, and prompt-budget safety. Exits non-zero on attention.
- **State lock** (`src/core/lock.js`, atomic, dependency-free) — no duplicate
  `REQ-XXX` IDs under concurrency.
- **Honest-success guard** — exit-0-but-no-files is `no_op`, not success.
- **CI** (Ubuntu/Windows x Node 20/22) and a consolidated `CHANGELOG.md`.

### Changed
- Classifier criterion fixed: payment/integration work -> `backend_api`/high risk
  (was `general`); a backend endpoint mentioning "usuarios" stays `backend_api`
  (was inflated to `fullstack`). Route/intake difficulty thresholds aligned.
- LLM JSON parser tolerates trailing commas, fences, smart quotes, and prose.
- `doctor` now points at the global system doctor; the state checker keeps its
  explicit `state-doctor` command.
- Tests: 56 -> 113.

## [4.5.0] — Reliable Codex Design Pipeline

### Fixed
- **Root cause of unreliable image/design generation:** the default provider
  asked the Codex CLI for raster PNGs, which a code agent cannot produce, so
  every run dead-ended at `prompt_pack_ready` and blocked the design-first gate.

### Added
- **HTML-first strategy** — Codex now produces self-contained HTML mockups (its
  real capability); the harness rasterizes them to PNG via a local headless
  browser (Chrome/Chromium/Edge), auto-detected cross-platform.
- **Artifact validation** — size + signature/document checks; empty or stub
  files can no longer pass as real designs or be approved. Planned `.png`
  targets are satisfied by the `.html` Codex actually wrote.
- **Automatic, honest provider fallback** — `gpt-image-codex → gpt-image-api
  (only with --confirm + key) → wireframe-mock`, with a `DESIGN_FALLBACK` event.
- **`design-doctor`** plus `design-generate --all | --missing-only | --no-fallback`.

### Changed
- `.env.example` design section rewritten and de-duplicated (it previously set
  `ACF_DESIGN_PROVIDER` three times). Versions unified to 4.5.0.

## [4.1.1] — Production Interaction & Recovery
Production interaction patterns and recovery flows for the executor.

## [4.0.0] — Codex GPT Design Provider
Introduced the Codex-backed design provider (superseded by the v4.5 html-first
pipeline above).

## [3.7.1] — Token-Efficient Brain Router
Context routed by work type with summaries under `.ai/context-cache`.

## [3.7.0] — Senior Autonomous Product Engineering OS
Senior review engines (frontend/backend/product/security/architecture) and the
autonomous product loop.

## [3.6.0] — Connected MCP Suite
MCP registry, tool routing and capability tracking.

## [3.5.1] — Windows CLI Fix
Windows/PowerShell-safe command execution (`spawn` without `shell:true`,
`.cmd`/`.bat` handling).

## [3.5.0] — Multi-Brain Adaptive Edition
Claude Code as primary Orchestrator Brain, adaptive routing by
difficulty/depth/strategy, `ask-preview`, `brain-doctor`, provider traces.

## [3.4.1] — Orchestrator Brain Hardening
Hardening layer over the v3.4 Orchestrator Brain.

## [3.4.0] — Orchestrator Brain
AI Intake Brain: intent/difficulty/scope/risk understanding before code.
