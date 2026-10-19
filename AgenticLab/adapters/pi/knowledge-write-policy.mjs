import { promises as fs } from "node:fs";
import path from "node:path";

const KNOWLEDGE_RELATIVE_PATH = path.join("AgenticLab", "knowledge");
const PENDING_RELATIVE_PATH = path.join("AgenticLab", "knowledge-pending");
const POLICY_RELATIVE_PATH = path.join("AgenticLab", "knowledge-capture-policy.json");
const PROMOTION_MARKER_RELATIVE_PATH = path.join("AgenticLab", ".knowledge-promotion-committed.json");
const CAPTURE_LOCK_RELATIVE_PATH = path.join("AgenticLab", ".knowledge-capture.lock");
const GUARDED_FILE_TOOLS = new Set(["read", "grep", "find", "ls", "write", "edit"]);
const RECURSIVE_TOOLS = new Set(["grep", "find"]);

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pathsIntersect(root, target) {
  return isWithin(root, target) || isWithin(target, root);
}

export function resolveKnowledgePath(cwd, candidatePath) {
  if (typeof cwd !== "string" || typeof candidatePath !== "string" || !candidatePath.trim()) return null;
  const root = path.resolve(cwd, KNOWLEDGE_RELATIVE_PATH);
  const target = path.resolve(cwd, candidatePath);
  return isWithin(root, target) ? target : null;
}

function resolvePathCandidates(cwd, input) {
  const supplied = [input?.path, input?.directory, ...(Array.isArray(input?.paths) ? input.paths : [])]
    .filter((value) => typeof value === "string" && value.trim());
  if (!supplied.length && (input?.toolName === "grep" || input?.toolName === "find")) supplied.push(".");
  return [...new Set(supplied.map((value) => path.resolve(cwd, value)))];
}

async function resolveThroughExistingSymlinks(target) {
  let current = path.resolve(target);
  const remainder = [];
  while (true) {
    try {
      const resolved = await fs.realpath(current);
      return path.resolve(resolved, ...remainder.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") return path.resolve(target);
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      remainder.push(path.basename(current));
      current = parent;
    }
  }
}

export async function classifyPendingAccess(toolName, input, cwd) {
  if (!GUARDED_FILE_TOOLS.has(toolName) || typeof cwd !== "string") return null;
  const pendingRoot = path.resolve(cwd, PENDING_RELATIVE_PATH);
  const paths = resolvePathCandidates(cwd, { ...input, toolName });
  let resolvedPending = pendingRoot;
  try {
    resolvedPending = await fs.realpath(pendingRoot);
  } catch {
    // The lexical root still protects the path before the queue has been created.
  }

  for (const target of paths) {
    const resolvedTarget = await resolveThroughExistingSymlinks(target);
    const direct = isWithin(pendingRoot, target) || isWithin(resolvedPending, resolvedTarget);
    const recursiveAncestor = RECURSIVE_TOOLS.has(toolName) &&
      (isWithin(target, pendingRoot) || isWithin(resolvedTarget, resolvedPending));
    if (direct || recursiveAncestor) {
      return {
        toolName,
        target,
        protectedRoot: pendingRoot,
        reason: "AgenticLab knowledge-pending is a private queue. Built-in file tools cannot read, search, list, edit, or write it; use the dedicated pilot batch tools.",
      };
    }
  }
  return null;
}

export async function classifyPilotPolicyMutation(toolName, input, cwd) {
  if ((toolName !== "write" && toolName !== "edit") || typeof cwd !== "string") return null;
  const candidatePath = typeof input?.path === "string" ? input.path : "";
  if (!candidatePath) return null;
  const target = path.resolve(cwd, candidatePath);
  const protectedPaths = [
    path.resolve(cwd, POLICY_RELATIVE_PATH),
    path.resolve(cwd, PROMOTION_MARKER_RELATIVE_PATH),
  ];
  const resolvedTarget = await resolveThroughExistingSymlinks(target);
  for (const protectedPath of protectedPaths) {
    const resolvedProtected = await resolveThroughExistingSymlinks(protectedPath);
    if (target === protectedPath || resolvedTarget === resolvedProtected) return { target: protectedPath, toolName };
  }
  return null;
}

export async function shellReferencesKnowledge(cwd, command) {
  if (typeof command !== "string" || !command.trim() || typeof cwd !== "string") return false;
  const normalized = command.replaceAll("\\", "/");
  const knowledgeRoot = path.resolve(cwd, KNOWLEDGE_RELATIVE_PATH).replaceAll("\\", "/");
  const pendingRoot = path.resolve(cwd, PENDING_RELATIVE_PATH).replaceAll("\\", "/");
  const policyPath = path.resolve(cwd, POLICY_RELATIVE_PATH).replaceAll("\\", "/");
  if (normalized.includes(knowledgeRoot) || normalized.includes("AgenticLab/knowledge")) return true;
  if (normalized.includes(pendingRoot) || normalized.includes("knowledge-pending")) return true;
  if (normalized.includes(policyPath) || normalized.includes("knowledge-capture-policy.json") || normalized.includes(".knowledge-promotion-committed.json")) return true;

  // Resolve ordinary path-shaped shell arguments so a symlink alias into the private queue does
  // not bypass the lexical check. This intentionally is not a shell parser or OS sandbox.
  let canonicalPending = path.resolve(cwd, PENDING_RELATIVE_PATH);
  let canonicalKnowledge = path.resolve(cwd, KNOWLEDGE_RELATIVE_PATH);
  try { canonicalPending = await fs.realpath(canonicalPending); } catch {}
  try { canonicalKnowledge = await fs.realpath(canonicalKnowledge); } catch {}
  const tokens = normalized.match(/[^\s"'`;|&<>]+/gu) ?? [];
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^[()]+|[()]+$/gu, "").split("=").at(-1);
    if (!token || token.startsWith("-") || (!token.includes("/") && !token.startsWith("."))) continue;
    const target = path.resolve(cwd, token);
    const canonicalTarget = await resolveThroughExistingSymlinks(target);
    if (pathsIntersect(path.resolve(cwd, PENDING_RELATIVE_PATH), target) || pathsIntersect(canonicalPending, canonicalTarget) ||
      pathsIntersect(path.resolve(cwd, KNOWLEDGE_RELATIVE_PATH), target) || pathsIntersect(canonicalKnowledge, canonicalTarget)) return true;
  }

  // Conservative lexical fallback for common `cd AgenticLab && ...` forms. Arbitrary shell
  // expansion, redirection indirection, and deliberate obfuscation remain outside this gate.
  const words = normalized.split(/[^A-Za-z0-9_.-]+/).filter(Boolean);
  const projectPackage = path.resolve(cwd, "AgenticLab");
  const cwdIsInPackage = isWithin(projectPackage, path.resolve(cwd));
  const cwdIsInPending = isWithin(path.resolve(cwd, PENDING_RELATIVE_PATH), path.resolve(cwd));
  const mentionsPackage = words.includes("AgenticLab");
  return (mentionsPackage && (words.includes("knowledge") || words.includes("knowledge-pending") || words.includes("knowledge-capture-policy.json"))) ||
    (cwdIsInPackage && (words.includes("knowledge") || words.includes("knowledge-pending") || words.includes("knowledge-capture-policy.json"))) ||
    cwdIsInPending;
}

/**
 * Return a confirmation request for built-in file writes/edits under AgenticLab/knowledge,
 * preserving the existing per-operation active-knowledge gate behavior.
 */
function getFileChangePreview(toolName, input) {
  if (toolName === "write" && typeof input?.content === "string") {
    return `Proposed file contents:\n${input.content || "(empty file)"}`;
  }

  const edits = Array.isArray(input?.edits)
    ? input.edits
    : typeof input?.oldText === "string" && typeof input?.newText === "string"
      ? [{ oldText: input.oldText, newText: input.newText }]
      : [];
  if (!edits.length || edits.some((edit) => typeof edit?.oldText !== "string" || typeof edit?.newText !== "string")) {
    return null;
  }

  return edits.map((edit, index) => [
    `Edit ${index + 1}:`,
    "--- existing text ---",
    edit.oldText || "(empty)",
    "+++ proposed text +++",
    edit.newText || "(empty)",
  ].join("\n")).join("\n\n");
}

export function classifyKnowledgeMutation(toolName, input, cwd) {
  if (toolName === "write" || toolName === "edit") {
    const protectedPath = resolveKnowledgePath(cwd, input?.path);
    if (!protectedPath) return null;
    return {
      kind: "file-tool",
      toolName,
      target: protectedPath,
      preview: getFileChangePreview(toolName, input),
    };
  }

  return null;
}

export async function captureTransactionLocked(cwd) {
  if (typeof cwd !== "string") return true;
  try {
    await fs.lstat(path.resolve(cwd, CAPTURE_LOCK_RELATIVE_PATH));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return true;
  }
}

export function decideKnowledgeMutation(request, hasUI, approved) {
  if (!request) return { allow: true };
  if (!hasUI) return { allow: false, reason: "Project knowledge changes require interactive user confirmation." };
  if (!approved) return { allow: false, reason: "Project knowledge change was not approved." };
  return { allow: true };
}

export function formatKnowledgeConfirmation(request, limit = 1600) {
  const text = String(request.preview ?? "");
  const preview = text.length > limit ? `${text.slice(0, limit)}\n…[preview truncated]` : text;
  return [
    `Operation: ${request.toolName}`,
    `Target: ${request.target}`,
    "This changes persistent project knowledge. Review the preview and approve only if the record is correctly scoped and supported.",
    "",
    preview || "(No text preview available.)",
  ].join("\n");
}
