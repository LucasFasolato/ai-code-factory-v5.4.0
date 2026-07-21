import { aiPath, requestPaths } from '../core/paths.js';
import { readJsonSafe, writeJson } from '../core/fs.js';
import { nowIso } from '../core/format.js';

export function routeTools(root, intake) {
  const registry = readJsonSafe(aiPath(root, 'mcp', 'registry.json'), { tools: [] });
  const recommended = (intake.needs_mcp_tools || []).map((name) => {
    const tool = registry.tools.find((item) => item.name === name);
    return {
      tool: name,
      enabled: Boolean(tool?.enabled),
      risk: tool?.risk || 'unknown',
      required: name === 'filesystem' || name === 'design-provider' || name === 'playwright',
      requires_approval_for: tool?.requires_approval_for || [],
      reason: reasonForTool(name, intake)
    };
  });
  const result = { request_id: intake.request_id, generated_at: nowIso(), recommended_tools: recommended };
  writeJson(requestPaths(root, intake.request_id).toolRouting, result);
  logToolRouting(root, intake.request_id, result);
  return result;
}

export function mcpStatus(root) {
  return readJsonSafe(aiPath(root, 'mcp', 'registry.json'), { tools: [] });
}

export function listMcpTools(root) {
  const registry = mcpStatus(root);
  return registry.tools || [];
}

export function setMcpToolEnabled(root, toolName, enabled) {
  const registry = mcpStatus(root);
  const tool = (registry.tools || []).find((item) => item.name === toolName);
  if (!tool) throw new Error(`Unknown MCP tool: ${toolName}`);
  tool.enabled = Boolean(enabled);
  tool.updated_at = nowIso();
  writeJson(aiPath(root, 'mcp', 'registry.json'), registry);
  return tool;
}

export function mcpDoctor(root) {
  const registry = mcpStatus(root);
  const issues = [];
  for (const tool of registry.tools || []) {
    if (!tool.name) issues.push({ tool: '(unnamed)', severity: 'high', message: 'Missing tool name.' });
    if (!Array.isArray(tool.capabilities)) issues.push({ tool: tool.name, severity: 'medium', message: 'Capabilities must be an array.' });
  }
  return {
    status: issues.length ? 'needs_attention' : 'ok',
    total_tools: (registry.tools || []).length,
    enabled_tools: (registry.tools || []).filter((t) => t.enabled).length,
    issues
  };
}

function reasonForTool(name, intake) {
  if (name === 'filesystem') return 'Need to inspect and write project artifacts.';
  if (name === 'playwright') return 'Visual validation and screenshots are required.';
  if (name === 'design-provider' || name === 'image-generator') return 'Frontend visual work benefits from generated or imported design artifacts.';
  if (name === 'browser-search') return 'Search can provide references or current factual grounding.';
  if (name === 'docs-search') return 'Technical docs may reduce implementation risk.';
  if (name === 'component-generator') return 'UI or frontend requests benefit from component decomposition.';
  if (name === 'human-approval') return 'High-risk or design-sensitive decision requires user approval.';
  return `Recommended for ${intake.work_type}.`;
}

function logToolRouting(root, requestId, result) {
  const file = aiPath(root, 'mcp', 'tool-usage-log.json');
  const log = readJsonSafe(file, []);
  log.push({ request_id: requestId, event: 'tool-routing', at: nowIso(), tools: result.recommended_tools });
  writeJson(file, log.slice(-500));
}
