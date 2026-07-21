# AI Code Factory v4.1.1 — Production Interaction & Recovery

## Focus
This hotfix/professionalization release hardens the bridge from approved production mockups to implementation.

## Fixes

### True dry-run
- Added `approve-dry-run` command.
- `approve --dry-run` is also detected through npm's `npm_config_dry_run` behavior.
- Dry-run now writes dry-run evidence without running Codex or touching project files.

### Validate-only flow
- Added `validate` command to refresh validation, acceptance, gates and evidence without executing an agent.

### Execution recovery
- Added `recover-execution` command.
- If an executor timed out after touching files but validation now passes, execution is marked as recovered.

### Stronger frontend visual contracts
- Executor contracts now include:
  - Production Design Fidelity Requirements
  - Required Before/After Interaction
  - Required Frontend Component Architecture
- Codex is told explicitly not to replace approved images with gradients, empty blocks or decorative-only controls.

### Before/after gate
- Acceptance evaluation now fails decorative before/after controls when no real pointer/touch/range/state interaction is found.

## New commands
```bash
npm run ai -- approve-dry-run
npm run ai -- validate
npm run ai -- recover-execution [REQ-XXX]
```

## Validation
- 56/56 tests passing.
- Syntax OK across 79 JS files.
