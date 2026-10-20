import {
  classifyKnowledgeMutation,
  classifyPendingAccess,
  classifyPilotPolicyMutation,
  captureTransactionLocked,
  decideKnowledgeMutation,
  shellReferencesKnowledge,
  formatKnowledgeConfirmation,
} from "./knowledge-write-policy.mjs";

export function registerKnowledgeWriteGate(pi) {
  pi.on("user_bash", async (event, ctx) => {
    if (!await shellReferencesKnowledge(ctx.cwd, event.command)) return undefined;
    return {
      result: {
        output: "Blocked shell access to AgenticLab project knowledge, the private pending queue, or pilot capture policy.",
        exitCode: 126,
        cancelled: false,
        truncated: false,
      },
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const command = event.input?.command;
    if ((event.toolName === "bash" || event.toolName === "user_bash") && await shellReferencesKnowledge(ctx.cwd, command)) {
      return {
        block: true,
        reason: "Shell access to AgenticLab project knowledge, the private pending queue, and pilot capture policy is blocked.",
      };
    }

    const pendingAccess = await classifyPendingAccess(event.toolName, event.input, ctx.cwd);
    if (pendingAccess) return { block: true, reason: pendingAccess.reason };

    const policyMutation = await classifyPilotPolicyMutation(event.toolName, event.input, ctx.cwd);
    if (policyMutation) {
      return {
        block: true,
        reason: "Pilot capture policy and promotion state are tool-managed; direct built-in writes and edits are blocked.",
      };
    }

    const request = classifyKnowledgeMutation(event.toolName, event.input, ctx.cwd);
    if (!request) return undefined;

    if (request.preview === null) {
      return {
        block: true,
        reason: "A reviewable preview could not be built for this project knowledge change; it was blocked.",
      };
    }

    if (await captureTransactionLocked(ctx.cwd)) {
      return { block: true, reason: "An atomic pilot knowledge transaction is in progress; active knowledge writes are temporarily blocked." };
    }

    if (!ctx.hasUI) {
      const decision = decideKnowledgeMutation(request, false, false);
      return { block: true, reason: decision.reason };
    }

    let approved = false;
    try {
      approved = await ctx.ui.confirm(
        "Confirm persistent AgenticLab knowledge change",
        formatKnowledgeConfirmation(request),
      );
    } catch {
      // Fail closed if the host UI cannot complete the confirmation.
      return { block: true, reason: "Project knowledge confirmation was unavailable; change blocked." };
    }

    const decision = decideKnowledgeMutation(request, true, approved);
    if (!decision.allow) return { block: true, reason: decision.reason };
    if (await captureTransactionLocked(ctx.cwd)) {
      return { block: true, reason: "An atomic pilot knowledge transaction began during confirmation; active knowledge write blocked." };
    }
    return undefined;
  });
}
