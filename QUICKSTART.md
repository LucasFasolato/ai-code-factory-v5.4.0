# AI Code Factory — Quickstart (v5.3)

Una fábrica local de features con IA: **Claude piensa, Codex implementa, el harness gobierna** (ramas, validación, gates, evidencia, aprendizaje).

## Requisitos

- Node 20+ · Git · Claude CLI logueado (`claude`) · Codex CLI logueado (`codex`)

## Setup — una vez por proyecto (2 min)

```powershell
# Alias (PowerShell; agregalo a $PROFILE para que persista)
function acf { node C:\ruta\a\ai-code-factory\src\cli.js @args }

cd tu-proyecto        # nuevo o existente, da igual: setup se adapta
acf setup             # init + bootstrap + repo-map + AGENTS.md + git-policy + golden set
acf doctor            # todo verde = listo
```

## El flujo diario — 4 verbos

```powershell
acf start "Agregá cancelación de reservas con devolución parcial"
#   → el brain (Claude) clasifica, detecta riesgo, y pregunta lo que falta

acf answer REQ-001 "Solo admins pueden cancelar. Devolución 80% hasta 24hs antes."
#   → solo si el brain preguntó algo bloqueante

acf continue
#   → rama acf/req-001-... → Codex implementa → lint/typecheck/test/build → gates

acf review
#   → el paquete de decisión: diff real, señales de calidad, costo, blockers

npm run dev           # miralo con tus ojos (trabajo visual)
acf accept
#   → visual-accept + resume + merge a tu rama base. Listo.
```

**¿Perdido en cualquier punto?** Corré `acf` sin comando: el guide lee el estado real y te dice el próximo paso exacto, siempre.

## Los guardarraíles (por qué esto no es "vibe coding")

- **Brain-first**: si Claude no está disponible, el trabajo se frena — nunca implementa sobre heurísticas para trabajo serio.
- **Preguntas bloqueantes**: si el brain necesita saber algo, el cycle NO ejecuta hasta que respondas.
- **Rama por REQ**: master/main nunca se toca directo. La rama es el borrador; el merge es el commit.
- **Gates**: fake data, scope, validación técnica, migración de DB, standards ejecutables, evidencia visual. Si algo falla, no cierra.
- **Draft-commit**: riesgo `high` (pagos, auth, datos) espera tu `continue --approved` aunque todos los gates estén verdes.
- **Budget**: circuit breaker por REQ ($ y llamadas) — un loop nunca te vacía la cuenta.

## Comandos que vas a usar seguido

| Comando | Qué hace |
|---|---|
| `acf` | Dónde estás + próximo paso |
| `acf stats` | Completion rate, gates que más bloquean, gasto de tokens |
| `acf progress REQ-X` | La historia de un REQ, etapa por etapa |
| `acf cost-report REQ-X` | Qué costó y en qué etapa |
| `acf det-gates REQ-X` | Gates deterministas a $0 (migración, standards, semgrep) |
| `acf playbooks record REQ-X` | Graduá un plan probado para reusarlo |
| `acf hooks init` | Tus reglas ejecutables en el ciclo de vida |
| `acf brain-eval` | Regression test de la inteligencia del harness |

## Tus reglas como código

```jsonc
// .ai/standards/rules.json — bloquean merges vía det-gates
[
  { "id": "no-db-in-controllers", "description": "Controllers no acceden a TypeORM",
    "files": [".controller.ts"], "forbidden_pattern": "from .typeorm.", "severity": "error" }
]
```

```javascript
// .ai/hooks/pre_merge.js — código que refuerza lo que un prompt solo sugiere
// exit(1) = bloquea con tu razón. Ver: acf hooks init
```

Más detalle: `CONFIG.md` (toda la configuración) · `TROUBLESHOOTING.md` (problemas reales resueltos).
