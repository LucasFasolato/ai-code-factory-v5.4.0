# Executor Contract — REQ-001

## Goal

Fix the AI Intake Brain so project_type aliases (e.g. node-typescript-cli, typescript-cli, node-cli, cli-tool) are normalized to the closed enum value internal-tool before schema validation, preventing false heuristic-fallback / BRAIN DEGRADED / misclassification as fullstack_feature.

## Orchestrator Decision

- Work type: bugfix
- Difficulty: medium
- Scope: multi_file
- Risk: high
- Workflow: diagnose-fix-validate
- Implement now: no
- Requires decomposition: no

## Source of Truth

- Context Pack
- Improved Spec
- User Answers / Clarifications inside context pack

## Approved Design Policy

Design-first is NOT required for this REQ (direct-patch workflow). Implement following the project conventions and the visual direction stated in User Answers.

## Allowed Files

- src/engines/intake-schema.js
- tests/orchestrator-brain.test.js

## Allowed Files Strategy

Exact files explicitly approved after implementation review.

## Forbidden

- do not invent phone numbers
- do not invent emails
- do not invent addresses
- do not invent social links
- do not invent metrics, clients, years of experience or legal claims
- do not close without evidence
- do not bypass deterministic gates
- do not modify or widen the PROJECT_TYPES enum itself
- do not change unrelated classifications, contracts, or workflows
- do not silently swallow genuinely invalid project_type values â€” normalization only applies to the specified known aliases
- do not bypass deterministic gates or remove the heuristic-fallback safety net for truly unmapped values
- do not invent phone numbers, emails, addresses, social links, metrics, clients, years of experience or legal claims

## Locked Constraints (non-negotiable)

- none

## Required Commands

- npm run lint
- npm run typecheck
- npm test
- npm run build

## Context Pack

# Context Pack — REQ-001

## User Intent

Fix the AI Intake Brain so project_type aliases (e.g. node-typescript-cli, typescript-cli, node-cli, cli-tool) are normalized to the closed enum value internal-tool before schema validation, preventing false heuristic-fallback / BRAIN DEGRADED / misclassification as fullstack_feature.

## Orchestrator Brain

# Orchestrator Brain Summary — REQ-001

Generated at: 2026-07-21T23:37:39.775Z

Source: ai
Provider: claude-code
Model: sonnet

## Token-efficient Brain Router

- Mode: multi-step routed context
- Selected context: project-summary.md, testing-summary.md, backend-summary.md, frontend-summary.md
- Estimated routed context chars: 7017

## Adaptive route

- Provider route: claude-code → openai → heuristic
- Depth: deep
- Strategy: deliberate
- Routing reason: Difficulty medium and risk high justify external Brain provider claude-code.
- External Brain used: yes

## Decision

- Intent: Fix the AI Intake Brain so project_type aliases (e.g. node-typescript-cli, typescript-cli, node-cli, cli-tool) are normalized to the closed enum value internal-tool before schema validation, preventing false heuristic-fallback / BRAIN DEGRADED / misclassification as fullstack_feature.
- Work type: bugfix
- Difficulty: medium
- Scope: multi_file
- Risk: high
- Workflow: diagnose-fix-validate
- Implement now: no
- Decompose: no

## Brain summary

Real bug in AI Intake Brain: unknown project_type aliases (e.g. node-typescript-cli) hit the closed enum with no normalization, causing false heuristic-fallback, BRAIN DEGRADED, and misclassification. Fix: add an alias-normalization step before enum validation mapping node-typescript-cli/typescript-cli/node-cli/cli-tool to internal-tool, keep the enum closed, add a regression test, and verify no fallback/degraded flags fire. Single bugfix REQ, high risk due to core validation path, no approval or decomposition needed — proceed directly via diagnose-fix-validate.

## Next action

Locate the PROJECT_TYPES enum and the decision-validation path in the AI Intake Brain; insert an alias-normalization step (node-typescript-cli, typescript-cli, node-cli, cli-tool -> internal-tool) executed before enum validation; add a regression test asserting an AI decision with project_type node-typescript-cli is accepted and normalized to internal-tool without triggering heuristic-fallback or brain_degraded; run the full brain test suite to confirm no other classification changed.


## Brain Decisions

# Orchestrator Brain Decision Log — REQ-001

## Decisions

- none

## Questions

- none

## Missing info

- Exact file location of PROJECT_TYPES enum and the schema validation step that rejects unknown project_type values

## Suggested REQs

- none

## Provider result

{
  "status": "ai",
  "provider": "claude-code",
  "model": "sonnet",
  "escalation": null,
  "provider_trace": [
    {
      "provider": "claude-code",
      "status": "success",
      "model": "sonnet",
      "duration_ms": 26706,
      "repair_used": false,
      "extracted_json": false
    }
  ],
  "route": {
    "enabled": true,
    "mode": "hybrid",
    "provider": "claude-code",
    "fallback_chain": [
      "claude-code",
      "openai",
      "heuristic"
    ],
    "difficulty": "medium",
    "risk": "high",
    "depth": "deep",
    "model": "sonnet",
    "reasoning_strategy": "deliberate",
    "use_external_brain": true,
    "external_min_difficulty": "simple",
    "max_prompt_chars": 28000,
    "projected_output_tokens": 4500,
    "routing_reason": "Difficulty medium and risk high justify external Brain provider claude-code.",
    "token_policy": {
      "simple_asks_skip_external": true,
      "max_prompt_chars": 28000,
      "projected_output_tokens": 4500,
      "estimated_input_tokens": 2766,
      "estimated_output_tokens": 4500
    }
  }
}


## Status

- Current status: implementation_ready
- Work type: bugfix
- Difficulty: medium
- Scope: multi_file
- Project type: existing-project
- Workflow: diagnose-fix-validate
- Brain depth: deep
- Reasoning strategy: deliberate
- Brain provider route: claude-code → openai → heuristic
- External Brain used: yes
- Risk: high
- Confidence: 0.83
- Should implement now: no
- Requires decomposition: no

## User Answers / Clarifications


## Answer — 2026-07-21T23:39:05.857Z

El enum PROJECT_TYPES y la normalización/validación están en src/engines/intake-schema.js. El flujo que consume validateBrainDecision está en src/engines/ai-intake-brain.js. Localizá también los tests relacionados en tests/orchestrator-brain.test.js o el archivo de regresiones correspondiente. No necesito aportar más información; inspeccioná el repositorio y aplicá el fix acotado.


## Improved Spec Summary

# Improved Spec — REQ-001
## Original Ask
Corregí un bug real del AI Intake Brain detectado usando ebook-market-lab.
Contexto:
Claude respondió una decisión correcta, pero usó project_type node-typescript-cli. El schema lo rechazó porque no pertenece al enum, provocó heuristic-fallback, marcó BRAIN DEGRADED y reclasificó incorrectamente una CLI TypeScript como fullstack_feature.
Para este REQ, clasificá el repositorio como:
- project_type: existing-project
- work_type: bugfix
Implementación requerida:
- Mantener cerrado el enum actual de PROJECT_TYPES.
- Normalizar aliases antes de validar project_type.
- Mapear como mínimo:
  - node-typescript-cli
  - typescript-cli
  - node-cli
  - cli-tool
  hacia internal-tool.
- Agregar un regression test donde una decisión AI con project_type node-typescript-cli sea aceptada y normalizada a internal-tool.
- Verificar que no active heuristic-fallback ni brain_degraded.
- No cambiar otros contratos ni clasificaciones.
## Interpreted Intent
Fix the AI Intake Brain so project_type aliases (e.g. node-typescript-cli, typescript-cli, node-cli, cli-tool) are normalized to the closed enum value internal-tool before schema validation, preventing false heuristic-fallback / BRAIN DEGRADED / misclassification as fullstack_feature.
## Work Type
bugfix / existing-project
## Scope
Deliver the smallest professional slice that satisfies the intent and respects gates.
## Out of Scope
- Unapproved high-risk changes.
- Fake real-world claims.
- Large architecture changes not requested.
## Acceptance Criteria
- The implementation matches the interpreted user intent.
- No fake real-world data, metrics, contact data or legal claims are introduced.
- Required validation commands are executed or explicitly marked skipped with reason.
- An evidence pack explains close status.
- Root cause is documented or clearly inferred.
- Regression coverage is added or explicitly waived.
- PROJECT_TYPES enum remains closed and unchanged in membership.
- A normalization step runs before project_type schema validation and maps at minimum: node-typescript-cli, typescript-cli, node-cli, cli-tool -> internal-tool.
- New regression test: AI decision payload with project_type=node-typescript-cli is accepted, normalized to internal-tool, and does not trigger heuristic-fallback or brain_degraded.
- Existing tests for other project_type values and work_type classifications remain green/unchanged.
- No other schema, contract, or classification behavior is modified.
## Constraints
- do not invent phone numbers
- do not invent emails
- do not invent addresses
- do not invent social links
- do not invent metrics, clients, years of experience or legal claims
- do not close without evidence
- do not bypass deterministic gates

## Suggested Roadmap / REQ Slices

- none

## Project DNA

{
  "identity": {
    "name": "AI Code Factory Project",
    "description": "Local-first Product Engineering OS project.",
    "principle": "Simple outside. Intelligent inside. Auditable always."
  },
  "stack": {
    "frontend": "Next.js",
    "backend": "NestJS",
    "database": "PostgreSQL",
    "runtime": "Node.js >=20",
    "os": "Windows/PowerShell friendly"
  },
  "expected_architecture": {
    "source_dirs": [
      "src",
      "app",
      "pages",
      "components"
    ],
    "test_dirs": [
      "tests",
      "test",
      "__tests__"
    ],
    "forbidden_in_source": [
      "hardcoded secrets",
      "invented business data"
    ],
    "config_format": "json"
  },
  "quality_bar": {
    "frontend_visual": "premium, disciplined, no typographic gigantism, real visual evidence",
    "backend": "explicit contracts, validation, error cases, proportional tests",
    "general": "no green-build-only closes, evidence-driven"
  },
  "must_not_do": [
    "invent phone numbers, emails, addresses, social links",
    "invent metrics, clients, years of experience or legal claims",
    "implement frontend visual work without approved design",
    "close visual work without visual acceptance",
    "change database/auth/payments/deploy without approval"
  ]
}

## Progress so far (DO NOT redo completed stages)

# Progress — REQ-001

This file is the source of truth for what is ALREADY DONE in this requirement.
Agents resuming work MUST read it first and MUST NOT redo completed stages.

- [2026-07-21T23:39:46.675Z] **branch** — status: on_request_branch | branch: acf/req-001-corregi-un-bug-real-del-ai-intake-brain-detectad
- [2026-07-21T23:39:46.687Z] **plan** — {"contract":"C:\\Users\\fasol\\Documents\\ai-code-factory-v5.4.0\\.ai\\execution\\contracts\\REQ-001-executor-contract.md"}
- [2026-07-21T23:40:24.390Z] **execute** — status: failed
- [2026-07-22T00:21:07.256Z] **branch** — status: on_request_branch | branch: acf/req-001-corregi-un-bug-real-del-ai-intake-brain-detectad
- [2026-07-22T00:21:07.270Z] **plan** — {"contract":"C:\\Users\\fasol\\Documents\\ai-code-factory-v5.4.0\\.ai\\execution\\contracts\\REQ-001-executor-contract.md"}
- [2026-07-22T00:21:07.612Z] **execute** — status: failed
- [2026-07-22T00:28:32.954Z] **branch** — status: on_request_branch | branch: acf/req-001-corregi-un-bug-real-del-ai-intake-brain-detectad
- [2026-07-22T00:28:32.965Z] **plan** — {"contract":"C:\\Users\\fasol\\Documents\\ai-code-factory-v5.4.0\\.ai\\execution\\contracts\\REQ-001-executor-contract.md"}
- [2026-07-22T00:28:33.362Z] **execute** — status: failed
- [2026-07-22T00:30:06.921Z] **branch** — status: on_request_branch | branch: acf/req-001-corregi-un-bug-real-del-ai-intake-brain-detectad
- [2026-07-22T00:30:06.933Z] **plan** — {"contract":"C:\\Users\\fasol\\Documents\\ai-code-factory-v5.4.0\\.ai\\execution\\contracts\\REQ-001-executor-contract.md"}
- [2026-07-22T00:35:04.901Z] **execute** — status: success | files: src/engines/intake-schema.js, tests/orchestrator-brain.test.js
- [2026-07-22T00:35:34.663Z] **validate** — status: passed
- [2026-07-22T00:35:34.681Z] **acceptance** — close_allowed: true
- [2026-07-22T00:35:34.685Z] **self_review** — {"problems":0}
- [2026-07-22T00:35:34.697Z] **gates** — blockers: scope: 1 file(s) touched outside approved scope. | close_allowed: false
- [2026-07-22T00:47:06.981Z] **branch** — status: on_request_branch | branch: acf/req-001-corregi-un-bug-real-del-ai-intake-brain-detectad


## Learned User Rules

- none

## Compiled Knowledge

No compiled knowledge yet. Run compile-memory to consolidate history.

## Design Taste

# Design Taste — learned preferences

- Real estate / product premium aesthetic: sober, contemporary, disciplined.
- No typographic gigantism; proportioned titles and controlled whitespace.
- Hero must communicate value in under 5 seconds with a visible CTA.
- Before/after galleries need 6-8 meaningful cases with comparison interaction.
- Professional, honest footers; explicit placeholders instead of invented data.
- Mobile usability is a first-class requirement, not an afterthought.

This file is updated by compile-memory and mine-feedback. Manual edits welcome.


## Engineering Taste

# Engineering Taste — learned preferences


[...truncated 3686 chars to respect the prompt budget. Full content is on disk; read the referenced file for detail...]

## Expected Output

- Implement the requested change within allowed scope.
- Report files changed.
- Do not claim done unless validation passed.
