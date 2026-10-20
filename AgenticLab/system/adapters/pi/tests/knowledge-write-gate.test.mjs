import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyKnowledgeMutation,
  decideKnowledgeMutation,
  shellReferencesKnowledge,
} from "../knowledge-write-policy.mjs";
import { registerKnowledgeWriteGate } from "../knowledge-write-gate.mjs";

const cwd = "/tmp/agenticlab-gate-fixture";

function makePi() {
  let handler;
  return {
    pi: {
      on(eventName, callback) {
        assert.equal(eventName, "tool_call");
        handler = callback;
      },
    },
    call(event, ctx) {
      assert.ok(handler, "gate registered its tool_call handler");
      return handler(event, ctx);
    },
  };
}

test("file writes to project knowledge require confirmation", () => {
  const request = classifyKnowledgeMutation("write", {
    path: "AgenticLab/knowledge/decisions/date-format.md",
    content: "Synthetic fixture only",
  }, cwd);
  assert.equal(request?.kind, "file-tool");
  assert.equal(request?.target, `${cwd}/AgenticLab/knowledge/decisions/date-format.md`);
  assert.match(request?.preview, /Synthetic fixture only/);
});

test("current Pi edits[] input produces a before-and-after preview", () => {
  const request = classifyKnowledgeMutation("edit", {
    path: "AgenticLab/knowledge/INDEX.md",
    edits: [{ oldText: "No records yet", newText: "One record listed" }],
  }, cwd);
  assert.match(request?.preview, /--- existing text ---\nNo records yet/);
  assert.match(request?.preview, /\+\+\+ proposed text \+\+\+\nOne record listed/);
});

test("writes outside project knowledge and path traversal are not classified as memory writes", () => {
  assert.equal(classifyKnowledgeMutation("write", { path: "src/controller.py" }, cwd), null);
  assert.equal(
    classifyKnowledgeMutation("edit", { path: "AgenticLab/knowledge/../../src/controller.py" }, cwd),
    null,
  );
});

test("shell commands that visibly reference project knowledge are detected for blocking", () => {
  const command = "find AgenticLab/knowledge -maxdepth 2 -type f";
  assert.equal(shellReferencesKnowledge(cwd, command), true);
  assert.equal(classifyKnowledgeMutation("bash", { command }, cwd), null);
});

test("unrelated tools and shell commands pass without a confirmation prompt", () => {
  assert.equal(classifyKnowledgeMutation("read", { path: "AgenticLab/knowledge/INDEX.md" }, cwd), null);
  assert.equal(classifyKnowledgeMutation("bash", { command: "python -m unittest" }, cwd), null);
  assert.deepEqual(decideKnowledgeMutation(null, false, false), { allow: true });
});

test("approval decision fails closed without UI or after rejection", () => {
  const request = classifyKnowledgeMutation("write", { path: "AgenticLab/knowledge/INDEX.md" }, cwd);
  assert.equal(decideKnowledgeMutation(request, false, false).allow, false);
  assert.equal(decideKnowledgeMutation(request, true, false).allow, false);
  assert.equal(decideKnowledgeMutation(request, true, true).allow, true);
});

test("Pi handler blocks knowledge writes without UI", async () => {
  const mock = makePi();
  registerKnowledgeWriteGate(mock.pi);
  const result = await mock.call(
    { toolName: "write", input: { path: "AgenticLab/knowledge/INDEX.md", content: "fixture" } },
    { cwd, hasUI: false },
  );
  assert.equal(result?.block, true);
  assert.match(result?.reason, /interactive user confirmation/);
});

test("Pi handler asks and blocks when the user rejects", async () => {
  const mock = makePi();
  let shown = "";
  registerKnowledgeWriteGate(mock.pi);
  const result = await mock.call(
    {
      toolName: "edit",
      input: {
        path: "AgenticLab/knowledge/INDEX.md",
        edits: [{ oldText: "old fixture", newText: "new fixture" }],
      },
    },
    {
      cwd,
      hasUI: true,
      ui: { async confirm(title, message) { shown = `${title}\n${message}`; return false; } },
    },
  );
  assert.equal(result?.block, true);
  assert.match(shown, /AgenticLab\/knowledge\/INDEX\.md/);
  assert.match(shown, /old fixture/);
  assert.match(shown, /new fixture/);
});

test("Pi handler blocks a knowledge edit if it cannot build a preview", async () => {
  const mock = makePi();
  let confirmationRequested = false;
  registerKnowledgeWriteGate(mock.pi);
  const result = await mock.call(
    { toolName: "edit", input: { path: "AgenticLab/knowledge/INDEX.md", edits: [{ unexpected: "shape" }] } },
    {
      cwd,
      hasUI: true,
      ui: { async confirm() { confirmationRequested = true; return true; } },
    },
  );
  assert.equal(result?.block, true);
  assert.equal(confirmationRequested, false);
  assert.match(result?.reason, /reviewable preview could not be built/);
});

test("Pi handler blocks shell access to knowledge without a misleading approval prompt", async () => {
  const mock = makePi();
  let confirmationRequested = false;
  registerKnowledgeWriteGate(mock.pi);
  const result = await mock.call(
    { toolName: "bash", input: { command: "find AgenticLab/knowledge -maxdepth 2 -type f" } },
    { cwd, hasUI: true, ui: { async confirm() { confirmationRequested = true; return true; } } },
  );
  assert.equal(result?.block, true);
  assert.equal(confirmationRequested, false);
  assert.match(result?.reason, /Use Pi's read tool/);
});

test("Pi handler blocks if confirmation UI fails", async () => {
  const mock = makePi();
  registerKnowledgeWriteGate(mock.pi);
  const result = await mock.call(
    { toolName: "write", input: { path: "AgenticLab/knowledge/INDEX.md", content: "fixture" } },
    { cwd, hasUI: true, ui: { async confirm() { throw new Error("UI unavailable"); } } },
  );
  assert.equal(result?.block, true);
  assert.match(result?.reason, /confirmation was unavailable/);
});

test("Pi handler allows a confirmed knowledge change", async () => {
  const mock = makePi();
  registerKnowledgeWriteGate(mock.pi);
  const result = await mock.call(
    { toolName: "write", input: { path: "AgenticLab/knowledge/INDEX.md", content: "fixture" } },
    { cwd, hasUI: true, ui: { async confirm() { return true; } } },
  );
  assert.equal(result, undefined);
});
