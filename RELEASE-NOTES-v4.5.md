# Release Notes — v4.5.0 (Reliable Codex Design Pipeline)

This release fixes the core reason image/design generation with Codex was
unreliable, and hardens the whole design stage to production quality.

## The root problem

The default design provider (`gpt-image` → kind `gpt-image-codex`) asked the
Codex CLI to produce **high-fidelity PNG images**. Codex is a *code agent* — it
has no raster-image tooling, so it could never satisfy that request. Every run
ended in `prompt_pack_ready` with zero artifacts, and the design-first gate
then blocked the entire pipeline. That is the "renegar con la generación de
imágenes" you were hitting.

## What changed

### 1. HTML-first strategy (Codex does what it can actually do)
Codex is now asked for **self-contained HTML mockups** (inline CSS, no network,
no JS) — its real capability. The harness treats those HTML files as first-class
design artifacts.

### 2. HTML → PNG rasterization
When a Chromium-based browser (Chrome / Chromium / Edge) is available, the
harness screenshots each HTML mockup headlessly into the expected PNG path.
Detection is automatic and cross-platform (Windows / macOS / Linux), overridable
with `ACF_DESIGN_HTML_RENDERER`. If no browser is found, the HTML mockups remain
valid artifacts and the pipeline continues — it never dead-ends.

### 3. Artifact validation (no more fake "generated")
New `validateDesignArtifact` / `resolveOptionArtifact`:
- PNG: minimum size **and** valid PNG signature.
- HTML/SVG: minimum size **and** a real document check.
- Resolves alternate extensions, so a planned `.png` target is satisfied by the
  `.html` Codex actually wrote.
Empty or stub files can no longer pass as real designs or be approved.

### 4. Automatic, honest provider fallback
If the active provider yields no valid artifacts, the harness walks
`design.fallback_chain` (`gpt-image-codex → gpt-image-api → wireframe-mock`).
`gpt-image-api` is only used with `--confirm` **and** a present API key, so
billing is never spent silently. A `DESIGN_FALLBACK` event and a manifest note
record exactly what happened. Disable with `--no-fallback`.

### 5. `design-doctor` command
`npm run ai -- design-doctor` diagnoses the whole design stage — active provider,
Codex CLI presence, strategy, HTML renderer, API key, fallback chain — and
**predicts** what `design-generate` will do before you spend a run.

### 6. Quality-of-life
- `design-generate --all` generates every option in one pass; `--missing-only`
  now fills *all* missing options; `--continue` does one at a time.
- Fixed a `-C` argument edge case that could leave a stray positional arg in the
  Codex invocation.
- `.env.example` design section rewritten and de-duplicated (it previously set
  `ACF_DESIGN_PROVIDER` three times with conflicting values).

## Recommended flow

```powershell
npm run ai -- design-doctor          # verify the pipeline first
npm run ai -- ask "Quiero una landing para ... con hero, servicios y antes/después"
npm run ai -- design-brief
npm run ai -- design-generate --all  # Codex writes HTML, harness rasterizes to PNG
npm run ai -- design-preview
npm run ai -- design-approve option-a
```

## Compatibility / migration
- No breaking config changes. Existing `.ai/config.json` keeps working; new
  design keys fall back to safe defaults.
- For PNG output, install any Chromium-based browser. Without one, you still get
  valid HTML mockups.
- Tests: 63 passing (56 prior + 7 new for the v4.5 design pipeline).
