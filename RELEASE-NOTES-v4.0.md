# AI Code Factory v4.0.0 — Codex GPT Design Provider

## Why this version exists

v3.7.x introduced senior standards, autonomous loops, token-efficient Brain routing, and GPT Image API support. However, older successful versions generated high-quality visual designs without a local API key by using Codex as an executor-backed design provider.

v4.0 restores and productizes that architecture.

## Main change

`gpt-image` now defaults to a **Codex-backed design provider**:

```powershell
npm run ai -- design-provider set gpt-image
npm run ai -- design-generate
```

The harness asks Codex to act as a **design-only GPT/Image provider agent** and generate real design artifacts under `.ai/designs/generated`.

## Expected artifacts

- `.ai/designs/generated/REQ-001-option-a-desktop.png`
- `.ai/designs/generated/REQ-001-option-a-mobile.png`
- `.ai/designs/generated/REQ-001-option-b-desktop.png`
- `.ai/designs/generated/REQ-001-option-b-mobile.png`
- `.ai/designs/generated/REQ-001-option-c-desktop.png`
- `.ai/designs/generated/REQ-001-option-c-mobile.png`
- `.ai/designs/generated/REQ-001-contact-sheet.png`

If Codex cannot access image-generation tooling, the harness does **not** fake success. It writes provider logs and leaves the manifest as `prompt_pack_ready`.

## Provider modes

- `gpt-image` → Codex-backed GPT/image design provider, no API key required by the harness.
- `gpt-image-codex` → explicit alias for the same Codex provider.
- `gpt-image-api` → OpenAI Images API provider, requires `OPENAI_API_KEY` and API billing.
- `wireframe-mock` → local SVG fallback for testing the pipeline.
- `manual-import` → import external designs manually.

## Safety rules

The Codex design provider is design-only:

- It must not modify `src`, `app`, `pages`, `components`, tests, or project config.
- It should only write `.ai/designs/generated/**` and optional provider logs.
- Generated artifacts are verified before a design can be approved.
- Missing artifacts are never treated as success.

## Validation

- 53/53 tests passing.
- Syntax check OK across 78 JS files.
