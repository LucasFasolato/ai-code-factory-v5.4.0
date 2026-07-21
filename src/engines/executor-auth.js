const API_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY'
];

export function resolveExecutorAuthPolicy(config = {}) {
  const execution = config.execution || {};
  const auth = execution.auth || {};
  return {
    mode: process.env.ACF_EXECUTOR_AUTH || auth.mode || 'chatgpt',
    sanitize_api_env: process.env.ACF_EXECUTOR_SANITIZE_API_ENV
      ? process.env.ACF_EXECUTOR_SANITIZE_API_ENV !== 'false'
      : auth.sanitize_api_env !== false,
    require_chatgpt_login: process.env.ACF_EXECUTOR_REQUIRE_CHATGPT_LOGIN
      ? process.env.ACF_EXECUTOR_REQUIRE_CHATGPT_LOGIN !== 'false'
      : auth.require_chatgpt_login !== false,
    blocked_env_keys: auth.blocked_env_keys || API_ENV_KEYS
  };
}

export function buildExecutorEnv(config = {}, baseEnv = process.env) {
  const policy = resolveExecutorAuthPolicy(config);
  const env = { ...baseEnv };
  const removed = [];
  if (policy.mode === 'chatgpt' && policy.sanitize_api_env) {
    for (const key of policy.blocked_env_keys) {
      if (Object.prototype.hasOwnProperty.call(env, key)) {
        delete env[key];
        removed.push(key);
      }
    }
  }
  env.ACF_EXECUTOR_AUTH_MODE = policy.mode;
  env.ACF_EXECUTOR_API_ENV_SANITIZED = policy.mode === 'chatgpt' && policy.sanitize_api_env ? 'true' : 'false';
  return { env, removed, policy };
}

export function executorAuthStatus(config = {}, env = process.env) {
  const policy = resolveExecutorAuthPolicy(config);
  const presentApiEnv = policy.blocked_env_keys.filter((key) => Boolean(env[key]));
  return {
    mode: policy.mode,
    sanitize_api_env: policy.sanitize_api_env,
    require_chatgpt_login: policy.require_chatgpt_login,
    api_env_present_in_parent: presentApiEnv,
    api_env_will_be_removed_for_executor: policy.mode === 'chatgpt' && policy.sanitize_api_env ? presentApiEnv : [],
    safe_for_chatgpt_plan_execution: policy.mode === 'chatgpt' && policy.sanitize_api_env,
    warning: policy.mode === 'api'
      ? 'Executor auth is set to api; Codex/Claude may use API billing.'
      : null
  };
}
