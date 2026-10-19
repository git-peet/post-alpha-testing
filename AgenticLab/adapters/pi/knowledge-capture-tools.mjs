import { randomUUID } from "node:crypto";
import {
  containsSensitiveValue,
  getCapturePolicy,
  MAX_CANDIDATES,
  MAX_RECORD_BYTES,
  PILOT_PROJECT,
  PILOT_SCOPE,
  PILOT_WORKSPACE_ROOT,
  promotePending,
  setCaptureEnabled,
  stageCandidates,
  validateCandidate,
  validateCandidateBatch,
} from "./knowledge-capture-core.mjs";

const REVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_REVIEWS = 32;
const DISPOSITIONS = ["stage", "transient", "merge", "needs-evidence", "unsafe/out-of-scope", "abstain"];
const DISPOSITION_SET = new Set(DISPOSITIONS);
const REVIEW_ID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const RECORD_KEYS = ["id", "title", "category", "scope", "status", "source", "evidence", "recorded", "verified", "claim", "rationale"];

function textResult(text, details) {
  return { content: [{ type: "text", text }], details };
}

function literal(Type, value) {
  return Type.Literal(value);
}

function requireBoundedText(value, label, maxLength, { multiline = false } = {}) {
  const invalidControl = typeof value === "string" && /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.length > maxLength || invalidControl || (!multiline && /[\r\n]/u.test(value))) {
    throw new Error(`${label} must be a trimmed string of at most ${maxLength} characters`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validateObservation(observation) {
  if (!isPlainObject(observation) || !hasOnlyKeys(observation, RECORD_KEYS) || RECORD_KEYS.some((key) => !(key in observation))) {
    throw new Error("candidate observation has an invalid shape");
  }
  if (typeof observation.id !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(observation.id)) {
    throw new Error("candidate observation id must be a lowercase, path-safe identifier");
  }
  requireBoundedText(observation.title, "title", 160);
  requireBoundedText(observation.category, "category", 80);
  requireBoundedText(observation.scope, "scope", 160);
  requireBoundedText(observation.status, "status", 64);
  if (!isPlainObject(observation.source) || !hasOnlyKeys(observation.source, ["kind", "reference", "revision"]) || !("kind" in observation.source) || !("reference" in observation.source)) {
    throw new Error(`candidate ${observation.id} has an invalid source object`);
  }
  requireBoundedText(observation.source.kind, "source.kind", 48);
  requireBoundedText(observation.source.reference, "source.reference", 300);
  if (observation.source.revision !== undefined) requireBoundedText(observation.source.revision, "source.revision", 160);
  requireBoundedText(observation.evidence, "evidence", 1200, { multiline: true });
  requireBoundedText(observation.recorded, "recorded", 32);
  requireBoundedText(observation.verified, "verified", 32);
  requireBoundedText(observation.claim, "claim", 3000, { multiline: true });
  requireBoundedText(observation.rationale, "rationale", 1200, { multiline: true });

  const serialized = JSON.stringify(observation);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) throw new Error(`candidate ${observation.id} exceeds ${MAX_RECORD_BYTES} bytes`);
  if (/knowledge-pending/iu.test(serialized)) throw new Error(`candidate ${observation.id} cannot link to the private pending queue`);
  if (containsSensitiveValue(serialized)) throw new Error(`candidate ${observation.id} contains a value matching a sensitive-data pattern`);
  return observation;
}

function validateDecision(decision) {
  const allowedKeys = ["id", "disposition", "rationale", "missingEvidence", "uncertainty"];
  if (!isPlainObject(decision) || !hasOnlyKeys(decision, allowedKeys) || !["id", "disposition", "rationale"].every((key) => key in decision)) {
    throw new Error("triage decision has an invalid shape");
  }
  if (typeof decision.id !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(decision.id)) {
    throw new Error("triage decision id must be a lowercase, path-safe identifier");
  }
  if (!DISPOSITION_SET.has(decision.disposition)) throw new Error(`decision ${decision.id} has an unsupported disposition`);
  requireBoundedText(decision.rationale, "decision rationale", 500);
  if (decision.missingEvidence !== undefined) requireBoundedText(decision.missingEvidence, "missingEvidence", 800);
  if (decision.uncertainty !== undefined) requireBoundedText(decision.uncertainty, "uncertainty", 500);
  return decision;
}

function validateTriageRequest(params) {
  if (!isPlainObject(params) || !hasOnlyKeys(params, ["observations", "decisions"]) || !Array.isArray(params.observations) || !Array.isArray(params.decisions)) {
    throw new Error("triage request must contain only observations and decisions arrays");
  }
  if (params.observations.length === 0 || params.observations.length > MAX_CANDIDATES || params.decisions.length !== params.observations.length) {
    throw new Error(`triage requires 1-${MAX_CANDIDATES} observations and exactly one decision per observation`);
  }

  const observations = params.observations.map(validateObservation);
  const observationsById = new Map();
  for (const observation of observations) {
    if (observationsById.has(observation.id)) throw new Error(`duplicate candidate id: ${observation.id}`);
    observationsById.set(observation.id, observation);
  }

  const decisions = params.decisions.map(validateDecision);
  const decisionsById = new Map();
  for (const decision of decisions) {
    if (decisionsById.has(decision.id)) throw new Error(`duplicate decision id: ${decision.id}`);
    if (!observationsById.has(decision.id)) throw new Error(`decision id ${decision.id} has no matching candidate observation`);
    decisionsById.set(decision.id, decision);
  }
  for (const observation of observations) {
    const decision = decisionsById.get(observation.id);
    if (!decision) throw new Error(`candidate ${observation.id} is missing a triage decision`);
    if (decision.disposition === "stage") validateCandidate(observation);
  }

  const stageable = observations.filter((observation) => decisionsById.get(observation.id).disposition === "stage");
  if (stageable.length) validateCandidateBatch(stageable);
  return { observations, decisions };
}

function buildObservationSchema(Type) {
  return Type.Object({
    id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$" }),
    title: Type.String({ minLength: 1, maxLength: 160 }),
    category: Type.String({ minLength: 1, maxLength: 80 }),
    scope: Type.String({ minLength: 1, maxLength: 160 }),
    status: Type.String({ minLength: 1, maxLength: 64 }),
    source: Type.Object({
      kind: Type.String({ minLength: 1, maxLength: 48 }),
      reference: Type.String({ minLength: 1, maxLength: 300 }),
      revision: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    }, { additionalProperties: false }),
    evidence: Type.String({ minLength: 1, maxLength: 1200 }),
    recorded: Type.String({ minLength: 1, maxLength: 32 }),
    verified: Type.String({ minLength: 1, maxLength: 32 }),
    claim: Type.String({ minLength: 1, maxLength: 3000 }),
    rationale: Type.String({ minLength: 1, maxLength: 1200 }),
  }, { additionalProperties: false });
}

function buildDecisionSchema(Type, StringEnum) {
  return Type.Object({
    id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$" }),
    disposition: StringEnum(DISPOSITIONS),
    rationale: Type.String({ minLength: 1, maxLength: 500 }),
    missingEvidence: Type.Optional(Type.String({ minLength: 1, maxLength: 800 })),
    uncertainty: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  }, { additionalProperties: false });
}

function notify(ctx, message, level = "info") {
  if (ctx?.hasUI && typeof ctx.ui?.notify === "function") ctx.ui.notify(message, level);
}

async function askOnce(ctx, title, message) {
  if (!ctx?.hasUI || typeof ctx.ui?.confirm !== "function") throw new Error("This operation requires an available Pi UI confirmation");
  return ctx.ui.confirm(title, message);
}

function pruneReviews(reviews, timestamp, ttlMs) {
  for (const [reviewId, review] of reviews) {
    if (timestamp - review.createdAt > ttlMs) reviews.delete(reviewId);
  }
  if (reviews.size >= MAX_REVIEWS) throw new Error("transient triage review capacity is full; retry after reviews expire");
}

export function registerKnowledgeCaptureTools(pi, Type, StringEnum, { expectedRoot = PILOT_WORKSPACE_ROOT, hooks = {}, now = () => Date.now(), reviewTtlMs = REVIEW_TTL_MS } = {}) {
  if (!Type?.Object || !Type?.String || !Type?.Literal || !Type?.Array || !Type?.Optional || typeof StringEnum !== "function") {
    throw new Error("A compatible Pi TypeBox and StringEnum API is required to register pilot knowledge tools");
  }
  if (typeof now !== "function" || !Number.isSafeInteger(reviewTtlMs) || reviewTtlMs <= 0) {
    throw new Error("transient triage review clock and expiry must be valid");
  }

  const reviews = new Map();
  const observationSchema = buildObservationSchema(Type);
  const decisionSchema = buildDecisionSchema(Type, StringEnum);

  pi.registerTool({
    name: "triageKnowledgeCandidates",
    label: "Triage knowledge candidates",
    description: "Validate a bounded ALPHA-KNOWLEDGE-PILOT-001 candidate-observation set and exactly one structured Jev-style advisory decision per candidate. This tool performs no writes; it stores the validated review only in extension memory under a temporary reviewId.",
    parameters: Type.Object({
      observations: Type.Array(observationSchema, { minItems: 1, maxItems: MAX_CANDIDATES }),
      decisions: Type.Array(decisionSchema, { minItems: 1, maxItems: MAX_CANDIDATES }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { observations, decisions } = validateTriageRequest(params);
      const timestamp = now();
      pruneReviews(reviews, timestamp, reviewTtlMs);
      const reviewId = randomUUID();
      const copiedObservations = observations.map((observation) => JSON.parse(JSON.stringify(observation)));
      const copiedDecisions = decisions.map((decision) => JSON.parse(JSON.stringify(decision)));
      reviews.set(reviewId, {
        createdAt: timestamp,
        inUse: false,
        observations: copiedObservations,
        decisions: copiedDecisions,
      });
      const summary = {
        reviewId,
        decisions: copiedDecisions.map((decision) => ({ ...decision })),
        expiresInMs: reviewTtlMs,
      };
      return textResult(JSON.stringify(summary), summary);
    },
  });

  pi.registerTool({
    name: "stageKnowledgeCandidates",
    label: "Stage reviewed knowledge candidates",
    description: "Stage only candidate records whose stored, validated transient triage review has disposition stage. Accepts a reviewId only; default-off workspace opt-in is still required. Never provide raw records or treat pending items as approved knowledge.",
    parameters: Type.Object({
      reviewId: Type.String({ minLength: 36, maxLength: 36, pattern: REVIEW_ID_PATTERN }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isPlainObject(params) || !hasOnlyKeys(params, ["reviewId"])) throw new Error("stage tool accepts only a reviewId");
      const reviewId = params.reviewId;
      if (typeof reviewId !== "string" || !new RegExp(REVIEW_ID_PATTERN, "u").test(reviewId)) throw new Error("reviewId is missing or invalid");
      const review = reviews.get(reviewId);
      if (!review) throw new Error("reviewId is missing or expired");
      if (now() - review.createdAt > reviewTtlMs) {
        reviews.delete(reviewId);
        throw new Error("reviewId is missing or expired");
      }
      if (review.inUse) throw new Error("reviewId is already being staged");

      const decisionsById = new Map(review.decisions.map((decision) => [decision.id, decision]));
      const stageRecords = review.observations.filter((observation) => decisionsById.get(observation.id)?.disposition === "stage");
      if (stageRecords.length === 0) {
        return textResult(JSON.stringify({ reviewId, staged: false, count: 0, reason: "No candidates were triaged as stage." }), {
          reviewId,
          staged: false,
          count: 0,
          reason: "No candidates were triaged as stage.",
        });
      }

      review.inUse = true;
      try {
        const policy = await getCapturePolicy(ctx.cwd, { expectedRoot });
        if (!policy.pendingStagingEnabled) throw new Error("pending staging is disabled; triage remains transient");
        const eligibleRecords = validateCandidateBatch(stageRecords);
        const result = await stageCandidates(ctx.cwd, eligibleRecords, { expectedRoot });
        reviews.delete(reviewId);
        const details = { ...result, reviewId, stagedIds: eligibleRecords.map((record) => record.id) };
        return textResult(`Staged ${result.count} reviewed candidate record(s) in the private pending queue. They remain inactive and are not approved knowledge.`, details);
      } catch (error) {
        review.inUse = false;
        throw error;
      }
    },
  });

  pi.registerTool({
    name: "promoteKnowledgeBatch",
    label: "Review and promote pending knowledge batch",
    description: "Review every pending ALPHA-KNOWLEDGE-PILOT-001 candidate as one complete batch. Requires UI confirmation, refuses any existing active knowledge root, and never merges or repeats promotion.",
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!ctx?.hasUI || typeof ctx.ui?.confirm !== "function") throw new Error("Batch promotion requires an available Pi UI confirmation");
      const result = await promotePending(ctx.cwd, (preview) => ctx.ui.confirm(
        "Promote ALPHA-KNOWLEDGE-PILOT-001 batch?",
        preview,
      ), { expectedRoot, hooks });
      if (!result.promoted) return textResult("Promotion was rejected. Pending candidates were left unchanged; no active knowledge was created.", result);
      const warnings = result.warnings.length ? ` Warnings: ${result.warnings.join(" ")}` : " The promoted pending queue was consumed.";
      return textResult(`Promotion committed: ${result.count} record(s) are active as one approved batch.${warnings} Repeat promotion is blocked.`, result);
    },
  });

  pi.registerCommand("knowledge-opt-in", {
    description: "Explicitly enable candidate staging for ALPHA-KNOWLEDGE-PILOT-001 in this workspace",
    handler: async (_args, ctx) => {
      try {
        const policy = await getCapturePolicy(ctx.cwd, { expectedRoot });
        if (policy.pendingStagingEnabled) {
          notify(ctx, "ALPHA-KNOWLEDGE-PILOT-001 pending staging is already enabled for this workspace.");
          return;
        }
        const accepted = await askOnce(
          ctx,
          "Enable pilot candidate staging?",
          `This enables only private candidate staging for ${PILOT_PROJECT} in this workspace. Candidates remain pending/inactive and require a separate one-batch promotion approval. No candidate is created by opting in.`,
        );
        if (!accepted) {
          notify(ctx, "Pilot candidate staging remains disabled.", "info");
          return;
        }
        await setCaptureEnabled(ctx.cwd, true, { expectedRoot });
        notify(ctx, "Pilot candidate staging enabled. No candidate was staged.", "success");
      } catch (error) {
        notify(ctx, `Could not enable pilot candidate staging: ${error.message}`, "error");
      }
    },
  });

  pi.registerCommand("knowledge-opt-out", {
    description: "Revoke the ALPHA-KNOWLEDGE-PILOT-001 candidate-staging opt-in for this workspace",
    handler: async (_args, ctx) => {
      try {
        const policy = await getCapturePolicy(ctx.cwd, { expectedRoot });
        if (!policy.pendingStagingEnabled) {
          notify(ctx, "Pilot candidate staging is already disabled.");
          return;
        }
        const accepted = await askOnce(
          ctx,
          "Revoke pilot candidate-staging opt-in?",
          "This disables further candidate staging in this workspace. Existing pending candidates will remain untouched and inactive.",
        );
        if (!accepted) {
          notify(ctx, "Pilot candidate staging remains enabled.", "info");
          return;
        }
        await setCaptureEnabled(ctx.cwd, false, { expectedRoot });
        notify(ctx, "Pilot candidate staging disabled. Existing pending candidates were left untouched.", "success");
      } catch (error) {
        notify(ctx, `Could not revoke pilot candidate staging: ${error.message}`, "error");
      }
    },
  });
}
