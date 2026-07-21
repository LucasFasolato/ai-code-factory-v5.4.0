# Security & Robustness Improvements — v3.3 → v3.3.1 FULL

Análisis de vulnerabilidades y debilidades encontradas en la base v3.3 y cómo se corrigieron. Cada fix tiene test de regresión donde aplica.

## 1. Path traversal en el dashboard (CRÍTICO) — corregido

**Problema:** el server estático resolvía la URL con `path.join(publicDir, url)` y verificaba `resolved.startsWith(publicDir)`. Eso es bypasseable de dos formas:
- Directorios hermanos con prefijo: `/home/user/public-evil` pasa el check `startsWith('/home/user/public')`.
- Encodings y separadores Windows (`..%5c`) que sobreviven a un join ingenuo.

**Fix** (`src/dashboard/server.js`): `decodeURIComponent` con manejo de error, rechazo de `\0`, `path.resolve` y verificación con `path.relative(PUBLIC_DIR, resolved)` — si el relativo empieza con `..` o es absoluto, 403. Header `X-Content-Type-Options: nosniff` en todas las respuestas.

**Regresión:** `tests/dashboard.test.js` ataca con `/../../etc/passwd`, `..%2f`, `%2e%2e`, `..%5c` y prefijo hermano usando sockets crudos (fetch normaliza dot-segments y ocultaría el bug).

## 2. Dashboard sin límites ni validación de input — corregido

**Problema:** los endpoints POST originales parseaban el body sin límite de tamaño (DoS local trivial) y aceptaban `request_id` arbitrario que terminaba en rutas de archivo.

**Fix:** body limit de 1MB con destrucción del request (413), validación `^REQ-\d{3,}$` antes de tocar el filesystem, JSON inválido → 400, request inexistente → 404, errores de dominio (ej. opción de diseño sin artifacts) → 422 con mensaje. El server bindea **solo 127.0.0.1** salvo opt-out explícito en config.

## 3. Config crítica en YAML frágil — eliminado

**Problema histórico de la línea v3.x:** parsing manual de YAML rompía con indentación y comillas (lección documentada del caso FAS).

**Fix:** toda la config es JSON (`.ai/config.json`, `project-dna.json`, `constraints.json`...). `architecture-drift` además detecta YAML de config en el proyecto del usuario cuando el DNA declara `config_format: json` (excluye workflows de CI).

## 4. `readJson` que lanzaba sobre archivos corruptos — endurecido

**Problema:** un solo JSON corrupto en `.ai/` (apagón, edición manual) tiraba abajo cualquier comando.

**Fix:** `readJsonSafe` con fallback en `loadConfig`, `loadState`, `listBacklog` y todos los engines que leen artifacts. `readNdjson` saltea líneas corruptas del event log en vez de fallar.

## 5. Ejecuciones opacas (logs vacíos, sin diff) — corregido

**Problema:** cuando Codex fallaba o se colgaba, el status no distinguía timeout de error, y no había forma de saber qué archivos tocó una ejecución fallida.

**Fix** (`executor-orchestrator.js`): flag `timed_out` propagado desde `spawnSync`, y `files_touched` calculado con diff de `git status --porcelain` antes/después de la ejecución. `state-doctor` ahora alerta "executor falló pero tocó N archivos — revisar/revertir". El evidence pack lista los archivos tocados.

## 6. Invocación de Codex (KF-005) — blindado con builder testeable

**Regla:** `codex exec --sandbox workspace-write --config approval_policy="never" -C <root> "<instruction>"`, siempre args como array y `shell:false` (Windows-safe, evita "stdin is not a terminal" e inyección por shell).

**Fix:** `buildExecutorCommand()` exportado y testeado; ambos executors (Codex y Claude fallback) pasan por él.

## 7. Estado mutable sin auditoría — event sourcing

**Problema:** el estado vivía solo en archivos JSON mutables; un bug o edición manual dejaba estados imposibles sin forma de detectarlos.

**Fix:** log de eventos append-only (`.ai/events/events.ndjson`) + `deriveStateFromEvents()`. `state-doctor` cruza ambas fuentes: REQ "done" sin evento `REQ_CLOSED`, eventos sin backlog, `VISUAL_ACCEPTED` sin artifact de review.

## 8. Constraints del usuario no exigibles — lock-constraint

**Problema:** decisiones del usuario ("nunca degradados en el hero") vivían solo en la conversación y se perdían.

**Fix:** `lock-constraint "..." [--pattern regex]` → `.ai/constraints.json`. Las constraints se inyectan en **todos** los execution contracts (sección "Locked Constraints — non-negotiable") y las que tienen pattern se verifican contra el código fuente en el gate `locked_constraints`, bloqueando el cierre si se violan. Auto-iterate se niega a "arreglar" violaciones de constraints (requieren humano).

## 9. Auto-iteración sin límites de seguridad — acotada

`auto-iterate` solo toca blockers técnicos seguros. Se detiene ante: fake data, diseño aprobado faltante, constraints violadas, y cualquier blocker que mencione database/auth/payments/deploy/destructive. Máximo de rondas configurable (`autonomy.max_auto_iterations`).

## 10. Evolución sin control humano — proposal-first en toda la capa

Ningún mecanismo evolutivo se auto-aplica:
- `mine-feedback`: solo reglas de *preferencia* van a `user-preferences.json`; reglas de proceso/gates quedan como propuesta.
- `playbook-upgrade`: propone por defecto; `--apply` versiona el playbook anterior en `.ai/playbooks/versions/` antes de modificar. `evolution.allow_autonomous_playbook_updates` es `false` por defecto.
- `calibrate-autonomy`: recomienda; aplica solo con `--apply`, nunca por encima de nivel 5, y emite evento `AUTONOMY_CHANGED` auditable.
