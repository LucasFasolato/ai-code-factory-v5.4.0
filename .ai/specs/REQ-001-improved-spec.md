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
- do not modify or widen the PROJECT_TYPES enum itself
- do not change unrelated classifications, contracts, or workflows
- do not silently swallow genuinely invalid project_type values — normalization only applies to the specified known aliases
- do not bypass deterministic gates or remove the heuristic-fallback safety net for truly unmapped values
- do not invent phone numbers, emails, addresses, social links, metrics, clients, years of experience or legal claims

## Required Evidence

- Gates report.
- Validation status.
- Acceptance evaluation.
- Evidence pack.
