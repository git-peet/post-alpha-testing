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
  promotePending,
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

async function fixture(t) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "alpha-knowledge-pilot-"));
  const agenticDir = path.join(workspaceRoot, "AgenticLab");
  await fs.mkdir(agenticDir);
  const policyPath = path.join(agenticDir, "knowledge-capture-policy.json");
  await fs.writeFile(policyPath, `${JSON.stringify({
    schemaVersion: 1,
    project: PILOT_PROJECT,
    workspaceRoot,
    pendingStagingEnabled: false,
  }, null, 2)}\n`);
  t.after(async () => fs.rm(workspaceRoot, { recursive: true, force: true }));
  return { workspaceRoot, agenticDir, policyPath, expectedRoot: workspaceRoot };
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

function policy(enabled, workspaceRoot) {
  return {
    schemaVersion: 1,
    project: PILOT_PROJECT,
    workspaceRoot,
    pendingStagingEnabled: enabled,
  };
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
  assert.equal((await getCapturePolicy(fx.workspaceRoot, { expectedRoot: fx.expectedRoot })).pendingStagingEnabled, true);
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

test("stage triage rejects wrong-scope and unsupported records, while out-of-scope observations remain advisory", async (t) => {
  const fx = await fixture(t);
  const pi = await registerCapture(fx);
  const triage = pi.tools.get("triageKnowledgeCandidates");
  const wrongScope = candidate({ id: "wrong-scope-record", scope: "project:OTHER" });
  await assert.rejects(triage.execute("triage-scope", { observations: [wrongScope], decisions: [decisionFor(wrongScope, "stage")] }, undefined, undefined, { cwd: fx.workspaceRoot }), /scope/u);
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
  await assert.rejects(stageCandidates(fx.workspaceRoot, overflow, { expectedRoot: fx.expectedRoot }), /limited to 20 candidates/u);
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
  assert.match(activeRecord, /\*\*Status:\*\* active/u);
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

test("existing active root and cross-batch ID collisions abort before confirmation", async (t) => {
  const stageFx = await fixture(t);
  await enableCapture(stageFx);
  await fs.mkdir(path.join(stageFx.agenticDir, "knowledge"));
  await assert.rejects(stageCandidates(stageFx.workspaceRoot, [candidate()], { expectedRoot: stageFx.expectedRoot }), /already exists/u);
  await assert.rejects(fs.lstat(path.join(stageFx.agenticDir, "knowledge-pending")), { code: "ENOENT" });

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
  const fx = await fixture(t);
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

test("tool parameter schemas are closed and promotion confirms via one UI call", async (t) => {
  const fx = await fixture(t);
  await stageOne(fx);
  const pi = await registerCapture(fx);
  const stageTool = pi.tools.get("stageKnowledgeCandidates");
  const triageTool = pi.tools.get("triageKnowledgeCandidates");
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
