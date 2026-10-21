import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

const ALLOWED_EVENTS = new Set([
  "candidate_staged",
  "decision_knowledge",
  "retrieval_success",
  "no_match"
]);

export function metricPaths(workspaceRoot = ".") {
  const root = path.resolve(workspaceRoot);
  const metricsDir = path.join(root, ".pi", "metrics");
  return { workspaceRoot: root, metricsDir, logPath: path.join(metricsDir, "agenticlab.jsonl") };
}

/**
 * Register the workspace metrics location for the Pi adapter. Inventory and
 * pricing events deliberately share this narrow writer without payload data.
 */
export function registerKnowledgeCaptureMetrics(_pi, opts = {}) {
  return metricPaths(opts.workspaceRoot || ".");
}

/**
 * Append one allowlisted, content-free event. Callers cannot attach arbitrary
 * metadata, so rule names, conditions, actions, customer, and cart data never
 * enter this log.
 */
export async function recordKnowledgeCaptureMetric(event, opts = {}) {
  if (!ALLOWED_EVENTS.has(event)) {
    throw new Error("unsupported knowledge-capture metric event");
  }
  const { workspaceRoot, metricsDir, logPath } = metricPaths(opts.workspaceRoot || ".");
  const policyPath = path.join(workspaceRoot, "AgenticLab", "knowledge-capture-policy.json");
  const policyText = await fs.readFile(policyPath, "utf8");
  const policy = JSON.parse(policyText);
  if (policy.metricsEnabled !== true) return { recorded: false, reason: "metrics-disabled" };

  await fs.mkdir(metricsDir, { recursive: true, mode: 0o700 });
  const line = `${JSON.stringify({ event, occurredAt: new Date().toISOString() })}\n`;
  const handle = await fs.open(logPath, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_CREAT, 0o600);
  try {
    await handle.writeFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { recorded: true };
}
