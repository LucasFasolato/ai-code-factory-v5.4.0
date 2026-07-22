# Orchestrator Brain Decision Log — REQ-001

## Decisions

- none

## Questions

- none

## Missing info

- Exact file location of PROJECT_TYPES enum and the schema validation step that rejects unknown project_type values

## Suggested REQs

- none

## Provider result

{
  "status": "ai",
  "provider": "claude-code",
  "model": "sonnet",
  "escalation": null,
  "provider_trace": [
    {
      "provider": "claude-code",
      "status": "success",
      "model": "sonnet",
      "duration_ms": 26706,
      "repair_used": false,
      "extracted_json": false
    }
  ],
  "route": {
    "enabled": true,
    "mode": "hybrid",
    "provider": "claude-code",
    "fallback_chain": [
      "claude-code",
      "openai",
      "heuristic"
    ],
    "difficulty": "medium",
    "risk": "high",
    "depth": "deep",
    "model": "sonnet",
    "reasoning_strategy": "deliberate",
    "use_external_brain": true,
    "external_min_difficulty": "simple",
    "max_prompt_chars": 28000,
    "projected_output_tokens": 4500,
    "routing_reason": "Difficulty medium and risk high justify external Brain provider claude-code.",
    "token_policy": {
      "simple_asks_skip_external": true,
      "max_prompt_chars": 28000,
      "projected_output_tokens": 4500,
      "estimated_input_tokens": 2766,
      "estimated_output_tokens": 4500
    }
  }
}
