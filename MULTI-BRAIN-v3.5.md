# Multi-Brain setup

Recommended local setup:

| Layer | Provider | Billing path |
| --- | --- | --- |
| Brain / Intake | Claude Code CLI | Claude plan usage |
| Executor / implementation | Codex CLI | ChatGPT/Codex plan usage |
| Fallback | Heuristic local | Free |
| Optional fallback | OpenAI API | API billing, budget-guarded |

## Verify provider readiness

```powershell
npm run ai -- brain-status
npm run ai -- brain-doctor
npm run ai -- executor-status
```

## Preview routing without writing artifacts

```powershell
npm run ai -- ask-preview "Cambiar texto del botón Enviar a Consultar"
npm run ai -- ask-preview "Quiero una app tipo Vinted para tesis con usuarios, publicaciones, ofertas, chat y pagos simulados"
```

Expected behavior:

- Small copy changes route to heuristic/fast/direct.
- Product epics route to claude-code/architect/tree.

## Force a route when needed

```powershell
npm run ai -- ask "..." --provider heuristic
npm run ai -- ask "..." --brain-depth deep
npm run ai -- ask "..." --brain-depth architect --strategy tree
```

## Safety guarantees

The Brain may decide workflow, difficulty, risk, questions, roadmap and next action. It cannot execute code, approve changes, close REQs, bypass gates, remove locked constraints, or touch project source files during the Brain phase.
