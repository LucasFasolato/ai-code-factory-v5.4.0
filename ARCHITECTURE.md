# AI Code Factory v3.5.0 — Multi-Brain Adaptive Edition

This build adds Claude Code as the primary Orchestrator Brain provider, adaptive Brain routing by difficulty/depth/strategy, `ask-preview`, `brain-doctor`, `next-step`, provider traces and Brain context sanitization.

Recommended flow:

```powershell
npm run ai -- brain-doctor
npm run ai -- ask-preview "Quiero una app tipo Vinted para tesis con usuarios, publicaciones, ofertas, chat y pagos simulados"
npm run ai -- ask "..."
npm run ai -- next-step
```

See `MULTI-BRAIN-v3.5.md` and `RELEASE-NOTES-v3.5.md`.

---

# Architecture — AI Code Factory v3.4.1

AI Code Factory is a local-first Product Engineering OS. The CLI is intentionally simple, while the internal system behaves like a product/tech/design/QA orchestrator.

## v3.4 headline

v3.4 introduces the **Orchestrator Brain**, starting with the **AI Intake Brain**.

The `ask` command is now an intelligent orchestration step:

```text
User ask
→ Project context loader
→ Heuristic pre-analysis
→ AI Intake Brain provider when configured
→ strict intake schema validation
→ deterministic safety merge
→ artifact writer
→ workflow router
→ context pack / contract / gates
```

## Main layers

```text
CLI
  src/cli.js

Core
  src/core/fs.js
  src/core/paths.js
  src/core/state.js
  src/core/events.js
  src/core/command-runner.js

Brain / Intake
  src/engines/intake-engine.js           # deterministic pre-analysis + fallback
  src/engines/ai-intake-brain.js         # context collection + orchestration brain
  src/engines/ai-intake-provider.js      # OpenAI provider via Responses API
  src/engines/intake-schema.js           # strict schema + validation
  src/engines/epic-decomposer.js         # product epic roadmap artifacts

Planning / Contracts
  src/engines/question-engine.js
  src/engines/spec-improver.js
  src/engines/workflow-router.js
  src/engines/judgment-engine.js
  src/engines/risk-engine.js
  src/engines/impact-engine.js
  src/engines/context-pack-engine.js
  src/engines/execution-contract-engine.js

Execution / Validation
  src/engines/executor-orchestrator.js
  src/engines/gate-engine.js
  src/engines/scope-gate-engine.js
  src/engines/acceptance-evaluator.js
  src/engines/evidence-pack-engine.js

Design / Visual
  src/engines/design-engine.js
  src/engines/visual-engine.js
  src/engines/fake-data-scanner.js

Evolution / Memory
  src/engines/history-engine.js
  src/engines/feedback-engine.js
  src/engines/memory-compiler.js
  src/engines/learning-engine.js
  src/engines/playbook-evolution.js
  src/engines/skill-pattern-engine.js
```

## AI Intake Brain contract

The Brain returns a structured decision, not free text. The schema lives in:

```text
src/engines/intake-schema.js
```

Important fields:

```json
{
  "intent": "...",
  "project_type": "next-nest-fullstack",
  "work_type": "product_epic",
  "difficulty": "epic",
  "scope": "product_epic",
  "risk": "high",
  "confidence": 0.88,
  "should_implement_now": false,
  "requires_questions": true,
  "requires_decomposition": true,
  "design_first_required": true,
  "requires_human_approval": true,
  "tools_needed": [],
  "questions": [],
  "decisions": [],
  "suggested_reqs": [],
  "acceptance_criteria_draft": [],
  "next_best_action": "..."
}
```

## Hybrid mode

The default mode is `hybrid`:

1. deterministic intake runs first;
2. if AI provider is configured, the Brain gets ask + project context;
3. the provider must return schema-valid JSON;
4. low-confidence/invalid/failing model output falls back to deterministic intake;
5. deterministic hard rules are merged back into the result.

This keeps the harness useful offline and safe online.

## Hard-rule merge

Even when the AI makes the orchestration decision, deterministic rules still enforce:

- no implementation of frontend visual work without approved design;
- no closing visual UI without visual acceptance;
- no invented business/contact data;
- no direct implementation of product epics;
- no closure when executor did not succeed;
- no closing when files touched exceed allowed scope;
- locked constraints are always injected into context/contract.

## Context pack

`src/engines/context-pack-engine.js` writes:

```text
.ai/reasoning/context-packs/REQ-XXX-context-pack.md
```

It includes:

- original ask;
- Orchestrator Brain decision;
- user answers/clarifications;
- improved spec;
- suggested roadmap;
- project DNA;
- learned rules;
- compiled memory;
- design/engineering taste;
- locked constraints;
- approved design when relevant;
- allowed files strategy;
- validation requirements.

## Execution contract

`src/engines/execution-contract-engine.js` writes:

```text
.ai/execution/contracts/REQ-XXX-execution-contract.md
```

This contract is the source of truth for Codex/Claude. It includes hard constraints, allowed files, forbidden actions, expected output and validation commands.

## Gates

`src/engines/gate-engine.js` evaluates close blockers.

v3.4 hardens:

- executor gate: only `success` can close implementation work;
- scope gate: touched files must match allowed contract;
- product epic gate: no direct implementation of huge asks;
- visual gate: public UI requires approved design + visual acceptance;
- fake-data gate: blocks invented real-world data.

## Event sourcing

Events are appended to:

```text
.ai/events/events.ndjson
.ai/history/timeline.ndjson
```

`state-doctor` cross-checks event log, state, backlog and execution artifacts.

## Provider config

Default config is in `src/defaults.js` under `ai_intake`.

Local overrides:

```text
.env
.ai/config.local.json
```

Never commit secrets.
