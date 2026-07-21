# AI Code Factory v4.7.0 — Windows Reliability & Git Branch Workflow

v4.7 hardens the real failures found while testing v4.6 on Windows/PowerShell with a Next.js sandbox.

## Fixed

- **Windows validation runner**: `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` no longer fail with `exit_code: null` and empty stdout/stderr when run through ACF on Windows.
  - `npm`/`npx`/`yarn`/`pnpm` are normalized to their `.cmd` shims on Windows.
  - `.cmd`/`.bat` scripts are still executed through a safe `cmd.exe /d /s /c` wrapper with `shell:false`.
  - Added regression coverage for the portable runner and validation execution.

- **Codex trusted-directory friction**: Codex executor invocations now include `--skip-git-repo-check` for automated local harness runs, while keeping `--sandbox workspace-write` and `shell:false`.

- **Version drift text**: CLI init/status/help now report v4.7.0 instead of old v4.1/v4.6 labels.

## Added

- **Git request branch workflow**:
  - Each implementing REQ is moved to an isolated branch before execution: `acf/req-xxx-<slug>`.
  - After gates pass, ACF commits the branch and merges it back to the detected base branch (`main`, `master`, or current base).
  - If git is not initialized or has no initial commit, implementation is blocked before coding.
  - New command: `npm run ai -- branch-status`.

- **Project bootstrap**:
  - New command: `npm run ai -- project-bootstrap`.
  - Adds missing validation scripts in new projects (`typecheck`, `test`, and minimal lint/build when applicable).
  - Can initialize git and create a safe initial commit for new local repos.

- **Doctor runner smoke test**:
  - `doctor` now checks that the same portable runner used by validation can execute `npm --version`.

## Validation

- `npm test`: 118/118 passing.
- `npm run lint`: passing.
- `npm run typecheck`: passing.
- `npm run build`: passing.

