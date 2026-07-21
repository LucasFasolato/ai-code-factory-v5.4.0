# AI Code Factory v3.5.0 — Multi-Brain Adaptive Edition

## Main change

The `ask` command now uses an adaptive Orchestrator Brain route:

- `trivial/simple` asks use the local heuristic brain by default to avoid unnecessary external model usage.
- `medium/complex/epic` asks use Claude Code CLI as the primary Brain provider.
- Optional fallback chain: Claude Code → OpenAI API → heuristic.
- The executor remains Codex CLI with ChatGPT/Codex auth, with API env keys stripped from child executor processes.

## New capabilities

- Claude Code Brain provider (`ACF_AI_INTAKE_PROVIDER=claude-code`).
- Adaptive routing by difficulty, risk, depth and reasoning strategy.
- Brain depths: `fast`, `standard`, `deep`, `architect`.
- Reasoning strategies: `direct`, `deliberate`, `tree`.
- `ask-preview` / `brain-route` command to inspect routing without writing artifacts.
- `brain-doctor` command to inspect configured providers and fallback readiness.
- `next-step` command to show the next recommended command for the active REQ.
- Brain context sanitizer that redacts secrets and sends summaries, not `.env`, secrets or full source files.
- Provider trace artifact: `.ai/reasoning/brain/REQ-XXX-provider-trace.json`.
- JSON extraction for provider outputs that wrap JSON with prose or markdown.

## Consumption control

- Simple asks skip Claude/OpenAI by default.
- Brain context size is adapted by depth.
- OpenAI API fallback remains guarded by the monthly budget ledger.
- Claude Code provider records estimated tokens with `$0` API cost because it uses CLI subscription flow rather than OpenAI API billing.

## Tests

- 42/42 tests passing.
- Added regression coverage for adaptive routing, Claude Code provider JSON parsing, API env stripping, JSON extraction, and context sanitization.
