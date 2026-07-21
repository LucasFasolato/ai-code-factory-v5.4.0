# AI Code Factory v4.7.1 — Small Change Routing Hotfix

This patch hardens v4.7 after the first Windows sandbox test.

## Fixes

- Small, single-file UI additions such as `Agregá una sección simple en la home...` now route as `small_change` and do not require design-first.
- Claude/AI intake decisions that over-report generic visual missing info for `small_change` are sanitized:
  - no `approved visual design before implementation` blocker;
  - no visual acceptance requirement;
  - no `do not implement frontend visual work without approved design` forbidden rule;
  - `should_implement_now` remains true when no real blocker exists.
- Heuristic intake now recognizes simple section/banner/status-label requests as `small_change`, even if they mention `home`.

## Preserved from v4.7.0

- Windows portable validation runner (`npm` → `npm.cmd`, etc.) without `shell:true`.
- Codex automation with `--skip-git-repo-check`.
- Project bootstrap for validation scripts.
- Git request branch workflow.

## Validation

- `npm test`: 120/120 passing.
- `npm run lint`: syntax OK.
- `npm run typecheck`: syntax OK.
- `npm run build`: syntax OK.
