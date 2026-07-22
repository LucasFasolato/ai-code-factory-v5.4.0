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
