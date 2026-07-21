# Troubleshooting — problemas reales, soluciones probadas

Cada entrada de esta guía salió de un fallo real durante el desarrollo y testing en vivo del harness (Windows 11, PowerShell, Claude + Codex por suscripción ChatGPT). No es teoría.

---

## `spawnSync claude ENOENT` (el doctor dice que Claude existe, pero el ask falla)

**Causa:** en Windows, los CLIs instalados por npm son shims `.cmd`. `CreateProcess` con `shell:false` solo resuelve `.exe`. Peor: `where claude` lista PRIMERO el shim `sh` sin extensión.

**Estado:** resuelto de raíz en v5.1+ (resolución dinámica que prefiere `.cmd` entre TODOS los candidatos). Si lo ves en una versión vieja:

```powershell
$env:ACF_CLAUDE_CODE_COMMAND = (where.exe claude | Select-String '\.cmd$' | Select-Object -First 1).ToString()
```

## `Brain: heuristic-fallback` / `BRAIN DEGRADED`

El brain (Claude) no respondió o devolvió algo no parseable. El harness FRENA a propósito — no implementa trabajo serio con heurísticas.

1. `acf brain-doctor` — ¿Claude logueado y accesible?
2. Forensics completo por intento: `.ai\reasoning\brain\raw\REQ-XXX\` (stdout/stderr/meta de cada attempt, incluido el strict-retry).
3. Si Claude devolvió prosa en vez de JSON, el strict retry lo recupera solo en v5.0+. Si aún falla, el raw te dice exactamente qué devolvió.

## `Executor timed out` (Codex corta a los 15 min)

**Causa #1 (la que nos pasó):** otra sesión de Codex corriendo en paralelo (otra ventana de VS Code, otra terminal). El auth ChatGPT comparte rate limits entre TODAS tus sesiones → throttling → timeouts.

- Cerrá las otras sesiones y `acf continue --force-execute`.
- Prevención automática: hook `pre_execute` que detecta procesos Codex ajenos y bloquea con mensaje claro (ver `acf hooks init`).

**Causa #2:** tarea genuinamente larga. Subí el límite:

```json
// .ai/config.json
{ "execution": { "timeout_ms": 1500000 } }
```

O mejor: partí el REQ en slices más chicos (el brain suele sugerirlos en `Roadmap`).

**Siempre:** el mensaje de error incluye el path del log exacto. Ahí está el stdout/stderr de Codex.

## `Executor exited cleanly but changed nothing (honest-success guard)`

Codex salió con exit 0 pero no tocó archivos. Casos:

- **Re-run sobre trabajo ya hecho** → resuelto en v5.1.2: el cycle resume solo. Si forzaste con `--force-execute` sobre una rama con cambios a medias de un intento fallido, limpiá primero: `git checkout master -- <archivos>` y reintentá.
- **Codex sin auth o bloqueado por sandbox** → `codex login`, revisá el log.

## `cycle` frena con "Design-first work requires an approved design"

El brain clasificó el trabajo como visual-que-requiere-diseño. Dos caminos:

- Flujo de diseño: `acf design-generate --all` → `design-preview` → `design-approve option-a`
- Es una sección simple y el diseño sobra: `acf override-workflow REQ-XXX direct-patch-with-validation` (v5.1.4+ limpia el flag correctamente) y `acf continue`. Nota: el cambio de workflow puede pedir `--approved` — es intencional.

## `The brain asked blocking question(s)`

Feature, no bug: el brain necesita una definición antes de implementar (v5.1.3+). `acf answer REQ-XXX "..."` — la respuesta se inyecta al contrato del executor — y `acf continue`.

## Gates bloqueando el close

`acf review` te da el cuadro completo. Los más comunes:

- `visual_evidence` — un humano tiene que MIRAR el cambio: `npm run dev` → `acf accept`.
- `acceptance_criteria` — si acabás de hacer visual-accept y sigue rojo, estás en una versión < v5.1.2 (snapshot stale); actualizá.
- `database_migration` — tocaste una entity sin migración en el mismo diff. Agregala.
- `rule:*` — una regla tuya de `.ai/standards/rules.json`. El detalle dice qué archivo la viola.

## Warnings CRLF de git en Windows

`LF will be replaced by CRLF...` — cosmético, es tu `core.autocrlf`. Cero impacto funcional.

## El doctor muestra drift de versión tras actualizar el harness

`acf init` en el proyecto re-stampea la versión del config (v5.1+) preservando tus settings.

## ¿Dónde está TODO lo que pasó con un REQ?

- `acf progress REQ-X` — etapa por etapa
- `acf review REQ-X` — el estado de decisión
- `.ai/evidence/packs/REQ-X-evidence-pack.md` — el paquete auditable
- `.ai/execution/logs/` — stdout/stderr de cada corrida del executor
- `.ai/reasoning/brain/raw/REQ-X/` — cada intento del brain, crudo

## Codex lentísimo / timeouts con tareas simples (`reasoning effort: xhigh`)

Si el log del executor muestra `reasoning effort: xhigh`, tu Codex global está en razonamiento extra-pesado — minutos de deliberación por paso. Para implementaciones scoped del harness es desperdicio. Bajalo solo para el executor sin tocar tu config global:

```jsonc
// .ai/config.json
{
  "execution": {
    "codex": {
      "command": "codex",
      "args": ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check",
               "--config", "approval_policy=\"never\"",
               "--config", "model_reasoning_effort=\"medium\"",
               "-C"]
    }
  }
}
```

## Codex hace `no_op` (exit 0, cero archivos) repetidamente

Antes de culpar a Codex, leé el contrato: `type .ai\execution\contracts\REQ-XXX-executor-contract.md`. Si contiene reglas contradictorias ("implement now: yes" + algo en Forbidden que lo prohíbe), Codex está OBEDECIENDO, no fallando. Resuelto de raíz en v5.3.1 para el caso design-first post-override; si ves otra contradicción, es un bug — reportala.
