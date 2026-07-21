# AI Code Factory v3.7.1 — Token Efficient Brain Router

## Why this release exists

v3.7.0 introduced senior creative/backend/autonomous capabilities, but the Brain could still build a very large one-shot prompt. On Windows + Claude Code this could fail with `The command line is too long`, and even when it worked it was token-inefficient.

v3.7.1 changes the Brain architecture from **megaprompt** to **routed multi-step context**.

## Core changes

### 1) Token-efficient Context Router
- Adds `src/engines/context-router.js`.
- Chooses only the summaries relevant to the request type:
  - frontend visual: project + product + design + frontend summaries
  - backend API: project + backend + security + testing summaries
  - fullstack/epic: balanced frontend/backend/security/testing summaries
- Writes a context route artifact:
  - `.ai/reasoning/brain/REQ-XXX-context-route.json`

### 2) Context Cache
- Adds `src/engines/context-cache.js`.
- Creates small summaries under:
  - `.ai/context-cache/project-summary.md`
  - `.ai/context-cache/frontend-summary.md`
  - `.ai/context-cache/backend-summary.md`
  - `.ai/context-cache/security-summary.md`
  - `.ai/context-cache/testing-summary.md`
  - `.ai/context-cache/design-summary.md`
  - `.ai/context-cache/product-summary.md`
- The Brain receives summaries, not full standards/history.

### 3) Stage Trace
- Adds per-request stage traces:
  - `.ai/reasoning/brain/REQ-XXX-stage-trace.json`
- Tracks:
  - local triage
  - context selection
  - specialist Brain stage
  - estimated prompt chars
  - fallback reason if any

### 4) Claude prompt transport fix
- Claude Code no longer falls back to putting long prompts into argv.
- Long prompts use stdin/file-backed stdin transport.
- This prevents the Windows `command line is too long` failure caused by arg-mode fallback.

### 5) Tests
- Added token-efficient Brain tests:
  - frontend asks select frontend/design summaries only
  - long prompts are not sent through argv
  - stage trace is written

## Validation

- `npm test`: 53/53 passing
- `npm run lint`: Syntax OK

## Recommended env

```env
ACF_AI_INTAKE_PROVIDER=claude-code
ACF_AI_INTAKE_MODE=hybrid
ACF_AI_INTAKE_FALLBACK_CHAIN=claude-code,heuristic
ACF_CLAUDE_CODE_COMMAND=C:\Users\fasol\AppData\Roaming\npm\claude.cmd
ACF_CLAUDE_CODE_ARGS=-p
ACF_CLAUDE_CODE_PROMPT_MODE=stdin
ACF_BRAIN_EXTERNAL_MIN_DIFFICULTY=medium
ACF_BRAIN_DEPTH=auto
```

The default architecture now avoids sending whole project standards or full history to the Brain.
