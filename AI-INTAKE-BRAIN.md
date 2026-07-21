# AI Intake Brain / Orchestrator Brain

AI Code Factory v3.4 converts `ask` into an intelligent orchestration step.

The goal is not to send the user's sentence directly to Codex. The goal is:

```text
human ask
→ Orchestrator Brain understands intent
→ evaluates difficulty, scope, risk and missing info
→ decides workflow
→ writes auditable `.ai/` artifacts
→ prepares the next safe step
```

## What the Brain decides

The Brain can decide whether an ask is:

- a trivial/small change;
- a backend API feature;
- a frontend visual task that requires design-first;
- a fullstack slice;
- a bugfix or refactor;
- a research/docs task;
- a product epic that must be decomposed before implementation.

It also decides:

- `difficulty`: `trivial`, `simple`, `medium`, `complex`, `epic`;
- `scope`: `single_file`, `single_feature`, `multi_file`, `fullstack_slice`, `product_epic`;
- `risk`: `low`, `medium`, `high`, `critical`;
- whether to ask questions;
- whether design-first is required;
- whether decomposition is required;
- what tools/context are needed;
- what the next best action is;
- draft acceptance criteria;
- suggested child REQs for epic work.

## What the Brain is not allowed to do

The Brain makes orchestration decisions, but deterministic gates still own safety.

The Brain cannot:

- execute code;
- approve changes for the user;
- close a REQ;
- bypass locked constraints;
- delete or weaken locked constraints;
- invent real business/contact data;
- skip visual acceptance for public UI;
- touch files outside the approved contract;
- treat dry-run or missing executor as a real implementation.

## Configuration

The Brain is enabled by default in `hybrid` mode. That means:

- if `OPENAI_API_KEY` is present, `ask` uses the OpenAI provider;
- if no key is present, the model fails, JSON is invalid, or confidence is too low, the harness falls back to the deterministic intake engine.

### Option A — `.env` file

Create `.env` in the project root:

```env
OPENAI_API_KEY=sk-your-key-here
ACF_AI_INTAKE_MODEL=gpt-4.1
```

`.env` is ignored by git. Do not commit it.

### Option B — PowerShell session

```powershell
$env:OPENAI_API_KEY="sk-your-key-here"
npm run ai -- brain-status
```

### Option C — Persistent PowerShell variable

```powershell
setx OPENAI_API_KEY "sk-your-key-here"
# Close and reopen PowerShell after setx.
npm run ai -- brain-status
```

## Local config override

After `npm run ai -- init`, you can also create:

```text
.ai/config.local.json
```

Example:

```json
{
  "ai_intake": {
    "enabled": true,
    "mode": "hybrid",
    "provider": "openai",
    "model": "gpt-4.1",
    "api_key_env": "OPENAI_API_KEY",
    "confidence_threshold": 0.55,
    "timeout_ms": 60000
  }
}
```

`config.local.json` is meant for local overrides and secrets-related settings. Do not commit it.

## Generated artifacts

For every `ask`, v3.4 can write:

```text
.ai/reasoning/intake/REQ-XXX-intake-analysis.json
.ai/reasoning/questions/REQ-XXX-questions.md
.ai/reasoning/decisions/REQ-XXX-routing.md
.ai/reasoning/context-packs/REQ-XXX-context-pack.md
.ai/reasoning/brain/REQ-XXX-brain-summary.md
.ai/reasoning/brain/REQ-XXX-decision-log.md
.ai/reasoning/brain/REQ-XXX-brain-context.json
```

For product epics, it can also write:

```text
.ai/epics/EPIC-001.json
.ai/epics/EPIC-001-roadmap.md
.ai/epics/index.json
```

## Example

```powershell
npm run ai -- ask "Quiero una app tipo Vinted para tesis con usuarios, publicaciones, ofertas, chat y pagos simulados"
```

Expected behavior:

```text
AI Intake Brain
- source: ai
- work type: product_epic
- difficulty: epic
- scope: product_epic
- risk: high/critical
- requires decomposition: yes
- should implement now: no
- suggested REQs: scaffold, auth, listings, upload, catalog UI, offers, transactions, chat, reviews, e2e demo
- next action: answer critical questions / create epic roadmap
```

## Status command

```powershell
npm run ai -- brain-status
```

Shows:

- enabled/mode;
- provider/model;
- API key env var name;
- whether the key is present;
- config files used.

## Fallback mode

To force offline/fallback behavior:

```powershell
$env:ACF_AI_INTAKE_MODE="heuristic"
npm run ai -- ask "Crear endpoint GET /properties"
```

The fallback still detects work type, difficulty, scope, risk, visual-first, fake-data constraints, decomposition needs and common missing info.
