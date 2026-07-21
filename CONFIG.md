# Configuración — referencia completa (v5.3)

Todo vive en `.ai/config.json` del proyecto. Cada clave es opcional; los defaults son seguros. Las variables de entorno (cuando existen) pisan al archivo.

## Brain (Claude)

```jsonc
{
  "ai_intake": {
    "provider": "claude-code",               // o "openai" | fallback siempre: heurístico
    "mode": "brain-first",                    // "heuristic" desactiva el brain (testing)
    "claude_code": {
      "command": "claude",                   // v5.1+: resuelve shims .cmd de Windows solo
      "output_format": "json",               // envelope determinístico (v5.0). "text" = legacy
      "strict_retry": true,                   // 1 reintento con contrato JSON duro ante prosa
      "model": null,                          // pin de modelo; null = el del CLI
      "timeout_ms": 120000
    }
  },
  "brain_routing": {
    "tier_models": {                          // v5.4: defaults senior ACTIVOS out-of-the-box
      "fast": "haiku",                        // aliases version-proof (haiku/sonnet/opus)
      "standard": "sonnet",
      "deep": "sonnet",
      "architect": "opus"
      // Opt-out: "cli" en un tier (o tier_models: "cli") hereda el modelo del CLI
    },
    "escalation": {                           // v5.4: el barato piensa primero; si duda, escala UNA vez
      "enabled": true,
      "min_confidence": 0.75                  // confianza < esto en tier bajo → segunda opinión senior
      // También escala si el tier barato FALLA (parse/schema) o flaggea high risk desde abajo.
      // Ambos intentos cuentan contra el budget por REQ (el circuit breaker sigue mandando).
    }
  }
}
```

Env: `ACF_CLAUDE_CODE_COMMAND`, `ACF_CLAUDE_CODE_OUTPUT_FORMAT`, `ACF_CLAUDE_CODE_STRICT_RETRY`, `ACF_CLAUDE_CODE_MODEL`, `ACF_AI_INTAKE_MODE`.

## Presupuesto de tokens (tokens = plata)

```jsonc
{
  "usage_budget": {
    "enabled": true,
    "monthly_hard_usd": 50,                  // techo mensual
    "per_req_hard_usd": 5,                   // techo por requerimiento
    "max_brain_calls_per_req": 15,           // circuit breaker: corta loops antes que el costo
    "fallback_when_exceeded": true
  }
}
```

Env: `ACF_AI_PER_REQ_HARD_USD`, `ACF_AI_MAX_BRAIN_CALLS_PER_REQ`.
Ver el gasto: `acf stats` (global) · `acf cost-report REQ-X` (por etapa).

## Executor (Codex)

```jsonc
{
  "execution": {
    "enabled": true,
    "primary": "codex",
    "adaptive_reasoning": true,              // v5.4: el orchestador decide cuánto piensa Codex
                                             // trivial/simple+low → low · high risk/complex → high · resto → medium
                                             // Tu flag explícito model_reasoning_effort en args SIEMPRE gana.
    "timeout_ms": 900000,                    // 15 min default; subilo para tareas largas
    "codex": { "command": "codex", "args": ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--config", "approval_policy=\"never\"", "-C"] }
  }
}
```

## Git workflow

```jsonc
{
  "git_workflow": {
    "branch_prefix": "acf",                  // ramas: acf/req-001-titulo-deaccentado
    "auto_commit_on_success": true,
    "delete_branch_after_merge": false       // true = limpia la rama tras mergear
  },
  "git": {
    "version_ai_state": "minimal"            // minimal | full | none — aplica: acf git-policy apply
  }
}
```

`minimal` (recomendado): conocimiento versionado (config, standards, specs, evidence, playbooks, golden); ruido runtime ignorado (events, caches, raw traces, progress, usage).

## Gates deterministas ($0 por corrida, scoped al diff del REQ)

```jsonc
{
  "deterministic_gates": {
    "migration": {
      "enabled": true,
      "entity_patterns": [".entity.ts", "schema.prisma"],
      "migration_patterns": ["migrations/", "prisma/migrations/"]
    },
    "semgrep": { "enabled": true },          // corre solo si está instalado
    "ast_grep": { "enabled": true }
  }
}
```

Reglas propias en `.ai/standards/rules.json`:

```jsonc
[
  { "id": "no-db-in-controllers", "description": "Controllers no acceden a TypeORM",
    "files": [".controller.ts"], "forbidden_pattern": "from .typeorm.", "severity": "error" },
  { "id": "dto-required", "description": "Controllers usan DTOs",
    "files": [".controller.ts"], "required_pattern": "Dto", "severity": "warning" }
]
```

`severity: "error"` bloquea el close vía `gate-check`; `"warning"` avisa.

## Hooks (tu código en el ciclo de vida)

```jsonc
{
  "hooks": {
    "timeout_ms": 60000,
    "pre_merge": ["node", "scripts/audit-gate.js"]   // alternativa a .ai/hooks/pre_merge.js
  }
}
```

Puntos: `pre_execute` · `post_execute` · `post_validate` · `pre_merge`. Payload: JSON por stdin y en `ACF_HOOK_PAYLOAD`. Los `pre_*` con exit ≠ 0 BLOQUEAN (stderr = razón); los `post_*` nunca bloquean. Scaffolding: `acf hooks init`.

## Presupuesto de prompts (Windows-safe)

```jsonc
{
  "prompt_budget": {
    "context_pack_max_chars": 24000,         // cap del contexto embebido en contratos
    "brain_prompt_hard_cap": 60000           // techo absoluto de prompts al brain
  }
}
```

Los prompts largos nunca viajan por argv (rompe Windows); van por stdin/archivo automáticamente.
