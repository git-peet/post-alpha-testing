import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordKnowledgeCaptureMetric } from "../knowledge-capture-metrics.mjs";

async function makeWorkspace(metricsEnabled) {
  const root = await mkdtemp(path.join(os.tmpdir(), "evershop-metrics-"));
  await mkdir(path.join(root, "AgenticLab"), { recursive: true });
  await writeFile(
    path.join(root, "AgenticLab", "knowledge-capture-policy.json"),
    JSON.stringify({ metricsEnabled })
  );
  return root;
}

test("writes only the allowlisted event and timestamp when metrics are enabled", async () => {
  const root = await makeWorkspace(true);
  try {
    const result = await recordKnowledgeCaptureMetric("candidate_staged", { workspaceRoot: root });
    assert.deepEqual(result, { recorded: true });
    const lines = (await readFile(path.join(root, ".pi", "metrics", "agenticlab.jsonl"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.event, "candidate_staged");
    assert.equal(typeof event.occurredAt, "string");
    assert.deepEqual(Object.keys(event).sort(), ["event", "occurredAt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("allows inventory decision and retrieval events without payload fields", async () => {
  const root = await makeWorkspace(true);
  try {
    for (const eventName of ["decision_knowledge", "retrieval_success"]) {
      await recordKnowledgeCaptureMetric(eventName, { workspaceRoot: root });
    }
    const lines = (await readFile(path.join(root, ".pi", "metrics", "agenticlab.jsonl"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(lines.length, 2);
    for (const line of lines) {
      const event = JSON.parse(line);
      assert.ok(["decision_knowledge", "retrieval_success"].includes(event.event));
      assert.deepEqual(Object.keys(event).sort(), ["event", "occurredAt"]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not write when metrics are disabled", async () => {
  const root = await makeWorkspace(false);
  try {
    const result = await recordKnowledgeCaptureMetric("candidate_staged", { workspaceRoot: root });
    assert.deepEqual(result, { recorded: false, reason: "metrics-disabled" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects every event outside the approved event allowlist", async () => {
  const root = await makeWorkspace(true);
  try {
    await assert.rejects(
      recordKnowledgeCaptureMetric("promotion_approved", { workspaceRoot: root }),
      /unsupported knowledge-capture metric event/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
