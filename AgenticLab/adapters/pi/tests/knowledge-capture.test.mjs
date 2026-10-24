import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  containsSensitiveValue,
  getCapturePolicy,
  PILOT_PROJECT,
  PILOT_SCOPE,
  promoteCandidate,
  promotePending,
  readKnowledge,
  resolvePilotLocations,
  setCaptureEnabled,
  stageCandidates,
  validateCandidate,
  validateCandidateBatch,
} from "../knowledge-capture-core.mjs";
import { registerKnowledgeCaptureTools } from "../knowledge-capture-tools.mjs";
import { registerKnowledgeWriteGate } from "../knowledge-write-gate.mjs";

const Type = {
  Object: (properties, options = {}) => ({ kind: "object", properties, options }),
  String: (options = {}) => ({ kind: "string", options }),
  Literal: (value) => ({ kind: "literal", value }),
  Array: (items, options = {}) => ({ kind: "array", items, options }),
  Optional: (schema) => ({ kind: "optional", schema }),
};
const StringEnum = (values) => ({ kind: "string-enum", values });

async function fixture(t, { scope = PILOT_SCOPE, pendingStagingEnabled = false, maxCandidates = 10 } = {}) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-knowledge-pilot-"));
  const agenticDir = path.join(workspaceRoot, "AgenticLab");
  await fs.mkdir(agenticDir);
  const policyPath = path.join(agenticDir, "knowledge-capture-policy.json");
  await fs.writeFile(policyPath, `${JSON.stringify({
    pendingStagingEnabled,
    metricsEnabled: true,
    scope,
    maxCandidates,
    requiredFields: ["id", "title", "category", "scope", "status", "source", "recorded"],
  }, null, 2)}\n`);
  t.after(async () => fs.rm(workspaceRoot, { recursive: true, force: true }));
  return { workspaceRoot, agenticDir, policyPath, expectedRoot: workspaceRoot, scope };
}

function candidate(overrides = {}) {
  return {
    id: "decision-capture-review",
    title: "Review candidates before activation",
    category: "procedure",
    scope: PILOT_SCOPE,
    status: "candidate",
    source: { kind: "user-decision", reference: "ALPHA-KNOWLEDGE-PILOT-001 approved policy" },
    evidence: "The user specified a separate staging and batch-promotion step.",
    recorded: "2026-10-17",
    verified: "not yet verified",
    claim: "Pending candidates remain inactive until one batch is explicitly approved.",
    rationale: "Prevents unreviewed notes from being treated as approved project knowledge.",
    ...overrides,
  };
}

function activeRecordFile({ id, title = id, category = "fact", scope = "project:post-integration-delivery", status = "active", recorded = "2026-10-22", verified = "2026-10-22", supersedes, body = "" }) {
  const metadata = { id, title, category, scope, status, recorded, verified };
  if (supersedes !== undefined) metadata.supersedes = supersedes;
  return `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n# ${title}\n\n${body}\n`;
}

async function writeActiveRecord(fx, record, relativePath = `${record.id}.md`) {
  const filePath = path.join(fx.agenticDir, "knowledge", relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, activeRecordFile(record));
  return filePath;
}

async function enableCapture(fx) {
  return setCaptureEnabled(fx.workspaceRoot, true, { expectedRoot: fx.expectedRoot });
}

async function listPendingBytes(pendingRoot) {
  try {
    const batches = (await fs.readdir(pendingRoot)).sort();
    const result = [];
    for (const batch of batches) {
      const content = await fs.readFile(path.join(pendingRoot, batch, "bundle.json"), "utf8");
      result.push([batch, content]);
    }
    return result;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function waitForMetricEvents(workspaceRoot, expectedCount) {
  const metricPath = path.join(workspaceRoot, ".pi", "metrics", "agenticlab.jsonl");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const events = (await fs.readFile(metricPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line).event);
      if (events.length >= expectedCount) return events;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return [];
}

function fakePi() {
  const tools = new Map();
  const commands = new Map();
  const events = new Map();
  return {
    tools,
    commands,
    events,
    on(name, handler) { events.set(name, handler); },
    registerTool(tool) { tools.set(tool.name, tool); },
    registerCommand(name, command) { commands.set(name, command); },
  };
}

function uiContext(workspaceRoot, answers = []) {
  const confirmations = [];
  const notifications = [];
  return {
    ctx: {
      cwd: workspaceRoot,
      hasUI: true,
      ui: {
        async confirm(title, message) {
          confirmations.push({ title, message });
          return answers.length ? answers.shift() : true;
        },
        notify(message, level) { notifications.push({ message, level }); },
      },
    },
    confirmations,
    notifications,
  };
}

async function registerCapture(fx, options = {}) {
  const pi = fakePi();
  registerKnowledgeCaptureTools(pi, Type, StringEnum, { expectedRoot: fx.expectedRoot, ...options });
  return pi;
}

function decisionFor(record, disposition, extra = {}) {
  return {
    id: typeof record === "string" ? record : record.id,
    disposition,
    rationale: `Local review disposition: ${disposition}.`,
    ...extra,
  };
}

async function stageOne(fx, record = candidate()) {
  await enableCapture(fx);
  return stageCandidates(fx.workspaceRoot, [record], { expectedRoot: fx.expectedRoot });
}

async function writeRawBatch(fx, batchId, records) {
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  await fs.mkdir(pendingRoot, { recursive: true });
  const batchPath = path.join(pendingRoot, batchId);
  await fs.mkdir(batchPath);
  await fs.writeFile(path.join(batchPath, "bundle.json"), JSON.stringify({ schemaVersion: 1, batchId, records }, null, 2));
}

test("default-off policy rejects staging and leaves the pending queue absent", async (t) => {
  const fx = await fixture(t);
  const state = await getCapturePolicy(fx.workspaceRoot, { expectedRoot: fx.expectedRoot });
  assert.equal(state.pendingStagingEnabled, false);
  await assert.rejects(stageCandidates(fx.workspaceRoot, [candidate()], { expectedRoot: fx.expectedRoot }), /staging is disabled/u);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge-pending")), { code: "ENOENT" });
});

test("opt-in and revoke use explicit UI confirmation; staging has no per-candidate prompt", async (t) => {
  const fx = await fixture(t);
  const pi = await registerCapture(fx);
  const ui = uiContext(fx.workspaceRoot, [true, true]);
  const optIn = pi.commands.get("knowledge-opt-in");
  const optOut = pi.commands.get("knowledge-opt-out");
  assert.ok(optIn);
  assert.ok(optOut);

  await optIn.handler("", ui.ctx);
  const optedPolicy = await getCapturePolicy(fx.workspaceRoot, { expectedRoot: fx.expectedRoot });
  assert.equal(optedPolicy.pendingStagingEnabled, true);
  assert.equal(optedPolicy.scope, fx.scope);
  assert.equal(optedPolicy.metricsEnabled, true);
  assert.equal(optedPolicy.maxCandidates, 10);
  assert.equal(ui.confirmations.length, 1);

  const stagedCandidate = candidate();
  const triage = await pi.tools.get("triageKnowledgeCandidates").execute("triage-call-1", {
    observations: [stagedCandidate],
    decisions: [decisionFor(stagedCandidate, "stage")],
  }, undefined, undefined, ui.ctx);
  const staged = await pi.tools.get("stageKnowledgeCandidates").execute("call-1", { reviewId: triage.details.reviewId }, undefined, undefined, ui.ctx);
  assert.match(staged.content[0].text, /remain inactive/u);
  assert.equal(ui.confirmations.length, 1, "staging must not ask per candidate or per batch");
  assert.equal(staged.details.count, 1);
  const metricLines = (await fs.readFile(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl"), "utf8")).trim().split("\n");
  assert.deepEqual(metricLines.map((line) => JSON.parse(line).event), ["candidate_staged"]);

  const beforeRevoke = await listPendingBytes(path.join(fx.agenticDir, "knowledge-pending"));
  await optOut.handler("", ui.ctx);
  assert.equal((await getCapturePolicy(fx.workspaceRoot, { expectedRoot: fx.expectedRoot })).pendingStagingEnabled, false);
  assert.equal(ui.confirmations.length, 2);
  assert.deepEqual(await listPendingBytes(path.join(fx.agenticDir, "knowledge-pending")), beforeRevoke);
  await assert.rejects(stageCandidates(fx.workspaceRoot, [candidate({ id: "after-opt-out" })], { expectedRoot: fx.expectedRoot }), /staging is disabled/u);
  assert.deepEqual(await listPendingBytes(path.join(fx.agenticDir, "knowledge-pending")), beforeRevoke);
});

test("structured triage rejects incomplete, duplicate, extra, and malformed decision sets", async (t) => {
  const fx = await fixture(t);
  const pi = await registerCapture(fx);
  const triage = pi.tools.get("triageKnowledgeCandidates");
  const first = candidate();
  const second = candidate({ id: "second-triage-candidate" });

  await assert.rejects(triage.execute("triage-1", { observations: [first], decisions: [] }, undefined, undefined, { cwd: fx.workspaceRoot }), /exactly one decision/u);
  await assert.rejects(triage.execute("triage-2", { observations: [first, first], decisions: [decisionFor(first, "stage"), decisionFor(first, "transient")] }, undefined, undefined, { cwd: fx.workspaceRoot }), /duplicate candidate id/u);
  await assert.rejects(triage.execute("triage-3", { observations: [first, second], decisions: [decisionFor(first, "stage"), decisionFor(first, "transient")] }, undefined, undefined, { cwd: fx.workspaceRoot }), /duplicate decision id/u);
  await assert.rejects(triage.execute("triage-4", { observations: [first], decisions: [decisionFor("not-a-candidate", "stage")] }, undefined, undefined, { cwd: fx.workspaceRoot }), /no matching candidate/u);
  await assert.rejects(triage.execute("triage-5", { observations: [first], decisions: [{ ...decisionFor(first, "stage"), extra: true }] }, undefined, undefined, { cwd: fx.workspaceRoot }), /invalid shape/u);
  await assert.rejects(triage.execute("triage-6", { observations: [first], decisions: [{ ...decisionFor(first, "stage"), disposition: "maybe" }] }, undefined, undefined, { cwd: fx.workspaceRoot }), /unsupported disposition/u);
});

test("triage uses configured workspace scope and rejects wrong-scope staged candidates", async (t) => {
  const fx = await fixture(t);
  const pi = await registerCapture(fx);
  const triage = pi.tools.get("triageKnowledgeCandidates");
  const wrongScope = candidate({ id: "wrong-scope-record", scope: "project:OTHER" });
  await assert.rejects(triage.execute("triage-scope", { observations: [wrongScope], decisions: [decisionFor(wrongScope, "stage")] }, undefined, undefined, { cwd: fx.workspaceRoot }), /scope/u);
  const configured = await fixture(t, { scope: "project:post-integration-delivery" });
  const configuredPi = await registerCapture(configured);
  const scopedCandidate = candidate({ id: "configured-scope-record", scope: configured.scope });
  const scopedTriage = await configuredPi.tools.get("triageKnowledgeCandidates").execute("triage-configured-scope", {
    observations: [scopedCandidate],
    decisions: [decisionFor(scopedCandidate, "stage")],
  }, undefined, undefined, { cwd: configured.workspaceRoot });
  assert.equal(scopedTriage.details.decisions[0].disposition, "stage");

  const unsupported = candidate({ id: "unsupported-record", category: "future-category" });
  await assert.rejects(triage.execute("triage-category", { observations: [unsupported], decisions: [decisionFor(unsupported, "stage")] }, undefined, undefined, { cwd: fx.workspaceRoot }), /category/u);
  const unsupportedStatus = candidate({ id: "unsupported-status", status: "active" });
  await assert.rejects(triage.execute("triage-status", { observations: [unsupportedStatus], decisions: [decisionFor(unsupportedStatus, "stage")] }, undefined, undefined, { cwd: fx.workspaceRoot }), /status candidate/u);

  const advisory = await triage.execute("triage-advisory", {
    observations: [wrongScope],
    decisions: [decisionFor(wrongScope, "unsafe/out-of-scope", { uncertainty: "Scope was not verified." })],
  }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.equal(advisory.details.decisions[0].disposition, "unsafe/out-of-scope");
  assert.deepEqual(await fs.readdir(fx.agenticDir), ["knowledge-capture-policy.json"]);
});

test("shadow triage works with staging disabled and performs no filesystem writes", async (t) => {
  const fx = await fixture(t);
  const pi = await registerCapture(fx);
  const observations = [candidate(), candidate({ id: "shadow-evidence-needed" })];
  const result = await pi.tools.get("triageKnowledgeCandidates").execute("triage-shadow", {
    observations,
    decisions: [
      decisionFor(observations[0], "transient"),
      decisionFor(observations[1], "needs-evidence", { missingEvidence: "A current source citation is needed." }),
    ],
  }, undefined, undefined, { cwd: fx.workspaceRoot });
  const output = JSON.parse(result.content[0].text);
  assert.equal(output.reviewId, result.details.reviewId);
  assert.deepEqual(output.decisions.map(({ disposition }) => disposition), ["transient", "needs-evidence"]);
  assert.equal((await getCapturePolicy(fx.workspaceRoot, { expectedRoot: fx.expectedRoot })).pendingStagingEnabled, false);
  assert.deepEqual(await fs.readdir(fx.agenticDir), ["knowledge-capture-policy.json"]);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge-pending")), { code: "ENOENT" });
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge")), { code: "ENOENT" });
});

test("default-off staging rejects a valid stage review without writing candidates", async (t) => {
  const fx = await fixture(t);
  const pi = await registerCapture(fx);
  const observation = candidate();
  const triage = await pi.tools.get("triageKnowledgeCandidates").execute("triage-off", {
    observations: [observation],
    decisions: [decisionFor(observation, "stage")],
  }, undefined, undefined, { cwd: fx.workspaceRoot });
  await assert.rejects(pi.tools.get("stageKnowledgeCandidates").execute("stage-off", { reviewId: triage.details.reviewId }, undefined, undefined, { cwd: fx.workspaceRoot }), /staging is disabled/u);
  assert.equal((await getCapturePolicy(fx.workspaceRoot, { expectedRoot: fx.expectedRoot })).pendingStagingEnabled, false);
  await assert.rejects(fs.lstat(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl")), { code: "ENOENT" });
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge-pending")), { code: "ENOENT" });
});

test("stage requires a live reviewId and rejects missing or expired reviews", async (t) => {
  const fx = await fixture(t);
  let timestamp = 1000;
  const pi = await registerCapture(fx, { now: () => timestamp, reviewTtlMs: 500 });
  const stageTool = pi.tools.get("stageKnowledgeCandidates");
  await assert.rejects(stageTool.execute("stage-no-id", {}, undefined, undefined, { cwd: fx.workspaceRoot }), /reviewId is missing or invalid/u);
  await assert.rejects(stageTool.execute("stage-missing", { reviewId: "11111111-1111-4111-8111-111111111111" }, undefined, undefined, { cwd: fx.workspaceRoot }), /missing or expired/u);

  const observation = candidate();
  const triage = await pi.tools.get("triageKnowledgeCandidates").execute("triage-expiring", {
    observations: [observation],
    decisions: [decisionFor(observation, "stage")],
  }, undefined, undefined, { cwd: fx.workspaceRoot });
  timestamp = 1601;
  await assert.rejects(stageTool.execute("stage-expired", { reviewId: triage.details.reviewId }, undefined, undefined, { cwd: fx.workspaceRoot }), /missing or expired/u);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge-pending")), { code: "ENOENT" });
});

test("enabled staging consumes only candidates marked stage in the validated transient review", async (t) => {
  const fx = await fixture(t);
  await enableCapture(fx);
  const pi = await registerCapture(fx);
  const stageable = candidate({ id: "review-approved-stage" });
  const transient = candidate({ id: "review-stays-transient", category: "risk" });
  const triage = await pi.tools.get("triageKnowledgeCandidates").execute("triage-mixed", {
    observations: [stageable, transient],
    decisions: [
      decisionFor(stageable, "stage"),
      decisionFor(transient, "transient", { rationale: "Keep this observation in the task-local ledger." }),
    ],
  }, undefined, undefined, { cwd: fx.workspaceRoot });
  const stageTool = pi.tools.get("stageKnowledgeCandidates");
  assert.deepEqual(Object.keys(stageTool.parameters.properties), ["reviewId"]);
  await assert.rejects(stageTool.execute("stage-raw", { reviewId: triage.details.reviewId, records: [stageable] }, undefined, undefined, { cwd: fx.workspaceRoot }), /only a reviewId/u);
  const staged = await stageTool.execute("stage-reviewed", { reviewId: triage.details.reviewId }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.deepEqual(staged.details.stagedIds, [stageable.id]);
  const batches = await listPendingBytes(path.join(fx.agenticDir, "knowledge-pending"));
  assert.equal(batches.length, 1);
  const bundle = JSON.parse(batches[0][1]);
  assert.deepEqual(bundle.records.map(({ id }) => id), [stageable.id]);
  await assert.rejects(stageTool.execute("stage-reused", { reviewId: triage.details.reviewId }, undefined, undefined, { cwd: fx.workspaceRoot }), /missing or expired/u);
});

test("candidate schema, project scope, source provenance, and bounded sizes fail closed", async () => {
  assert.equal(validateCandidate(candidate()).status, "candidate");
  assert.throws(() => validateCandidate(candidate({ scope: "project:OTHER" })), /scope/u);
  assert.throws(() => validateCandidate(candidate({ status: "active" })), /status candidate/u);
  assert.throws(() => validateCandidate(candidate({ source: { kind: "conversation", reference: "" } })), /source.reference/u);
  assert.throws(() => validateCandidate(candidate({ source: { kind: "file", reference: "../.env" } })), /workspace-relative/u);
  assert.throws(() => validateCandidate(candidate({ claim: "See AgenticLab/knowledge-pending/example for details." })), /cannot link/u);
  assert.throws(() => validateCandidate(candidate({ id: "../escape" })), /path-safe/u);
  assert.throws(() => validateCandidate(candidate({ claim: "x".repeat(9 * 1024) })), /at most|exceeds/u);
  assert.throws(() => validateCandidateBatch([candidate(), candidate()]), /duplicate candidate id/u);
});

test("sensitive-value checks reject credential patterns and allow benign placeholders", async () => {
  assert.equal(containsSensitiveValue("api_key=sk_live_ABCDEFGHIJKLMNOPQRSTUV"), true);
  assert.equal(containsSensitiveValue("AWS key AKIA1234567890ABCDEF"), true);
  assert.equal(containsSensitiveValue("AWS_SECRET_ACCESS_KEY=synthetic-secret-value-123"), true);
  assert.equal(containsSensitiveValue("Authorization: Bearer abcdefghijklmnop123456"), true);
  assert.equal(containsSensitiveValue("-----BEGIN PRIVATE KEY-----"), true);
  assert.equal(containsSensitiveValue("4111 1111 1111 1111"), true);
  assert.equal(containsSensitiveValue("Use API_KEY=<redacted> in examples; never store passwords."), false);
  assert.equal(containsSensitiveValue("AWS_SECRET_ACCESS_KEY=<redacted>"), false);
  assert.equal(containsSensitiveValue("AWS_SECRET_ACCESS_KEY is the variable name; no value is shown."), false);
  assert.equal(containsSensitiveValue("The secret is intentionally not included."), false);
  assert.throws(() => validateCandidate(candidate({ claim: "Example: password=CorrectHorseBatteryStaple" })), /sensitive-data/u);
});

test("workspace and pending symlink paths fail closed", async (t) => {
  const fx = await fixture(t);
  await enableCapture(fx);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-pending-target-"));
  t.after(async () => fs.rm(outside, { recursive: true, force: true }));
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  await fs.symlink(outside, pendingRoot, "dir");
  await assert.rejects(stageCandidates(fx.workspaceRoot, [candidate()], { expectedRoot: fx.expectedRoot }), /symlink|real directory/u);
  assert.deepEqual(await fs.readdir(outside), []);

  const symlinkRoot = `${fx.workspaceRoot}-alias`;
  await fs.symlink(fx.workspaceRoot, symlinkRoot, "dir");
  t.after(async () => fs.unlink(symlinkRoot).catch(() => {}));
  await assert.rejects(resolvePilotLocations(symlinkRoot, fx.expectedRoot), /workspace root/u);
});

test("staging writes one atomic bundle with candidate status and rejects duplicate IDs", async (t) => {
  const fx = await fixture(t);
  await enableCapture(fx);
  const result = await stageCandidates(fx.workspaceRoot, [candidate()], { expectedRoot: fx.expectedRoot });
  assert.equal(result.count, 1);
  assert.equal(result.status, "candidate");
  assert.match(result.location, /^AgenticLab\/knowledge-pending\/batch-/u);
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const entries = await fs.readdir(pendingRoot);
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^batch-[0-9a-f-]{36}$/u);
  const bundle = JSON.parse(await fs.readFile(path.join(pendingRoot, entries[0], "bundle.json"), "utf8"));
  assert.equal(bundle.records[0].status, "candidate");
  assert.deepEqual(await fs.readdir(path.join(pendingRoot, entries[0])), ["bundle.json"]);
  await assert.rejects(stageCandidates(fx.workspaceRoot, [candidate()], { expectedRoot: fx.expectedRoot }), /already exists/u);
  const overflow = Array.from({ length: 20 }, (_, index) => candidate({ id: `overflow-${String(index).padStart(2, "0")}` }));
  await assert.rejects(stageCandidates(fx.workspaceRoot, overflow, { expectedRoot: fx.expectedRoot }), /limited to 10 candidates/u);
});

test("built-in file and shell tools cannot access pending; active writes retain per-operation confirmation", async (t) => {
  const fx = await fixture(t);
  await stageOne(fx);
  const pendingFile = "AgenticLab/knowledge-pending/batch-00000000-0000-4000-8000-000000000000/bundle.json";
  const alias = path.join(fx.workspaceRoot, "pending-alias");
  await fs.symlink(path.join(fx.agenticDir, "knowledge-pending"), alias, "dir");
  const pi = fakePi();
  registerKnowledgeWriteGate(pi);
  const handler = pi.events.get("tool_call");

  for (const toolName of ["read", "grep", "find", "ls", "write", "edit"]) {
    const result = await handler({ toolName, input: { path: pendingFile, content: "x", edits: [] } }, { cwd: fx.workspaceRoot, hasUI: true });
    assert.equal(result.block, true, `${toolName} should be blocked for direct pending access`);
  }
  for (const toolName of ["grep", "find"]) {
    const result = await handler({ toolName, input: { path: "AgenticLab" } }, { cwd: fx.workspaceRoot, hasUI: true });
    assert.equal(result.block, true, `${toolName} must not recursively search the pending subtree`);
  }
  const symlinkRead = await handler({ toolName: "read", input: { path: path.join(alias, "batch-00000000-0000-4000-8000-000000000000", "bundle.json") } }, { cwd: fx.workspaceRoot, hasUI: true });
  assert.equal(symlinkRead.block, true, "symlink aliases into pending must be blocked");
  const shell = await handler({ toolName: "bash", input: { command: "cat AgenticLab/knowledge-pending/batch-x/bundle.json" } }, { cwd: fx.workspaceRoot, hasUI: true });
  assert.equal(shell.block, true);
  const policyShell = await handler({ toolName: "bash", input: { command: "cat AgenticLab/knowledge-capture-policy.json" } }, { cwd: fx.workspaceRoot, hasUI: true });
  assert.equal(policyShell.block, true, "capture policy remains private to its adapter commands");
  const activeRead = await handler({ toolName: "bash", input: { command: "cat AgenticLab/knowledge/example.md" } }, { cwd: fx.workspaceRoot, hasUI: true });
  assert.equal(activeRead, undefined, "read-only access to active knowledge remains available");
  const shellSymlink = await handler({ toolName: "bash", input: { command: "cat pending-alias/batch-x/bundle.json" } }, { cwd: fx.workspaceRoot, hasUI: true });
  assert.equal(shellSymlink.block, true, "shell paths through symlink aliases into pending must be blocked");
  const userBash = pi.events.get("user_bash");
  const blockedUserShell = await userBash({ command: "cat pending-alias/batch-x/bundle.json" }, { cwd: fx.workspaceRoot });
  assert.equal(blockedUserShell.result.exitCode, 126, "user-entered shell path access must be stopped too");
  assert.equal(await userBash({ command: "printf safe" }, { cwd: fx.workspaceRoot }), undefined);
  const policyWrite = await handler({ toolName: "write", input: { path: "AgenticLab/knowledge-capture-policy.json", content: "{}" } }, { cwd: fx.workspaceRoot, hasUI: true });
  assert.equal(policyWrite.block, true, "policy changes must use the opt-in/revoke commands");
  const markerWrite = await handler({ toolName: "write", input: { path: "AgenticLab/.knowledge-promotion-committed.json", content: "{}" } }, { cwd: fx.workspaceRoot, hasUI: true });
  assert.equal(markerWrite.block, true, "one-time promotion state is tool-managed");
  const agenticAlias = path.join(fx.workspaceRoot, "agentic-alias");
  await fs.symlink(fx.agenticDir, agenticAlias, "dir");
  const policySymlinkWrite = await handler({ toolName: "edit", input: { path: path.join(agenticAlias, "knowledge-capture-policy.json"), edits: [{ oldText: "false", newText: "true" }] } }, { cwd: fx.workspaceRoot, hasUI: true });
  assert.equal(policySymlinkWrite.block, true, "policy mutation through a symlink must be blocked");

  let confirmations = 0;
  const allowedActiveWrite = await handler(
    { toolName: "write", input: { path: "AgenticLab/knowledge/example.md", content: "# Example" } },
    { cwd: fx.workspaceRoot, hasUI: true, ui: { async confirm() { confirmations += 1; return true; } } },
  );
  assert.equal(allowedActiveWrite, undefined);
  assert.equal(confirmations, 1, "ordinary active-knowledge writes keep the existing per-operation confirmation");
  await fs.mkdir(path.join(fx.agenticDir, ".knowledge-capture.lock"));
  const duringTransaction = await handler(
    { toolName: "write", input: { path: "AgenticLab/knowledge/another.md", content: "# Another" } },
    { cwd: fx.workspaceRoot, hasUI: true, ui: { async confirm() { confirmations += 1; return true; } } },
  );
  assert.equal(duringTransaction.block, true);
  await fs.rmdir(path.join(fx.agenticDir, ".knowledge-capture.lock"));
  assert.equal(confirmations, 1, "active writes are blocked while batch commit holds the transaction lock");
});

test("promotion rejection leaves active knowledge absent and the pending queue byte-identical", async (t) => {
  const fx = await fixture(t);
  await stageOne(fx);
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const before = await listPendingBytes(pendingRoot);
  let confirmations = 0;
  const result = await promotePending(fx.workspaceRoot, async (preview) => {
    confirmations += 1;
    assert.match(preview, /Review candidates before activation/u);
    assert.match(preview, /Pending candidates remain inactive/u);
    return false;
  }, { expectedRoot: fx.expectedRoot });
  assert.equal(confirmations, 1);
  assert.equal(result.promoted, false);
  assert.equal(await fs.stat(path.join(fx.agenticDir, "knowledge")).then(() => true, () => false), false);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, ".knowledge-promotion-committed.json")), { code: "ENOENT" });
  assert.deepEqual(await listPendingBytes(pendingRoot), before);
});

test("approved promotion displays one complete preview and atomically publishes INDEX plus individual active records", async (t) => {
  const fx = await fixture(t);
  const records = [candidate(), candidate({
    id: "risk-unreviewed-memory",
    title: "Unreviewed items are not active",
    category: "risk",
    claim: "The second candidate's complete claim appears in the preview and active file.",
  })];
  await stageOne(fx, records[0]);
  await stageCandidates(fx.workspaceRoot, [records[1]], { expectedRoot: fx.expectedRoot });
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const before = await listPendingBytes(pendingRoot);
  let confirmations = 0;
  const result = await promotePending(fx.workspaceRoot, async (preview) => {
    confirmations += 1;
    assert.match(preview, /decision-capture-review\.md/u);
    assert.match(preview, /risk-unreviewed-memory\.md/u);
    assert.match(preview, /The second candidate's complete claim appears/u);
    assert.match(preview, /Rationale \/ consequence/u);
    return true;
  }, { expectedRoot: fx.expectedRoot });
  assert.equal(confirmations, 1);
  assert.equal(result.promoted, true);
  const activeRoot = path.join(fx.agenticDir, "knowledge");
  assert.deepEqual((await fs.readdir(activeRoot)).sort(), ["INDEX.md", "decision-capture-review.md", "risk-unreviewed-memory.md"]);
  const index = await fs.readFile(path.join(activeRoot, "INDEX.md"), "utf8");
  assert.match(index, /\*\*Project scope:\*\* project:ALPHA-KNOWLEDGE-PILOT-001/u);
  assert.match(index, /\[risk-unreviewed-memory\]/u);
  const activeRecord = await fs.readFile(path.join(activeRoot, "decision-capture-review.md"), "utf8");
  assert.match(activeRecord, /^status: "active"$/mu);
  assert.match(activeRecord, /Pending candidates remain inactive/u);
  assert.equal(result.pendingConsumed, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(await listPendingBytes(pendingRoot), [], "successful promotion consumes the pending queue");
  await assert.rejects(fs.lstat(pendingRoot), { code: "ENOENT" });
  const marker = JSON.parse(await fs.readFile(path.join(fx.agenticDir, ".knowledge-promotion-committed.json"), "utf8"));
  assert.deepEqual(marker, { schemaVersion: 1, project: PILOT_PROJECT, state: "committed" });
  await fs.rm(activeRoot, { recursive: true });
  await assert.rejects(stageCandidates(fx.workspaceRoot, [candidate({ id: "stage-after-commit" })], { expectedRoot: fx.expectedRoot }), /already committed/u);
  await assert.rejects(promotePending(fx.workspaceRoot, async () => true, { expectedRoot: fx.expectedRoot }), /already committed/u);
});

test("single-candidate promotion adds to a populated root, preserves routing, and supports later promotions", async (t) => {
  const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
  const activeRoot = path.join(fx.agenticDir, "knowledge");
  const mapDir = path.join(activeRoot, "concurrency-control");
  await fs.mkdir(mapDir, { recursive: true });
  const index = "# Existing router\n- [Concurrency control](concurrency-control/INDEX.md)\n";
  const map = "# Existing topic map\n";
  const existing = [
    "---",
    'id: "existing-active-record"',
    'title: "Existing active record"',
    'category: "fact"',
    'scope: "multi-warehouse-inventory"',
    'status: "active"',
    'recorded: "2026-10-20"',
    'verified: "2026-10-20"',
    "---",
    "# Existing active record",
    "",
  ].join("\n");
  const indexPath = path.join(activeRoot, "INDEX.md");
  const mapPath = path.join(mapDir, "INDEX.md");
  const existingPath = path.join(activeRoot, "existing-active-record.md");
  await fs.writeFile(indexPath, index);
  await fs.writeFile(mapPath, map);
  await fs.writeFile(existingPath, existing);

  const first = candidate({ id: "promote-first-record", scope: fx.scope, title: "First approved candidate" });
  const second = candidate({ id: "promote-second-record", scope: fx.scope, title: "Second approved candidate" });
  await stageCandidates(fx.workspaceRoot, [first, second], { expectedRoot: fx.expectedRoot });
  let confirmations = 0;
  const firstResult = await promoteCandidate(fx.workspaceRoot, first.id, async (preview) => {
    confirmations += 1;
    assert.ok(preview.includes("Target: AgenticLab/knowledge/promote-first-record.md"));
    assert.ok(preview.includes("Existing active records, INDEX.md, and topic maps will not be changed"));
    assert.match(preview, /First approved candidate/u);
    return true;
  }, { expectedRoot: fx.expectedRoot });
  assert.equal(confirmations, 1);
  assert.equal(firstResult.promoted, true);
  assert.equal(firstResult.status, "active");
  assert.equal(firstResult.pendingConsumed, true);

  const firstRead = await readKnowledge(fx.workspaceRoot, { id: first.id }, { expectedRoot: fx.expectedRoot });
  assert.equal(firstRead.status, "ok");
  assert.equal(firstRead.matches[0].title, first.title);
  assert.equal(firstRead.matches[0].scope, fx.scope);
  assert.equal(firstRead.matches[0].status, "active");
  assert.equal((await readKnowledge(fx.workspaceRoot, { id: second.id }, { expectedRoot: fx.expectedRoot })).status, "not_found");
  assert.equal(await fs.readFile(indexPath, "utf8"), index);
  assert.equal(await fs.readFile(mapPath, "utf8"), map);
  assert.equal(await fs.readFile(existingPath, "utf8"), existing);
  const pendingBatch = await listPendingBytes(path.join(fx.agenticDir, "knowledge-pending"));
  assert.equal(pendingBatch.length, 1);
  assert.deepEqual(JSON.parse(pendingBatch[0][1]).records.map((record) => record.id), [second.id]);

  const secondResult = await promoteCandidate(fx.workspaceRoot, second.id, async () => true, { expectedRoot: fx.expectedRoot });
  assert.equal(secondResult.promoted, true);
  assert.equal(secondResult.pendingConsumed, true);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge-pending")), { code: "ENOENT" });
  assert.equal(await fs.readFile(indexPath, "utf8"), index);
  assert.equal(await fs.readFile(mapPath, "utf8"), map);
  assert.equal(await fs.readFile(existingPath, "utf8"), existing);
});

test("promotion rejection and active-ID collision preserve both stores", async (t) => {
  const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
  const record = candidate({ id: "collision-candidate", scope: fx.scope });
  await stageCandidates(fx.workspaceRoot, [record], { expectedRoot: fx.expectedRoot });
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const pendingBefore = await listPendingBytes(pendingRoot);
  const activeRoot = path.join(fx.agenticDir, "knowledge");
  await fs.mkdir(activeRoot);
  const existingContent = ["---", 'id: "collision-candidate"', 'status: "active"', "---", "# Different active claim", ""].join("\n");
  const activePath = path.join(activeRoot, "collision-candidate.md");
  await fs.writeFile(activePath, existingContent);
  let confirmations = 0;
  await assert.rejects(promoteCandidate(fx.workspaceRoot, record.id, async () => { confirmations += 1; return true; }, { expectedRoot: fx.expectedRoot }), /active record ID collision/u);
  assert.equal(confirmations, 0);
  assert.equal(await fs.readFile(activePath, "utf8"), existingContent);
  assert.deepEqual(await listPendingBytes(pendingRoot), pendingBefore);

  const rejectFx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
  const rejectRecord = candidate({ id: "rejected-promotion", scope: rejectFx.scope });
  await fs.mkdir(path.join(rejectFx.agenticDir, "knowledge"));
  await stageCandidates(rejectFx.workspaceRoot, [rejectRecord], { expectedRoot: rejectFx.expectedRoot });
  const rejectPendingBefore = await listPendingBytes(path.join(rejectFx.agenticDir, "knowledge-pending"));
  const rejected = await promoteCandidate(rejectFx.workspaceRoot, rejectRecord.id, async () => false, { expectedRoot: rejectFx.expectedRoot });
  assert.equal(rejected.status, "rejected");
  assert.equal(await fs.stat(path.join(rejectFx.agenticDir, "knowledge", `${rejectRecord.id}.md`)).then(() => true, () => false), false);
  assert.deepEqual(await listPendingBytes(path.join(rejectFx.agenticDir, "knowledge-pending")), rejectPendingBefore);
});

test("promotion retry cleans a pending duplicate after an active-file commit", async (t) => {
  const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
  const record = candidate({ id: "retry-promotion-record", scope: fx.scope });
  await fs.mkdir(path.join(fx.agenticDir, "knowledge"));
  await stageCandidates(fx.workspaceRoot, [record], { expectedRoot: fx.expectedRoot });
  const firstResult = await promoteCandidate(fx.workspaceRoot, record.id, async () => true, {
    expectedRoot: fx.expectedRoot,
    hooks: { beforePendingConsume: async () => { throw new Error("injected pending cleanup failure"); } },
  });
  assert.equal(firstResult.promoted, true);
  assert.equal(firstResult.pendingConsumed, false);
  assert.match(firstResult.warnings.join(" "), /pending candidate could not be removed/u);
  assert.equal((await readKnowledge(fx.workspaceRoot, { id: record.id }, { expectedRoot: fx.expectedRoot })).status, "ok");

  let confirmations = 0;
  const retry = await promoteCandidate(fx.workspaceRoot, record.id, async (preview) => {
    confirmations += 1;
    assert.match(preview, /identical active record already exists/u);
    return true;
  }, { expectedRoot: fx.expectedRoot });
  assert.equal(confirmations, 1);
  assert.equal(retry.promoted, false);
  assert.equal(retry.status, "already_active");
  assert.equal(retry.pendingConsumed, true);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge-pending")), { code: "ENOENT" });
});

test("retrieval filters active records by status, scope, and category before searching bodies", async (t) => {
  const fx = await fixture(t, { scope: "project:post-integration-delivery" });
  const knowledgeRoot = path.join(fx.agenticDir, "knowledge");
  await fs.mkdir(knowledgeRoot);
  await fs.writeFile(path.join(knowledgeRoot, "INDEX.md"), "# Router only\n");
  await fs.mkdir(path.join(knowledgeRoot, "inventory"));
  await fs.writeFile(path.join(knowledgeRoot, "inventory", "INDEX.md"), "# Map\n- **Map ID:** map-inventory\n");
  await writeActiveRecord(fx, { id: "root-active-fact", title: "Root active fact", scope: "inventory", body: "Advisory locks serialize reservations." });
  await writeActiveRecord(fx, { id: "nested-unmapped-risk", title: "Nested retrieval risk", category: "risk", scope: "inventory", body: "distinctive nested-completeness phrase" }, "inventory/nested-unmapped-risk.md");
  await writeActiveRecord(fx, { id: "inactive-secret", title: "Inactive decoy", scope: "inventory", status: "inactive", body: "excluded-body-secret marker" });
  await writeActiveRecord(fx, { id: "candidate-decoy", title: "Candidate decoy", scope: "inventory", status: "candidate", body: "candidate-only marker" });
  await writeActiveRecord(fx, { id: "wrong-project-decoy", title: "Wrong project decoy", scope: "project:other-project", body: "other-project-only marker" });

  const nested = await readKnowledge(fx.workspaceRoot, { query: "distinctive nested-completeness phrase", scope: "inventory", category: "risk" }, { expectedRoot: fx.expectedRoot });
  assert.equal(nested.status, "ok");
  assert.equal(nested.complete, true);
  assert.deepEqual(nested.matches.map((record) => record.id), ["nested-unmapped-risk"]);
  assert.equal(nested.matches[0].file, "inventory/nested-unmapped-risk.md");
  assert.equal(nested.matches[0].status, "active");

  const inactiveById = await readKnowledge(fx.workspaceRoot, { id: "inactive-secret" }, { expectedRoot: fx.expectedRoot });
  assert.equal(inactiveById.status, "filtered");
  assert.equal(inactiveById.filtered[0].id, "inactive-secret");
  assert.equal("content" in inactiveById.filtered[0], false);
  const excludedBody = await readKnowledge(fx.workspaceRoot, { query: "excluded-body-secret marker", scope: "inventory" }, { expectedRoot: fx.expectedRoot });
  assert.equal(excludedBody.status, "filtered");
  assert.equal(excludedBody.matches.length, 0);
  assert.equal(excludedBody.filtered.some((record) => record.id === "inactive-secret"), true);
  assert.equal(JSON.stringify(excludedBody).includes("excluded-body-secret marker"), false);
  const wrongProject = await readKnowledge(fx.workspaceRoot, { id: "wrong-project-decoy" }, { expectedRoot: fx.expectedRoot });
  assert.equal(wrongProject.status, "filtered");

  const pi = await registerCapture(fx);
  const readTool = pi.tools.get("readKnowledgeRecords");
  const toolRead = await readTool.execute("read-scoped-category", {
    query: "distinctive nested-completeness phrase",
    scope: "inventory",
    category: "risk",
  }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.equal(toolRead.details.status, "ok");
  assert.deepEqual(toolRead.details.matches.map((record) => record.id), ["nested-unmapped-risk"]);
  const filteredToolRead = await readTool.execute("read-filtered", { id: "inactive-secret" }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.equal(filteredToolRead.details.status, "filtered");
  assert.equal(filteredToolRead.details.matches.length, 0);
  const metricEvents = (await fs.readFile(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line).event);
  assert.deepEqual(metricEvents, ["retrieval_success"]);
});

test("no-match requires a complete scan and incomplete metadata does not emit no-match", async (t) => {
  const fx = await fixture(t, { scope: "project:post-integration-delivery" });
  await writeActiveRecord(fx, { id: "one-active-record", title: "One active record", scope: "inventory", body: "Inventory operations use transactions." });
  const pi = await registerCapture(fx);
  const readTool = pi.tools.get("readKnowledgeRecords");

  const noMatch = await readTool.execute("read-no-match", { query: "database connection pooling" }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.equal(noMatch.details.status, "no_match");
  assert.equal(noMatch.details.complete, true);

  await fs.writeFile(path.join(fx.agenticDir, "knowledge", "malformed-record.md"), "# Missing record metadata\n\nBody must not be searched.\n");
  const incomplete = await readTool.execute("read-incomplete", { query: "unrelated retrieval phrase" }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.equal(incomplete.details.status, "incomplete");
  assert.equal(incomplete.details.complete, false);
  const metricEvents = (await fs.readFile(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line).event);
  assert.deepEqual(metricEvents, ["no_match"]);
});

test("staging coexists with active knowledge, preserves it, and rejects active-ID collisions", async (t) => {
  const stageFx = await fixture(t, { scope: "project:post-integration-delivery" });
  await enableCapture(stageFx);
  const activeRoot = path.join(stageFx.agenticDir, "knowledge");
  await fs.mkdir(activeRoot);
  const activeIndex = "# Existing router\n";
  const activeRecord = [
    "---",
    'id: "existing-active-record"',
    'title: "Existing active record"',
    'category: "fact"',
    'scope: "multi-warehouse-inventory"',
    'status: "active"',
    'recorded: "2026-10-20"',
    'verified: "2026-10-20"',
    "---",
    "# Existing active record",
    "",
  ].join("\n");
  const mapDir = path.join(activeRoot, "concurrency-control");
  const mapContent = "# Existing topic map\n";
  await fs.mkdir(mapDir);
  await fs.writeFile(path.join(activeRoot, "INDEX.md"), activeIndex);
  await fs.writeFile(path.join(activeRoot, "existing-active-record.md"), activeRecord);
  await fs.writeFile(path.join(mapDir, "INDEX.md"), mapContent);

  const staged = await stageCandidates(stageFx.workspaceRoot, [candidate({ id: "new-pending-record", scope: stageFx.scope })], { expectedRoot: stageFx.expectedRoot });
  assert.equal(staged.status, "candidate");
  assert.equal(staged.count, 1);
  assert.equal(await fs.readFile(path.join(activeRoot, "INDEX.md"), "utf8"), activeIndex);
  assert.equal(await fs.readFile(path.join(activeRoot, "existing-active-record.md"), "utf8"), activeRecord);
  assert.equal(await fs.readFile(path.join(mapDir, "INDEX.md"), "utf8"), mapContent);
  assert.equal((await readKnowledge(stageFx.workspaceRoot, { id: "new-pending-record" }, { expectedRoot: stageFx.expectedRoot })).status, "not_found");
  await assert.rejects(stageCandidates(stageFx.workspaceRoot, [candidate({ id: "existing-active-record", scope: stageFx.scope })], { expectedRoot: stageFx.expectedRoot }), /already exists in active knowledge/u);

  const fx = await fixture(t);
  await stageOne(fx);
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const before = await listPendingBytes(pendingRoot);
  await fs.mkdir(path.join(fx.agenticDir, "knowledge"));
  let confirmations = 0;
  await assert.rejects(promotePending(fx.workspaceRoot, async () => { confirmations += 1; return true; }, { expectedRoot: fx.expectedRoot }), /already exists/u);
  assert.equal(confirmations, 0);
  assert.deepEqual(await listPendingBytes(pendingRoot), before);

  const other = await fixture(t);
  const same = candidate();
  await writeRawBatch(other, "batch-00000000-0000-4000-8000-000000000001", [same]);
  await writeRawBatch(other, "batch-00000000-0000-4000-8000-000000000002", [same]);
  let collisionConfirmations = 0;
  await assert.rejects(promotePending(other.workspaceRoot, async () => { collisionConfirmations += 1; return true; }, { expectedRoot: other.expectedRoot }), /colliding candidate id/u);
  assert.equal(collisionConfirmations, 0);
  await assert.rejects(fs.lstat(path.join(other.agenticDir, "knowledge")), { code: "ENOENT" });
});

test("preparation and injected rename failures leave no active tree and pending bytes intact", async (t) => {
  const fx = await fixture(t);
  await stageOne(fx);
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const before = await listPendingBytes(pendingRoot);

  await assert.rejects(promotePending(fx.workspaceRoot, async () => true, {
    expectedRoot: fx.expectedRoot,
    hooks: { afterIndexWritten: async () => { throw new Error("injected preparation failure"); } },
  }), /injected preparation failure/u);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge")), { code: "ENOENT" });
  assert.deepEqual(await listPendingBytes(pendingRoot), before);
  assert.equal((await fs.readdir(fx.agenticDir)).some((name) => name.startsWith(".knowledge-promote-")), false);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, ".knowledge-promotion-committed.json")), { code: "ENOENT" });

  await assert.rejects(promotePending(fx.workspaceRoot, async () => true, {
    expectedRoot: fx.expectedRoot,
    hooks: { rename: async () => { throw new Error("injected rename failure"); } },
  }), /injected rename failure/u);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge")), { code: "ENOENT" });
  assert.deepEqual(await listPendingBytes(pendingRoot), before);
  assert.equal((await fs.readdir(fx.agenticDir)).some((name) => name.startsWith(".knowledge-promote-")), false);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, ".knowledge-promotion-committed.json")), { code: "ENOENT" });
});

test("post-commit pending cleanup failure is reported as committed and queue is terminal", async (t) => {
  const fx = await fixture(t);
  await stageOne(fx);
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const before = await listPendingBytes(pendingRoot);
  const result = await promotePending(fx.workspaceRoot, async () => true, {
    expectedRoot: fx.expectedRoot,
    hooks: { removePending: async () => { throw new Error("injected cleanup failure"); } },
  });
  assert.equal(result.promoted, true);
  assert.equal(result.status, "active");
  assert.equal(result.pendingConsumed, false);
  assert.match(result.warnings.join(" "), /Active promotion committed, but pending-queue cleanup failed/u);
  assert.ok((await fs.stat(path.join(fx.agenticDir, "knowledge"))).isDirectory());
  assert.deepEqual(await listPendingBytes(pendingRoot), before);
  const marker = JSON.parse(await fs.readFile(path.join(fx.agenticDir, ".knowledge-promotion-committed.json"), "utf8"));
  assert.equal(marker.state, "committed");
  await assert.rejects(stageCandidates(fx.workspaceRoot, [candidate({ id: "after-cleanup-failure" })], { expectedRoot: fx.expectedRoot }), /already committed/u);
  await assert.rejects(promotePending(fx.workspaceRoot, async () => true, { expectedRoot: fx.expectedRoot }), /already committed/u);
});

test("oversized complete promotion preview fails before UI and leaves pending untouched", async (t) => {
  const fx = await fixture(t, { maxCandidates: 20 });
  await enableCapture(fx);
  const records = Array.from({ length: 12 }, (_, index) => candidate({
    id: `large-candidate-${String(index).padStart(2, "0")}`,
    claim: `Claim ${index}: ${"bounded preview text".repeat(130)}`,
    rationale: `Rationale ${index}: ${"review this item carefully ".repeat(35).trimEnd()}`,
  }));
  await stageCandidates(fx.workspaceRoot, records, { expectedRoot: fx.expectedRoot });
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const before = await listPendingBytes(pendingRoot);
  let confirmations = 0;
  await assert.rejects(promotePending(fx.workspaceRoot, async () => { confirmations += 1; return true; }, { expectedRoot: fx.expectedRoot }), /complete promotion preview exceeds/u);
  assert.equal(confirmations, 0);
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge")), { code: "ENOENT" });
  assert.deepEqual(await listPendingBytes(pendingRoot), before);
});

test("promoteKnowledgeCandidate stages and promotes one selected ID with one UI confirmation", async (t) => {
  const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
  const activeRoot = path.join(fx.agenticDir, "knowledge");
  await fs.mkdir(activeRoot);
  const index = "# Existing project router\n";
  await fs.writeFile(path.join(activeRoot, "INDEX.md"), index);
  const pi = await registerCapture(fx);
  const record = candidate({ id: "tool-promote-one", scope: fx.scope, title: "Tool promoted candidate" });
  const triage = await pi.tools.get("triageKnowledgeCandidates").execute("triage-tool-promote", {
    observations: [record],
    decisions: [decisionFor(record, "stage")],
  }, undefined, undefined, { cwd: fx.workspaceRoot });
  const staged = await pi.tools.get("stageKnowledgeCandidates").execute("stage-tool-promote", { reviewId: triage.details.reviewId }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.equal(staged.details.count, 1);

  const listTool = pi.tools.get("listPendingKnowledgeCandidates");
  assert.ok(listTool);
  const pendingList = await listTool.execute("list-pending", {}, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.deepEqual(pendingList.details.candidates.map(({ id }) => id), [record.id]);
  assert.equal("claim" in pendingList.details.candidates[0], false);
  assert.equal("evidence" in pendingList.details.candidates[0], false);

  const promoteTool = pi.tools.get("promoteKnowledgeCandidate");
  assert.ok(promoteTool);
  assert.equal(promoteTool.parameters.options.additionalProperties, false);
  assert.deepEqual(Object.keys(promoteTool.parameters.properties), ["id"]);
  const ui = uiContext(fx.workspaceRoot, [true]);
  const result = await promoteTool.execute("promote-tool-1", { id: record.id }, undefined, undefined, ui.ctx);
  assert.equal(ui.confirmations.length, 1);
  assert.equal(result.details.status, "active");
  assert.equal(result.details.pendingConsumed, true);
  assert.equal(await fs.readFile(path.join(activeRoot, "INDEX.md"), "utf8"), index);
  const read = await readKnowledge(fx.workspaceRoot, { id: record.id }, { expectedRoot: fx.expectedRoot });
  assert.equal(read.status, "ok");
  assert.equal(read.matches[0].scope, fx.scope);
  assert.equal(read.matches[0].status, "active");
  await assert.rejects(fs.lstat(path.join(fx.agenticDir, "knowledge-pending")), { code: "ENOENT" });
  const metricEvents = (await fs.readFile(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line).event);
  assert.deepEqual(metricEvents, ["candidate_staged", "decision_knowledge"]);
});

test("tool parameter schemas are closed and legacy pilot promotion confirms via one UI call", async (t) => {
  const fx = await fixture(t);
  await stageOne(fx);
  const pi = await registerCapture(fx);
  const stageTool = pi.tools.get("stageKnowledgeCandidates");
  const triageTool = pi.tools.get("triageKnowledgeCandidates");
  const readTool = pi.tools.get("readKnowledgeRecords");
  assert.deepEqual(Object.keys(readTool.parameters.properties), ["id", "query", "scope", "category"]);
  assert.equal(stageTool.parameters.options.additionalProperties, false);
  assert.deepEqual(Object.keys(stageTool.parameters.properties), ["reviewId"]);
  assert.equal(triageTool.parameters.options.additionalProperties, false);
  assert.equal(triageTool.parameters.properties.observations.options.maxItems, 20);
  assert.deepEqual(triageTool.parameters.properties.decisions.items.properties.disposition.values, ["stage", "transient", "merge", "needs-evidence", "unsafe/out-of-scope", "abstain"]);
  assert.deepEqual(triageTool.parameters.properties.observations.items.properties.category.options, { minLength: 1, maxLength: 80 });

  const ui = uiContext(fx.workspaceRoot, [true]);
  const result = await pi.tools.get("promoteKnowledgeBatch").execute("promote-1", {}, undefined, undefined, ui.ctx);
  assert.equal(ui.confirmations.length, 1);
  assert.match(ui.confirmations[0].message, /Review candidates before activation/u);
  assert.equal(result.details.promoted, true);
});

test("legacy candidates remain valid and correction retrieval resolves chains without predecessor bodies", async (t) => {
  const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
  const activeRoot = path.join(fx.agenticDir, "knowledge");
  const mapDir = path.join(activeRoot, "topic-map");
  await fs.mkdir(mapDir, { recursive: true });
  const index = "# Existing router\n";
  const map = "# Existing topic map\n";
  await fs.writeFile(path.join(activeRoot, "INDEX.md"), index);
  await fs.writeFile(path.join(mapDir, "INDEX.md"), map);
  const predecessor = { id: "legacy-predecessor", title: "Legacy predecessor", scope: "inventory/topic", body: "distinctive stale predecessor phrase" };
  const predecessorPath = await writeActiveRecord(fx, predecessor);
  const predecessorBytes = await fs.readFile(predecessorPath);

  const first = candidate({ id: "replacement-first", scope: fx.scope, title: "First correction", claim: "First replacement claim." });
  assert.equal(validateCandidate(first, fx.scope).status, "candidate", "the legacy candidate shape requires no supersedes key");
  await stageCandidates(fx.workspaceRoot, [first], { expectedRoot: fx.expectedRoot });
  const pi = await registerCapture(fx);
  const correctionTool = pi.tools.get("promoteKnowledgeCorrection");
  assert.ok(correctionTool);
  assert.equal(correctionTool.parameters.options.additionalProperties, false);
  assert.deepEqual(Object.keys(correctionTool.parameters.properties), ["id", "supersedes"]);
  const firstUi = uiContext(fx.workspaceRoot, [true]);
  const firstResult = await correctionTool.execute("correction-first", { id: first.id, supersedes: predecessor.id }, undefined, undefined, firstUi.ctx);
  assert.equal(firstUi.confirmations.length, 1);
  assert.match(firstUi.confirmations[0].message, /replacement-first supersedes legacy-predecessor/u);
  assert.match(firstUi.confirmations[0].message, /distinctive stale predecessor phrase/u);
  assert.match(firstUi.confirmations[0].message, /First replacement claim/u);
  assert.equal(firstResult.details.status, "active");
  assert.equal(firstResult.details.pendingConsumed, true);
  const firstFile = await fs.readFile(path.join(activeRoot, `${first.id}.md`), "utf8");
  assert.match(firstFile, /^supersedes: "legacy-predecessor"$/mu);
  assert.match(firstFile, /^scope: "inventory\/topic"$/mu, "replacement retains the predecessor's narrower scope");
  assert.equal(await fs.readFile(predecessorPath).then((value) => value.equals(predecessorBytes)), true);
  assert.equal(await fs.readFile(path.join(activeRoot, "INDEX.md"), "utf8"), index);
  assert.equal(await fs.readFile(path.join(mapDir, "INDEX.md"), "utf8"), map);

  const second = candidate({ id: "replacement-latest", scope: fx.scope, title: "Latest correction", claim: "latest replacement searchable marker" });
  await stageCandidates(fx.workspaceRoot, [second], { expectedRoot: fx.expectedRoot });
  const secondUi = uiContext(fx.workspaceRoot, [true]);
  await correctionTool.execute("correction-second", { id: second.id, supersedes: first.id }, undefined, undefined, secondUi.ctx);
  assert.equal(secondUi.confirmations.length, 1);

  const oldLookup = await readKnowledge(fx.workspaceRoot, { id: predecessor.id }, { expectedRoot: fx.expectedRoot });
  assert.equal(oldLookup.status, "ok");
  assert.equal(oldLookup.matches[0].id, second.id);
  assert.equal(oldLookup.matches[0].requestedId, predecessor.id);
  assert.equal(oldLookup.resolution.effectiveStatus, "superseded");
  assert.equal(oldLookup.resolution.replacementId, second.id);
  assert.equal(oldLookup.matches[0].content.includes("distinctive stale predecessor phrase"), false);
  const intermediateLookup = await readKnowledge(fx.workspaceRoot, { id: first.id }, { expectedRoot: fx.expectedRoot });
  assert.equal(intermediateLookup.matches[0].id, second.id);
  assert.equal(intermediateLookup.resolution.replacementId, second.id);

  const staleSearch = await readKnowledge(fx.workspaceRoot, { query: "distinctive stale predecessor phrase" }, { expectedRoot: fx.expectedRoot });
  assert.equal(staleSearch.status, "no_match");
  assert.equal(staleSearch.complete, true);
  const currentSearch = await readKnowledge(fx.workspaceRoot, { query: "latest replacement searchable marker" }, { expectedRoot: fx.expectedRoot });
  assert.equal(currentSearch.status, "ok");
  assert.deepEqual(currentSearch.matches.map(({ id }) => id), [second.id]);

  const readTool = pi.tools.get("readKnowledgeRecords");
  const toolLookup = await readTool.execute("correction-old-lookup", { id: predecessor.id }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.equal(toolLookup.details.resolution.replacementId, second.id);
  assert.equal(toolLookup.details.matches[0].id, second.id);
  assert.equal(toolLookup.details.matches[0].supersedes, first.id);
  const toolSearch = await readTool.execute("correction-replacement-search", {
    query: "latest replacement searchable marker",
  }, undefined, undefined, { cwd: fx.workspaceRoot });
  assert.equal(toolSearch.details.status, "ok");
  assert.deepEqual(toolSearch.details.matches.map(({ id }) => id), [second.id]);
  const metrics = await waitForMetricEvents(fx.workspaceRoot, 4);
  assert.deepEqual(metrics, ["decision_knowledge", "decision_knowledge", "retrieval_success", "retrieval_success"]);
  assert.equal(await fs.readFile(path.join(activeRoot, "INDEX.md"), "utf8"), index);
  assert.equal(await fs.readFile(path.join(mapDir, "INDEX.md"), "utf8"), map);
});

test("correction rejects missing, out-of-scope, already-superseded, and colliding targets without mutation", async (t) => {
  const cases = [
    { name: "missing", target: "missing-target", setup: async () => {}, pattern: /missing, inactive, or out of scope/u },
    { name: "self-target", target: "candidate-self-target", setup: async () => {}, pattern: /cannot supersede itself/u },
    { name: "wrong-scope", target: "foreign-target", setup: async (fx) => writeActiveRecord(fx, { id: "foreign-target", scope: "project:other-project" }), pattern: /missing, inactive, or out of scope/u },
    { name: "already-superseded", target: "old-target", setup: async (fx) => {
      await writeActiveRecord(fx, { id: "old-target" });
      await writeActiveRecord(fx, { id: "current-target", supersedes: "old-target" });
    }, pattern: /already superseded/u },
  ];
  for (const scenario of cases) {
    const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
    await fs.mkdir(path.join(fx.agenticDir, "knowledge"), { recursive: true });
    await scenario.setup(fx);
    const replacement = candidate({ id: `candidate-${scenario.name}`, scope: fx.scope });
    await stageCandidates(fx.workspaceRoot, [replacement], { expectedRoot: fx.expectedRoot });
    const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
    const pendingBefore = await listPendingBytes(pendingRoot);
    const pi = await registerCapture(fx);
    const ui = uiContext(fx.workspaceRoot, [true]);
    await assert.rejects(pi.tools.get("promoteKnowledgeCorrection").execute(`reject-${scenario.name}`, {
      id: replacement.id,
      supersedes: scenario.target,
    }, undefined, undefined, ui.ctx), scenario.pattern, scenario.name);
    assert.equal(ui.confirmations.length, 0, `${scenario.name} must fail before confirmation`);
    assert.deepEqual(await listPendingBytes(pendingRoot), pendingBefore, `${scenario.name} preserves pending bytes`);
    assert.equal(await fs.stat(path.join(fx.agenticDir, "knowledge", `${replacement.id}.md`)).then(() => true, () => false), false);
    await assert.rejects(fs.lstat(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl")), { code: "ENOENT" });
  }

  const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
  await fs.mkdir(path.join(fx.agenticDir, "knowledge"), { recursive: true });
  await writeActiveRecord(fx, { id: "collision-target" });
  const replacement = candidate({ id: "late-id-collision", scope: fx.scope });
  await stageCandidates(fx.workspaceRoot, [replacement], { expectedRoot: fx.expectedRoot });
  await writeActiveRecord(fx, { id: replacement.id });
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const pendingBefore = await listPendingBytes(pendingRoot);
  const pi = await registerCapture(fx);
  const ui = uiContext(fx.workspaceRoot, [true]);
  await assert.rejects(pi.tools.get("promoteKnowledgeCorrection").execute("correction-collision", {
    id: replacement.id,
    supersedes: "collision-target",
  }, undefined, undefined, ui.ctx), /active record ID collision/u);
  assert.equal(ui.confirmations.length, 0);
  assert.deepEqual(await listPendingBytes(pendingRoot), pendingBefore);
  await assert.rejects(fs.lstat(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl")), { code: "ENOENT" });
});

test("correction UI rejection and injected publish failure preserve active and pending bytes without metrics", async (t) => {
  for (const mode of ["rejection", "publish-failure"]) {
    const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
    const activeRoot = path.join(fx.agenticDir, "knowledge");
    const mapDir = path.join(activeRoot, "topic-map");
    await fs.mkdir(mapDir, { recursive: true });
    const index = "# Protected index\n";
    const map = "# Protected map\n";
    await fs.writeFile(path.join(activeRoot, "INDEX.md"), index);
    await fs.writeFile(path.join(mapDir, "INDEX.md"), map);
    const predecessorPath = await writeActiveRecord(fx, { id: `predecessor-${mode}`, body: "predecessor bytes stay unchanged" });
    const predecessorBytes = await fs.readFile(predecessorPath);
    const replacement = candidate({ id: `replacement-${mode}`, scope: fx.scope });
    await stageCandidates(fx.workspaceRoot, [replacement], { expectedRoot: fx.expectedRoot });
    const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
    const pendingBefore = await listPendingBytes(pendingRoot);
    const hooks = mode === "publish-failure" ? { beforePublish: async () => { throw new Error("injected correction publish failure"); } } : {};
    const pi = await registerCapture(fx, { hooks });
    const ui = uiContext(fx.workspaceRoot, [mode !== "rejection"]);
    const invoke = pi.tools.get("promoteKnowledgeCorrection").execute(`correction-${mode}`, {
      id: replacement.id,
      supersedes: `predecessor-${mode}`,
    }, undefined, undefined, ui.ctx);
    if (mode === "rejection") {
      const result = await invoke;
      assert.equal(result.details.status, "rejected");
    } else {
      await assert.rejects(invoke, /injected correction publish failure/u);
    }
    assert.equal(ui.confirmations.length, 1);
    assert.match(ui.confirmations[0].message, /predecessor bytes stay unchanged/u);
    assert.equal(await fs.readFile(predecessorPath).then((value) => value.equals(predecessorBytes)), true);
    assert.equal(await fs.readFile(path.join(activeRoot, "INDEX.md"), "utf8"), index);
    assert.equal(await fs.readFile(path.join(mapDir, "INDEX.md"), "utf8"), map);
    assert.deepEqual(await listPendingBytes(pendingRoot), pendingBefore);
    await assert.rejects(fs.lstat(path.join(activeRoot, `${replacement.id}.md`)), { code: "ENOENT" });
    await assert.rejects(fs.lstat(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl")), { code: "ENOENT" });
  }
});

test("post-publish correction cleanup warning retains committed-success semantics", async (t) => {
  const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
  const activeRoot = path.join(fx.agenticDir, "knowledge");
  await fs.mkdir(activeRoot, { recursive: true });
  const predecessorPath = await writeActiveRecord(fx, { id: "cleanup-predecessor" });
  const predecessorBytes = await fs.readFile(predecessorPath);
  const replacement = candidate({ id: "cleanup-replacement", scope: fx.scope });
  await stageCandidates(fx.workspaceRoot, [replacement], { expectedRoot: fx.expectedRoot });
  const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
  const pendingBefore = await listPendingBytes(pendingRoot);
  const pi = await registerCapture(fx, { hooks: { beforePendingConsume: async () => { throw new Error("injected cleanup warning"); } } });
  const ui = uiContext(fx.workspaceRoot, [true]);
  const result = await pi.tools.get("promoteKnowledgeCorrection").execute("correction-cleanup-warning", {
    id: replacement.id,
    supersedes: "cleanup-predecessor",
  }, undefined, undefined, ui.ctx);
  assert.equal(result.details.status, "active");
  assert.equal(result.details.pendingConsumed, false);
  assert.match(result.details.warnings.join(" "), /injected cleanup warning/u);
  assert.equal(await fs.readFile(predecessorPath).then((value) => value.equals(predecessorBytes)), true);
  assert.ok((await fs.stat(path.join(activeRoot, `${replacement.id}.md`))).isFile());
  assert.deepEqual(await listPendingBytes(pendingRoot), pendingBefore);
  const events = (await fs.readFile(path.join(fx.workspaceRoot, ".pi", "metrics", "agenticlab.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line).event);
  assert.deepEqual(events, ["decision_knowledge"]);
});

test("correction rejects branching and cyclic graphs and retrieval fails closed", async (t) => {
  const cases = [
    { name: "branch", records: [
      { id: "branch-root" },
      { id: "branch-left", supersedes: "branch-root" },
      { id: "branch-right", supersedes: "branch-root" },
    ], pattern: /multiple records supersede/u },
    { name: "cycle", records: [
      { id: "cycle-left", supersedes: "cycle-right" },
      { id: "cycle-right", supersedes: "cycle-left" },
    ], pattern: /cycle detected/u },
  ];
  for (const scenario of cases) {
    const fx = await fixture(t, { scope: "project:post-integration-delivery", pendingStagingEnabled: true });
    await fs.mkdir(path.join(fx.agenticDir, "knowledge"), { recursive: true });
    for (const record of scenario.records) await writeActiveRecord(fx, record);
    const read = await readKnowledge(fx.workspaceRoot, { query: "anything" }, { expectedRoot: fx.expectedRoot });
    assert.equal(read.status, "incomplete", `${scenario.name} graph must fail closed`);
    assert.equal(read.matches.length, 0);
    assert.equal(JSON.stringify(read).includes("# " + scenario.records[0].id), false);

    const replacement = candidate({ id: `candidate-${scenario.name}`, scope: fx.scope });
    await stageCandidates(fx.workspaceRoot, [replacement], { expectedRoot: fx.expectedRoot });
    const pendingRoot = path.join(fx.agenticDir, "knowledge-pending");
    const pendingBefore = await listPendingBytes(pendingRoot);
    const pi = await registerCapture(fx);
    const ui = uiContext(fx.workspaceRoot, [true]);
    await assert.rejects(pi.tools.get("promoteKnowledgeCorrection").execute(`graph-${scenario.name}`, {
      id: replacement.id,
      supersedes: scenario.records[0].id,
    }, undefined, undefined, ui.ctx), scenario.pattern);
    assert.equal(ui.confirmations.length, 0);
    assert.deepEqual(await listPendingBytes(pendingRoot), pendingBefore);
  }
});
