# AI Code Factory v4.6 — Documentación completa

> Product Engineering OS local-first. Simple por fuera, inteligente por dentro,
> auditable siempre. **Claude piensa, Codex desarrolla, los gates garantizan.**

---

## 1. Qué es esto

AI Code Factory es un *harness* (orquestador) que convierte un pedido en
lenguaje natural en software terminado, pasando por un ciclo de ingeniería
completo y auditable. No escribe el código él mismo: **dirige** a dos agentes y
controla la calidad con reglas duras que nadie puede saltarse.

- **El cerebro (Claude Code)** analiza el pedido, decide el camino, descompone,
  detecta riesgos y propone features.
- **El desarrollador (Codex)** implementa, dentro de límites estrictos.
- **El harness** valida, testea, revisa, deja evidencia y aprende — y **frena**
  cuando algo no está bien.

Todo el estado vive en una carpeta `.ai/` dentro de tu proyecto. Es local-first:
no hay servidor, no se sube nada. Cada decisión queda escrita en disco.

### Filosofía brain-first

Claude es el cerebro pensante en **todo pedido no trivial**. El motor heurístico
(reglas locales por regex) es un **último recurso**: si Claude no está
disponible, el harness no inventa una decisión de baja calidad y sigue como si
nada — **frena la implementación**, lo avisa fuerte (`⚠️ BRAIN DEGRADED`) y te
pide restaurar el cerebro antes de seguir.

---

## 2. Requisitos e instalación

### Requisitos
- **Node.js ≥ 20** (probado en 20 y 22).
- **Claude Code CLI** (el cerebro) — instalado y logueado con tu plan.
- **Codex CLI** (el desarrollador) — instalado y logueado con tu plan ChatGPT/Codex.
- *(Opcional)* un navegador Chromium/Chrome/Edge para rasterizar diseños HTML→PNG.
- *(Opcional)* OpenAI API key, solo como fallback del cerebro o para imágenes vía API.

Sin Claude/Codex el harness **igual arranca**, pero te avisa que está degradado
y no implementa.

### Instalación
```bash
# 1. Copiá/descomprimí el harness dentro (o al lado) de tu proyecto.
cd tu-proyecto

# 2. Inicializá el workspace .ai
node ruta/al/harness/src/cli.js init
#    o si usás el package.json del harness:
npm run ai -- init

# 3. Verificá que todo esté sano
npm run ai -- doctor
```

> A lo largo de este documento uso `npm run ai -- <comando>`. Equivale a
> `node src/cli.js <comando>`. En Windows/PowerShell funciona igual.

### Configurar el cerebro y el ejecutor
```bash
cp .env.example .env
# editá .env
```

Lo mínimo recomendado (ya viene así por defecto):
```env
# El cerebro: Claude Code CLI a través de tu plan de Claude
ACF_AI_INTAKE_PROVIDER=claude-code
ACF_CLAUDE_CODE_COMMAND=claude        # en Windows quizá: claude.cmd (where.exe claude)

# El ejecutor: Codex sobre tu login de ChatGPT, NO sobre API billing
ACF_EXECUTOR_AUTH=chatgpt
ACF_EXECUTOR_SANITIZE_API_ENV=true

# Brain-first: Claude piensa desde dificultad "simple" en adelante
ACF_BRAIN_EXTERNAL_MIN_DIFFICULTY=simple
```

Verificá:
```bash
npm run ai -- brain-doctor      # ¿está Claude disponible?
npm run ai -- doctor            # salud global del sistema
```

---

## 3. El comando que importa: `doctor`

Antes de cualquier cosa, corré:
```bash
npm run ai -- doctor
```

Te dice de un vistazo si el sistema está listo: si Claude (cerebro) y Codex
(ejecutor) están disponibles, si hay deriva de versión, el estado del pipeline
de diseño, la integridad del estado, y la disciplina de tamaño de prompts.
Sale con código de error si algo requiere atención (útil para CI).

---

## 4. El ciclo completo de un pedido

```
ask  →  (preguntas)  →  diseño*  →  contrato  →  ejecución (Codex)
     →  validación  →  aceptación  →  review  →  gates  →  evidencia  →  learn  →  cerrado
```
\* solo para trabajo visual (design-first).

Hay dos maneras de recorrerlo: **paso a paso** (control total) o **automático**
(un comando).

### 4.1 Camino rápido — un solo comando

```bash
npm run ai -- ask "agregá un endpoint GET /health en NestJS con su test"
npm run ai -- cycle
```

`cycle` corre todo el ciclo de ingeniería de punta a punta: prepara el contrato,
invoca a Codex, valida (lint/typecheck/test/build), evalúa criterios de
aceptación, hace self-review, chequea **todos los gates**, auto-itera si la
validación falla (acotado), deja un evidence pack, aprende y **cierra el REQ**.

Se **detiene** ante el primer gate de seguridad y te dice por qué:
- cerebro degradado (Claude no estaba),
- el trabajo es visual y no hay diseño aprobado,
- requiere aprobación humana,
- es un *epic* que hay que descomponer,
- Codex salió sin tocar archivos (no-op),
- la validación sigue fallando tras los reintentos.

Nunca finge progreso ni cierra algo cuyos gates están bloqueados.

```bash
npm run ai -- cycle --approved        # confirma la aprobación humana requerida
npm run ai -- cycle --dry-run         # simula sin ejecutar de verdad
npm run ai -- cycle --no-auto-fix     # no intenta auto-reparar si falla la validación
```

### 4.2 Camino paso a paso — control total

```bash
npm run ai -- ask "..."          # el cerebro analiza y decide
npm run ai -- why                # por qué decidió eso
npm run ai -- questions          # preguntas críticas (si las hay)
npm run ai -- answer "..."       # respondés
npm run ai -- next               # avanza al siguiente paso seguro
npm run ai -- preview            # vista previa del plan de ejecución
npm run ai -- approve            # ejecuta de verdad (Codex)
npm run ai -- validate           # corre lint/typecheck/test/build
npm run ai -- gate-check         # estado de todos los gates
npm run ai -- evidence           # arma el evidence pack
npm run ai -- learn              # extrae aprendizajes
```

---

## 5. Flujos por tipo de trabajo

El cerebro clasifica cada pedido en un `work_type` y elige el workflow:

| Tipo de pedido | work_type | Workflow | Notas |
|---|---|---|---|
| "cambiar texto/color del botón" | `small_change` | direct-patch-with-validation | trivial → heurístico |
| "endpoint NestJS para X" | `backend_api` | backend-contract-first | riesgo ≥ medium |
| "integrar Mercado Pago / webhooks" | `backend_api` | backend-contract-first | **riesgo high**, aprobación de pago |
| "landing con hero y antes/después" | `frontend_visual` | **design-first** | requiere diseño aprobado |
| "feature fullstack de reservas" | `fullstack_feature` | split-contract-first | |
| "app tipo Vinted con todo" | `product_epic` | product-epic-decomposition | **se descompone**, no se implementa de una |
| "hay un bug en el form" | `bugfix` | diagnose-fix-validate | |
| "refactorizar el módulo X" | `refactor` | behavior-preserving-refactor | preserva comportamiento |

### Flujo de diseño (design-first)

Para trabajo visual, antes de tocar código:
```bash
npm run ai -- design-doctor         # ¿qué proveedor/navegador hay? predice qué pasará
npm run ai -- design-brief          # arma el brief de diseño
npm run ai -- design-generate --all # Codex genera mockups HTML → el harness los rasteriza a PNG
npm run ai -- design-preview        # ves las opciones
npm run ai -- design-approve option-a
# recién ahí se puede implementar
```

**Cómo funciona la generación de diseño (clave):** Codex es un agente de código
y *no puede crear imágenes raster*. Por eso se le pide que genere **mockups HTML
auto-contenidos** (su capacidad real) y el harness los convierte a PNG con un
navegador headless local. Si no hay navegador, los HTML cuentan como artefactos
válidos. Si un proveedor falla, hay una cadena de fallback automática
(`gpt-image-codex → gpt-image-api → wireframe-mock`). Nunca queda trabado.

```bash
npm run ai -- design-import desktop.png mobile.png   # importar diseño propio
npm run ai -- design-generate --missing-only          # completar opciones faltantes
```

---

## 6. La máquina pensante: recomendar features y detectar debilidades

```bash
npm run ai -- propose-features
```

El harness **escanea tu código real** (stack detectado, ratio de tests, archivos
grandes, uso de `any`, scripts de calidad faltantes, CI/ESLint, TODOs) y el
**cerebro propone** los próximos pasos de mayor valor — features nuevas y fixes
de debilidades — **priorizados y con evidencia citada** de la señal que los
justifica.

Si Claude no está disponible, cae a propuestas determinísticas derivadas de las
debilidades medidas (claramente etiquetadas, nunca silenciosas).

Convertir una propuesta en un REQ analizado por el cerebro:
```bash
npm run ai -- create-req-from-proposal PROP-002
npm run ai -- cycle      # y se implementa con el ciclo completo
```

---

## 7. Garantías de calidad (los gates)

Un REQ **no se cierra** hasta que todos los gates relevantes pasan. Esto es lo
que hace al harness confiable:

- **brain_quality** — la decisión la tomó el cerebro real, no el heurístico
  degradado.
- **understanding** — confianza suficiente en la interpretación.
- **design_first / approved_design** — trabajo visual tiene diseño aprobado.
- **fake_data** — no hay teléfonos/emails/métricas inventados (usa placeholders).
- **locked_constraints** — no se violan restricciones bloqueadas.
- **technical_validation** — lint/typecheck/test/build pasan.
- **acceptance_criteria** — se cumplen los criterios de aceptación.
- **visual_evidence** — hay aceptación visual cuando corresponde.
- **executor_status** — Codex realmente implementó (no un *no-op* con exit 0).
- **scope** — Codex tocó solo archivos permitidos (no se sale del alcance).

```bash
npm run ai -- gate-check       # ver el estado de todos los gates
npm run ai -- fake-data-scan   # buscar datos inventados
```

### Reglas duras que el cerebro no puede saltarse
Aunque el LLM diga "implementá ya, riesgo bajo", las reglas determinísticas
mandan: detecta pagos/auth/DB como alto riesgo, fuerza descomposición de epics,
exige aprobación humana donde corresponde, y nunca permite cerrar sin evidencia.

---

## 8. Robustez: prompts que no rompen a Codex/Claude

Un problema clásico era mandar contextos gigantes que reventaban a Codex y Claude
("command line too long" / prompt demasiado largo). **Resuelto en tres capas:**

1. El ejecutor **no inyecta el contrato entero** en la línea de comando: pasa una
   instrucción corta (≤ 7 KB) que *apunta al archivo del contrato en disco*, y el
   agente lo lee. (Verificado: un contexto de 132 KB produce una instrucción de
   758 caracteres.)
2. El contrato **acota** el context pack embebido; el contenido completo queda en disco.
3. Los prompts del cerebro tienen un **tope absoluto** (60 KB) sin importar la config.

`npm run ai -- doctor` reporta esta disciplina en la sección `prompt_budget`.

---

## 9. Memoria, evolución y auditoría

Todo queda registrado y el harness aprende con el tiempo:

```bash
npm run ai -- history            # línea de tiempo de eventos
npm run ai -- lessons            # lecciones consolidadas
npm run ai -- evidence           # evidence pack de un REQ
npm run ai -- learn              # extraer aprendizaje de un REQ cerrado
npm run ai -- replay [REQ]       # reconstruir qué pasó
npm run ai -- root-cause [REQ]   # análisis de causa raíz de un fallo
npm run ai -- compile-memory     # consolidar conocimiento
npm run ai -- decision-quality   # calidad de las decisiones tomadas
```

Restricciones bloqueadas (cosas que no se deben cambiar nunca):
```bash
npm run ai -- lock-constraint "No cambiar el esquema de auth sin aprobación"
npm run ai -- constraints
npm run ai -- unlock-constraint <id>
```

---

## 10. Dashboard

```bash
npm run ai -- dashboard          # abre el Command Center local (http://127.0.0.1:3333)
```

Local-only (bind a 127.0.0.1, con protección de path traversal). Muestra el
backlog, el estado de cada REQ, gates, evidencia, y permite responder preguntas
y aprobar diseños desde el navegador.

---

## 11. Referencia rápida de comandos

**Núcleo**
`init` · `ask "..."` · `cycle` · `next` · `preview` · `approve` · `status` · `doctor`

**Cerebro / intake**
`why` · `questions` · `answer "..."` · `ask-preview "..."` · `brain-status` ·
`brain-doctor` · `brain-route` · `intake-preview` · `fix-intake` · `next-step`

**Ejecución / validación**
`approve-dry-run` · `validate` · `gate-check` · `executor-status` ·
`recover-execution` · `auto-iterate` · `cost-status`

**Diseño**
`design-doctor` · `design-brief` · `design-generate [--all|--missing-only|--single <o>|--confirm|--no-fallback]` ·
`design-import` · `design-preview` · `design-approve <opt>` · `design-provider` ·
`visual-review` · `visual-accept` · `screenshot-import` · `component-plan` ·
`design-research` · `design-quality` · `design-creativity` · `design-cost-preview` · `design-score`

**Autonomía y recomendaciones**
`propose-features` · `create-req-from-proposal PROP-NNN` · `product-scan` ·
`autonomous-cycle` · `run-loop`

**Calidad / reviews**
`quality` · `funnel-review` · `fake-data-scan` · `frontend-review` ·
`backend-review` · `product-review` · `security-review` · `architecture-review` ·
`standards` · `quality-profile`

**Evolución / memoria**
`history` · `lessons` · `evolution` · `compile-memory` · `feedback "..."` ·
`mine-feedback` · `replay` · `counterfactual` · `root-cause` · `classify-failures` ·
`decision-quality` · `confidence-calibration` · `calibrate-autonomy` ·
`playbook-upgrade` · `distill-skill` · `skills` · `patterns` · `dna`

**Salud / mantenimiento**
`health` · `state-doctor` · `doctor:syntax` · `lock-constraint` ·
`unlock-constraint` · `constraints` · `architecture-drift` · `test-gaps` · `suggest-next`

**Contratos / ADR**
`api-contract` · `adr` · `evidence` · `learn`

Para la lista viva: `npm run ai -- help`.

---

## 12. La carpeta `.ai/` (qué hay adentro)

```
.ai/
├── config.json              # configuración efectiva
├── state.json               # estado global (REQ activo, contador)
├── project-dna.json         # identidad y stack del proyecto
├── constraints.json         # restricciones bloqueadas
├── backlog/                 # un JSON por REQ
├── reasoning/
│   ├── intake/              # análisis de cada ask
│   ├── brain/               # resúmenes y trazas del cerebro
│   ├── questions/ decisions/ gates/ risks/ impact/ acceptance/ reviews/
│   └── context-packs/       # contexto resumido por REQ
├── execution/
│   ├── contracts/           # el contrato que recibe Codex
│   ├── status/ logs/        # resultado de cada ejecución
├── designs/                 # briefs, mockups, manifests, aprobados
├── evidence/packs/          # evidencia de cierre
├── memory/                  # lecciones y aprendizajes
├── autonomy/                # propuestas de features, ciclos
├── events/                  # log append-only de todo lo que pasó
└── standards/ playbooks/ knowledge/ mcp/ history/ ...
```

Todo es texto/JSON legible. Podés inspeccionar cualquier decisión a mano.

---

## 13. Configuración clave (`.env` / `.ai/config.json`)

| Variable | Default | Qué hace |
|---|---|---|
| `ACF_AI_INTAKE_PROVIDER` | claude-code | proveedor del cerebro |
| `ACF_AI_INTAKE_FALLBACK_CHAIN` | claude-code,openai,heuristic | cadena de fallback del cerebro |
| `ACF_BRAIN_EXTERNAL_MIN_DIFFICULTY` | simple | desde qué dificultad piensa el cerebro (brain-first) |
| `ACF_EXECUTOR_AUTH` | chatgpt | Codex usa login de ChatGPT, no API billing |
| `ACF_EXECUTOR_SANITIZE_API_ENV` | true | borra API keys del entorno del ejecutor |
| `ACF_DESIGN_PROVIDER` | gpt-image | proveedor de diseño (Codex html-first) |
| `ACF_DESIGN_CODEX_STRATEGY` | html-first | Codex hace HTML, el harness rasteriza |
| `ACF_DESIGN_AUTO_FALLBACK` | true | cadena de fallback de diseño |
| `ACF_AI_MONTHLY_BUDGET_USD` | 10 | tope de gasto si usás API |

Sin API key no se rompe nada: el cerebro corre con Claude Code (plan), y solo si
todo el cerebro falla cae al heurístico (avisando).

---

## 14. Recetas comunes

**Una landing profesional**
```bash
npm run ai -- ask "landing para una inmobiliaria con hero, servicios y antes/después"
npm run ai -- design-doctor
npm run ai -- design-brief
npm run ai -- design-generate --all
npm run ai -- design-approve option-a
npm run ai -- cycle
```

**Un endpoint backend con su test**
```bash
npm run ai -- ask "endpoint POST /products en NestJS con validación DTO y test"
npm run ai -- cycle
```

**Un producto grande (se descompone solo)**
```bash
npm run ai -- ask "app tipo Vinted con usuarios, publicaciones, ofertas, chat y pagos"
# → detecta epic, propone roadmap de child REQs; implementás slice por slice
npm run ai -- why
```

**Que el harness te recomiende qué hacer**
```bash
npm run ai -- propose-features
npm run ai -- create-req-from-proposal PROP-001
npm run ai -- cycle
```

---

## 15. Diagnóstico de problemas

| Síntoma | Qué hacer |
|---|---|
| `⚠️ BRAIN DEGRADED` al hacer `ask` | `brain-doctor` → instalar/loguear Claude → re-hacer `ask` |
| El `cycle` se detiene | leé el motivo; resolvé el gate que indica |
| Codex "no tocó archivos" (no_op) | revisá auth/sandbox de Codex; reintentá |
| Diseño no genera PNG | instalá Chrome/Chromium/Edge; o usá los HTML que sí genera |
| "command line too long" | ya no debería pasar; corré `doctor` sección prompt_budget |
| Deriva de versión | `doctor` lo reporta; `init` re-siembra la config |
| Estado inconsistente | `state-doctor` lista problemas y cómo resolverlos |

Regla de oro: **ante cualquier duda, `npm run ai -- doctor`.**

---

## 16. v4.7: Windows, bootstrap y ramas por REQ

### Validación robusta en Windows

v4.7 corrige el caso donde `npm run ai -- validate` marcaba todos los comandos como `failed` con `exit_code: null` y stdout/stderr vacíos aunque `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` pasaran manualmente. En Windows, el runner portable resuelve `npm`/`npx`/`yarn`/`pnpm` a sus shims `.cmd` y los ejecuta de forma segura con `shell:false`.

### Bootstrap de proyectos nuevos

En un proyecto nuevo, corré una vez:

```bash
npm run ai -- project-bootstrap
```

Esto agrega scripts mínimos de validación si faltan y prepara una base git cuando corresponde.

### Rama por requerimiento

Cada REQ de implementación se ejecuta primero en una rama aislada:

```txt
acf/req-001-descripcion-corta
```

El ciclo crea/switches a esa rama antes de invocar Codex. Si todos los gates pasan, ACF hace commit y mergea a la rama base detectada (`main`, `master` o la rama actual base). Si git no está inicializado o no hay commit inicial, el ciclo se detiene antes de tocar código.

Comandos útiles:

```bash
npm run ai -- branch-status
npm run ai -- project-bootstrap
```

---

## 17. Garantías de diseño del sistema

- **Auditable**: cada decisión queda en `.ai/` en texto/JSON.
- **Seguro**: API keys sanitizadas antes de invocar agentes; escrituras atómicas;
  dashboard local-only con protección de traversal; sin `shell:true`.
- **Honesto**: no finge éxito (no-op detectado), no cierra sin gates, no inventa datos.
- **Robusto**: prompts acotados, lock de concurrencia, fallback en cada capa.
- **Brain-first**: Claude piensa; el heurístico es último recurso explícito.

---

*AI Code Factory v4.7.0 — 118 tests, CI en Ubuntu/Windows × Node 20/22.*
*Para historial completo de cambios ver `CHANGELOG.md`.*
