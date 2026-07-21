# AI Code Factory v5.0.0 — Reliable Brain, Token Economy & Deterministic Quality OS

v5.0 estabiliza el cerebro, protege la billetera y convierte la calidad en algo verificable a costo cero. Es la versión que pasa de "harness prometedor" a "Product Engineering OS confiable".

Todo lo descripto acá está implementado, testeado (139 tests, 19 nuevos) y probado end-to-end en sandbox.

---

## Pilar 1 — Reliable Brain (el fix del bug principal de v4.7.1)

El error `No JSON object start found in provider output` tenía tres causas y las tres están resueltas:

### 1.1 Transporte determinístico (`--output-format json`)
El harness ahora invoca `claude -p --output-format json` por defecto. Claude Code devuelve un envelope JSON garantizado (`{type:"result", result:"...", usage:{...}}`); el harness lo desenvuelve y recién ahí aplica el parser de schema (fences, comillas smart, trailing commas). Se acabó la lotería del parsing sobre texto libre.

- Config: `ai_intake.claude_code.output_format` (`"json"` default, `"text"` para volver al comportamiento anterior).
- Bonus: cuando el envelope trae `usage`, el ledger registra tokens reales en vez de estimados.

### 1.2 Strict retry semántico
Antes, los reintentos eran solo de transporte (stdin → file-stdin → arg): si Claude respondía prosa, reintentar por otro transporte daba la misma prosa. Ahora, ante un fallo de parseo con proceso exitoso, el harness reintenta UNA vez con contrato duro ("respond with ONLY a JSON object... start with { end with }"). Recién después cae a heurístico.

- Config: `ai_intake.claude_code.strict_retry` (default `true`).

### 1.3 Raw traces por intento
Cada intento del brain deja en `.ai/reasoning/brain/raw/REQ-xxx/`:
- `attempt-NN-{phase}-{mode}.stdout.txt` (salida completa, no 1000 chars)
- `attempt-NN-....stderr.txt`
- `attempt-NN-....meta.json` (args, status, signal, timestamp)

Debuggear un brain degradado ahora es leer un archivo, no arqueología.

---

## Pilar 2 — Token Economy OS (tokens = plata)

### 2.1 Model cascade
Clasificar "cambiá un botón" no debe costar lo mismo que diseñar la arquitectura de cancelaciones. El router ya calculaba `depth` (fast/standard/deep/architect); ahora cada depth puede mapear a un modelo distinto que viaja como `--model` al CLI:

```json
{
  "brain_routing": {
    "tier_models": {
      "fast": "claude-haiku-4-5",
      "standard": "claude-sonnet-4-6",
      "deep": "claude-sonnet-4-6",
      "architect": "claude-opus-4-8"
    }
  }
}
```

Sin mapping (default), el CLI usa su modelo configurado — cero cambio de comportamiento.

### 2.2 Budget por REQ + circuit breaker
El budget mensual no frena un retry loop que quema 40 llamadas en una tarde. Ahora hay guardia por request:

```json
{
  "usage_budget": {
    "per_req_hard_usd": 5,
    "max_brain_calls_per_req": 15
  }
}
```

El breaker corta por cantidad de llamadas antes que por costo (los CLIs por suscripción reportan $0 pero las llamadas se cuentan igual), y el error dice exactamente por qué frenó y qué revisar.

### 2.3 Repo Map (`npm run ai -- repo-map`)
El patrón de Aider sin dependencias: esqueleto de firmas (exports, clases, métodos, decoradores NestJS, rutas, entities) en vez de archivos completos. Un proyecto de 40 archivos colapsa de ~60k a ~2-3k tokens. Se inyecta automáticamente en cada context pack con la instrucción "preferí este mapa antes que leer archivos enteros".

### 2.4 Cost report por REQ (`npm run ai -- cost-report REQ-xxx`)
Desglose por etapa (intake, review, repair...) con tokens, llamadas y presupuesto. Guardado en `.ai/evidence/costs/`. Es la vista que permite optimizar: te dice QUÉ etapa quema plata.

### 2.5 Playbooks (`npm run ai -- playbooks list|record|match`)
El token más caro es el que se gasta redescubriendo un plan que ya funcionó. Al cerrar un REQ exitoso, `playbooks record REQ-xxx` destila su plan (archivos tocados, workflow, validaciones, lecciones). Los asks nuevos se matchean con scoring de keywords a costo cero (tolerante a morfología español/inglés: "cancelar" ↔ "cancelación"); un match fuerte inyecta el plan probado al contexto del brain en vez de explorar de cero. `record` se niega a destilar de REQs no cerrados (`--force` para override): los playbooks solo nacen de éxitos probados.

---

## Pilar 3 — Deterministic Quality (gates a $0)

LLM para juicio, tooling para verificación. `npm run ai -- det-gates REQ-xxx [--base main]` corre checks 100% reproducibles, **scoped al diff del REQ** (revisa el cambio, no el repo):

1. **Migration gate** — entity/schema modificado sin migración en el mismo diff → bloqueo. La clase de bug más cara de producción, detectada gratis.
2. **Standards ejecutables** — `.ai/standards/rules.json` convierte "no acceso a DB desde controllers" de una frase en markdown a un check que bloquea merges:
```json
[
  { "id": "no-db-in-controllers", "description": "Controllers no acceden a la DB", "files": [".controller.ts"], "forbidden_pattern": "from .typeorm.", "severity": "error" },
  { "id": "dto-required", "description": "Controllers usan DTOs", "files": [".controller.ts"], "required_pattern": "Dto", "severity": "warning" }
]
```
3. **Scanners externos** — si `semgrep` o `ast-grep` están instalados, corren sobre los archivos del diff; si no, se saltean silenciosamente.

El resultado se integra al `gate-check` como gate `deterministic_quality`: si falló, el REQ no cierra. Si nunca corriste det-gates, el gate queda `not_required` y nada existente se rompe.

Además, los **senior reviews (backend/security/frontend) ahora son diff-scoped**: una violación preexistente en `src/legacy/` ya no se flaggea en cada REQ nuevo; solo se revisa lo que el REQ cambió — como lo haría un tech lead real.

---

## Pilar 4 — Memoria viva y estándares cross-agente

### 4.1 AGENTS.md sync (`npm run ai -- agents-md sync`)
Genera/actualiza `AGENTS.md` y `CLAUDE.md` (el estándar emergente que leen Codex, Copilot y Claude Code) desde conocimiento vivo: project map, standards, constraints, DNA y lecciones aprendidas. Usa bloque managed (`<!-- acf:managed:start -->`): tus secciones custom se preservan, la sync es idempotente. El learning-engine alimenta este archivo — contexto dinámico que evoluciona, no un documento muerto.

### 4.2 Brain eval con golden set (`npm run ai -- brain-eval [init|--brain]`)
El harness ahora tiene regression tests de su propia inteligencia. `brain-eval init` siembra `.ai/golden/` con casos semilla; agregás asks reales de tus proyectos con la clasificación esperada. Cada cambio de prompt/modelo/heurística se mide contra el set (gratis, corre sobre la capa heurística; `--brain` para evaluar el brain real). En el desarrollo de esta misma versión, el eval detectó que "devolución parcial" no clasificaba como high risk — se corrigió la heurística y el eval quedó 5/5.

### 4.3 Git policy híbrida (`npm run ai -- git-policy apply|status`)
Resuelve el ruido de `.ai` en git con la política híbrida configurable (`git.version_ai_state`: `minimal` default | `full` | `none`). En `minimal`: conocimiento versionado (config, DNA, standards, specs, evidence, playbooks, golden set); ruido runtime ignorado (events, caches, raw traces, usage, state). Bloque managed en `.gitignore`, idempotente.

---

## Mejoras de heurística

- `devolución|reembolso|refund` ahora clasifican high risk (mueven plata, misma clase que payments).
- `flujo completo` ahora es señal fullstack.

---

## Config nueva (todo opcional, defaults seguros)

```json
{
  "ai_intake": {
    "claude_code": { "output_format": "json", "strict_retry": true, "model": null }
  },
  "brain_routing": {
    "tier_models": { "fast": null, "standard": null, "deep": null, "architect": null }
  },
  "usage_budget": {
    "per_req_hard_usd": 5,
    "max_brain_calls_per_req": 15
  },
  "deterministic_gates": {
    "migration": { "enabled": true, "entity_patterns": [".entity.ts", "schema.prisma"], "migration_patterns": ["migrations/"] },
    "semgrep": { "enabled": true },
    "ast_grep": { "enabled": true }
  },
  "git": { "version_ai_state": "minimal" }
}
```

Variables de entorno equivalentes: `ACF_CLAUDE_CODE_OUTPUT_FORMAT`, `ACF_CLAUDE_CODE_STRICT_RETRY`, `ACF_CLAUDE_CODE_MODEL`, `ACF_AI_PER_REQ_HARD_USD`, `ACF_AI_MAX_BRAIN_CALLS_PER_REQ`, `ACF_GIT_AI_POLICY`.

---

## Flujo recomendado v5.0

```powershell
# Setup una vez por proyecto
npm run ai -- init
npm run ai -- project-bootstrap
npm run ai -- repo-map
npm run ai -- agents-md sync
npm run ai -- git-policy apply
npm run ai -- brain-eval init

# Por feature
npm run ai -- ask "Agregá cancelación de reservas con devolución parcial"
npm run ai -- cycle                 # rama acf/req-xxx, implementación, validación
npm run ai -- det-gates REQ-xxx     # migration gate + standards + scanners, scoped al diff
npm run ai -- gate-check REQ-xxx    # incluye deterministic_quality
npm run ai -- cost-report REQ-xxx   # qué costó y en qué etapa
npm run ai -- playbooks record REQ-xxx   # gradúa el plan probado

# Mantenimiento del cerebro
npm run ai -- brain-eval            # regression de la inteligencia tras cada cambio
```

---

## Testing

- 139 tests (120 heredados + 19 nuevos), todos verdes.
- Nuevos suites: `v50-brain-reliability` (envelope, strict retry, raw traces), `v50-deterministic-gates` (migration gate y rules sobre repos git reales, verificando diff-scoping), `v50-token-economy` (circuit breaker, cascade, cost report, repo map NestJS), `v50-playbooks-memory` (graduación, matching, agents-md idempotente, git policy, brain eval, integración con gate-engine).
- Smoke tests end-to-end en sandbox NestJS: init → repo-map → agents-md → git-policy → brain-eval (5/5) → det-gates (falla con violaciones, pasa tras fix) → playbooks (record + match con morfología española) → cost-report.

## Compatibilidad

Sin breaking changes. Todos los flujos v4.7.1 funcionan igual; las capacidades nuevas son opt-in u operan con defaults seguros (`deterministic_quality` es `not_required` hasta que corras det-gates; `tier_models` vacío mantiene el modelo del CLI; `output_format: "text"` restaura el transporte anterior).
