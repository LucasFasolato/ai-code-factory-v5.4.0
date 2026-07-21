# AI Code Factory v5.3 — Product Engineering OS local-first

**Claude piensa · Codex implementa · el harness gobierna** — ramas por REQ, gates deterministas, evidencia, memoria y economía de tokens.

- 🚀 **Empezar**: [QUICKSTART.md](QUICKSTART.md) — setup en 2 min + el flujo de 4 verbos
- ⚙️ **Configurar**: [CONFIG.md](CONFIG.md) — referencia completa
- 🔧 **Problemas**: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — fallos reales, soluciones probadas
- 📜 **Historia**: [CHANGELOG.md](CHANGELOG.md)

El flujo diario:

```
acf start "tu pedido"  →  acf continue  →  acf review  →  acf accept
```

¿Perdido? `acf` sin comando te dice dónde estás y el próximo paso, siempre.

---

## Qué hace el Orchestrator Brain

Cuando ejecutás `ask`, el harness hace:

```text
ask humano
→ carga project-dna, constraints, memoria, backlog y project-map
→ heuristic pre-analysis
→ AI Intake Brain si está configurado
→ JSON estructurado validado por schema
→ merge con reglas duras determinísticas
→ genera artefactos `.ai`
→ decide próximo paso seguro
```

Puede decidir:

- si el pedido es simple, mediano, complejo o épica;
- si se puede crear un REQ directo o debe descomponerse;
- si requiere design-first;
- si faltan preguntas críticas;
- si toca auth, DB, pagos, seguridad o UI pública;
- qué workflow corresponde;
- qué tools/context necesita;
- qué criterios de aceptación iniciales aplicar;
- qué no debe hacerse.

La IA decide el camino, pero no puede saltarse gates duros: no ejecuta código, no aprueba por vos, no cierra REQs, no modifica constraints lockeadas y no puede tratar un dry-run como implementación real.

## Requisitos

- Node.js >= 20
- Windows / PowerShell friendly
- Opcional: Codex CLI y/o Claude CLI para ejecución real
- Opcional para brain real: OpenAI API key

Sin API key, el harness sigue funcionando con fallback heurístico.

## Configurar API key

La forma más simple:

```powershell
Copy-Item .env.example .env
notepad .env
```

Completar:

```env
OPENAI_API_KEY=sk-your-key-here
ACF_AI_INTAKE_MODEL=gpt-4.1
```

Después:

```powershell
npm run ai -- brain-status
```

Alternativa por PowerShell:

```powershell
$env:OPENAI_API_KEY="sk-your-key-here"
npm run ai -- brain-status
```

> No commitear `.env` ni `.ai/config.local.json`.

## Instalación

```powershell
npm run ai -- init
npm run ai -- brain-status
```

`init` crea el workspace `.ai/` con config JSON, playbooks, definitions of done, MCP registry, project DNA, knowledge, eventos y carpetas nuevas para brain/epics.

## Interfaz simple

| Comando | Qué hace |
| --- | --- |
| `ask "..."` | Ejecuta Orchestrator Brain, crea REQ/EPIC, preguntas, routing y context pack |
| `brain-status` | Muestra si la IA está configurada y qué provider/model usará |
| `why` | Explica decisiones de routing/judgment |
| `context-pack` | Muestra el paquete que recibirá el executor |
| `next` | Ejecuta el próximo paso del workflow |
| `preview` | Muestra el execution contract antes de tocar código |
| `approve` | Ejecuta, valida, evalúa gates y genera evidencia |
| `status` | Estado del REQ activo, blockers y próximo paso |

## Product epics

Un pedido grande no se ejecuta como una única tarea.

Ejemplo:

```powershell
npm run ai -- ask "Quiero una app tipo Vinted para tesis con usuarios, publicaciones, ofertas, chat y pagos simulados"
```

Resultado esperado:

```text
work_type: product_epic
difficulty: epic
scope: product_epic
requires_decomposition: true
should_implement_now: false
suggested_reqs: scaffold, auth, listings, upload, catalog UI, offers, transactions, chat, reviews, e2e demo
```

Se generan artefactos en:

```text
.ai/epics/
.ai/reasoning/brain/
.ai/reasoning/context-packs/
```

## Design-first

Trabajo visual público no se implementa sin diseño aprobado:

```text
ask → next/design brief → prompt pack → design-import → design-approve
preview → approve → screenshot-import → visual-review → visual-accept
```

Reglas duras:

- `design-approve option-b-desktop` resuelve option-b; no cae a la recomendada.
- No se aprueban opciones sin artifacts reales.
- Build verde no cierra UI pública sin evidencia visual + `visual-accept`.
- Fake data scanner bloquea teléfonos, emails, ubicaciones, métricas y claims inventados.

## Hard gates nuevos en v3.4

- `dry_run` no cierra como `done`.
- executor missing/skipped/failed/timed out bloquea cierre.
- product epic bloquea ejecución directa.
- scope gate bloquea archivos tocados fuera del contrato.
- context pack incluye answers, project DNA, learned rules, compiled memory y constraints.

## Capa evolutiva

| Área | Comandos |
| --- | --- |
| Memoria e historia | `history`, `lessons`, `evolution`, `compile-memory` |
| Feedback humano → reglas | `feedback "..."`, `mine-feedback` |
| Retrospectiva | `replay REQ`, `counterfactual REQ`, `root-cause REQ`, `classify-failures REQ` |
| Calidad de decisiones | `decision-quality REQ`, `confidence-calibration` |
| Autonomía ganada | `calibrate-autonomy [--apply]`, `autonomy safe\|balanced\|autonomous` |
| Identidad del proyecto | `dna` |
| Playbooks adaptativos | `playbook-upgrade [--apply]`, `playbook-upgrade versions` |
| Skills y patterns | `distill-skill REQ`, `skills`, `patterns` |
| Constraints duras | `lock-constraint "..." [--pattern regex]`, `constraints [check]` |
| Salud estructural | `architecture-drift`, `test-gaps`, `state-doctor`, `health` |
| Curaduría | `suggest-next`, `improve-self` |

## Dashboard local

```powershell
npm run ai -- dashboard
# http://127.0.0.1:3333
```

Solo escucha en `127.0.0.1`, tiene body limit 1MB y protección de path traversal.

## Estructura

```text
src/
  cli.js
  defaults.js
  core/
  engines/
    ai-intake-brain.js
    ai-intake-provider.js
    intake-schema.js
    epic-decomposer.js
    scope-gate-engine.js
  dashboard/
tests/
  orchestrator-brain.test.js
```

## Documentos útiles

- `AI-INTAKE-BRAIN.md`
- `RELEASE-NOTES-v3.4.md`
- `SECURITY-IMPROVEMENTS.md`
- `ARCHITECTURE.md`
- `QUICKSTART.md`

## Tests

```powershell
npm run lint
npm test
```

Estado de esta entrega:

```text
Syntax OK: 59 files checked
35/35 tests passing
```
