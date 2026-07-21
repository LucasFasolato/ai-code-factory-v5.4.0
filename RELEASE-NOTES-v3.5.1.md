# AI Code Factory v3.5.1 — Windows CLI Fix

This release hardens the v3.5 Multi-Brain Adaptive Edition for Windows/PowerShell users.

## Fixes

- Fixed Claude Code Brain on Windows when `ACF_CLAUDE_CODE_COMMAND` points to `claude.cmd` or another `.cmd/.bat` shim.
- Added a portable spawn helper that wraps Windows command scripts through `cmd.exe /d /s /c` while preserving `shell:false` for normal executables.
- Reused the portable spawn helper in the generic command runner, improving compatibility for future `.cmd`-based tools.
- Added regression coverage for safe Windows command-line quoting.

## Recommended Windows Claude config

```env
ACF_AI_INTAKE_PROVIDER=claude-code
ACF_AI_INTAKE_MODE=hybrid
ACF_AI_INTAKE_FALLBACK_CHAIN=claude-code,heuristic
ACF_CLAUDE_CODE_COMMAND=C:\Users\fasol\AppData\Roaming\npm\claude.cmd
ACF_CLAUDE_CODE_ARGS=-p
ACF_CLAUDE_CODE_PROMPT_MODE=stdin
```

If `where.exe claude` returns another path, use that `.cmd` path instead.
