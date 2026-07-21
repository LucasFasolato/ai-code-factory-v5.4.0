# Release Notes — AI Code Factory v3.4.1 Orchestrator Brain Hardening Edition

v3.4.1 keeps the v3.4 Orchestrator Brain and adds the hardening layer needed before serious testing.

## Added

- Executor auth policy: `ACF_EXECUTOR_AUTH=chatgpt` by default.
- Executor API env sanitizer: child Codex/Claude processes do not receive `OPENAI_API_KEY`, `OPENAI_PROJECT_ID`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc. when executor auth is `chatgpt`.
- `executor-status` command to verify whether the parent has API keys and whether they will be removed before executor spawn.
- AI usage ledger at `.ai/usage/usage.ndjson`.
- AI usage summary at `.ai/usage/summary.json`.
- `cost-status` command for monthly calls, token estimates and estimated cost.
- Budget guard for AI Intake calls with fallback-to-heuristic behavior when projected cost exceeds budget.
- Regression tests for executor env sanitization and budget guard.

## Why this matters

The intended cost split is:

- `ask` / Orchestrator Brain: may use OpenAI API key and is budget-guarded.
- `approve` / executor: should use the local Codex/Claude CLI auth session, preferably ChatGPT login for Codex, not API billing.

## Recommended config

```env
OPENAI_API_KEY=sk-your-key-for-brain-only
ACF_AI_INTAKE_PROVIDER=openai
ACF_AI_INTAKE_MODE=hybrid
ACF_AI_INTAKE_MODEL=gpt-5.4

ACF_EXECUTOR_AUTH=chatgpt
ACF_EXECUTOR_SANITIZE_API_ENV=true
ACF_EXECUTOR_REQUIRE_CHATGPT_LOGIN=true

ACF_AI_BUDGET_ENABLED=true
ACF_AI_MONTHLY_BUDGET_USD=10
```

## New commands

```powershell
npm run ai -- executor-status
npm run ai -- cost-status
```
