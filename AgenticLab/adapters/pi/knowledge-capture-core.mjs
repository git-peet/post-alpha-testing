import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const PILOT_PROJECT = "ALPHA-KNOWLEDGE-PILOT-001";
export const PILOT_SCOPE = `project:${PILOT_PROJECT}`;
export const PILOT_WORKSPACE_ROOT = "/home/peet/Projects/post-integration-delivery";
export const MAX_CANDIDATES = 20;
export const MAX_PENDING_CANDIDATES = 20;
export const MAX_RECORD_BYTES = 8 * 1024;
export const MAX_BATCH_BYTES = 64 * 1024;
export const MAX_PREVIEW_BYTES = 32 * 1024;

const POLICY_FILE = "knowledge-capture-policy.json";
const PENDING_DIR = "knowledge-pending";
const ACTIVE_DIR = "knowledge";
const LOCK_DIR = ".knowledge-capture.lock";
const PROMOTION_MARKER = ".knowledge-promotion-committed.json";
const CATEGORIES = new Set(["decision", "fact", "experience", "risk", "procedure"]);
const SOURCE_KINDS = new Set(["file", "conversation", "artifact", "user-decision"]);
const NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const RECORD_KEYS = ["id", "title", "category", "scope", "status", "source", "evidence", "recorded", "verified", "claim", "rationale"];
const SOURCE_KEYS = ["kind", "reference", "revision"];

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasUnsafeControl(value, allowNewlines = false) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value) || (!allowNewlines && /[\r\n]/u.test(value));
}

function requireText(value, name, maxLength, { multiline = false } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.length > maxLength || hasUnsafeControl(value, multiline)) {
    fail(`${name} must be a trimmed string of at most ${maxLength} characters`);
  }
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPlaceholder(value) {
  const normalized = value.trim().replace(/^['"`]|['"`]$/gu, "").toLowerCase();
  return /^(?:<redacted>|\[redacted\]|redacted|placeholder|example|sample|changeme|change-me|not-set|unset|null|none|x{3,}|your(?:[_ -][a-z0-9_-]+)?)$/u.test(normalized);
}

function hasLuhnCardNumber(text) {
  const candidates = text.match(/\b(?:\d[ -]?){13,19}\b/gu) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/gu, "");
    if (digits.length < 13 || digits.length > 19 || /^0+$/u.test(digits)) return false;
    let sum = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
  });
}

/** Deterministic pattern checks catch common credential forms; they are a defense-in-depth filter, not a guarantee that sensitive data is absent. */
export function containsSensitiveValue(value) {
  if (typeof value !== "string") return false;
  const highConfidencePatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/iu,
    /\bAKIA[0-9A-Z]{16}\b/u,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/u,
    /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/u,
    /\bAIza[A-Za-z0-9_-]{30,}\b/u,
    /\bxox[baprs]-[A-Za-z0-9-]{15,}\b/u,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}/iu,
    /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/u,
  ];
  if (highConfidencePatterns.some((pattern) => pattern.test(value)) || hasLuhnCardNumber(value)) return true;

  const assignment = /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|authorization|aws[_-]?secret[_-]?access[_-]?key)\b\s*[:=]\s*(["'`]?)([^\s"'`,;]{6,})/giu;
  for (const match of value.matchAll(assignment)) {
    if (!isPlaceholder(match[2])) return true;
  }
  return false;
}

function validateSource(source) {
  if (!isPlainObject(source) || !hasOnlyKeys(source, SOURCE_KEYS)) fail("source must be a structured provenance object");
  if (!SOURCE_KINDS.has(source.kind)) fail("source.kind is not an approved provenance type");
  requireText(source.reference, "source.reference", 300);
  if (source.revision !== undefined) requireText(source.revision, "source.revision", 160);

  if (source.kind === "file") {
    const reference = source.reference.replaceAll("\\", "/");
    if (path.posix.isAbsolute(reference) || path.win32.isAbsolute(source.reference) || reference.split("/").includes("..") || reference.split("/").includes(".")) {
      fail("file provenance must be a normalized workspace-relative path");
    }
    const protectedSegments = new Set([".env", "data", "node_modules", "dist", ".git", "knowledge-pending"]);
    if (reference.split("/").some((segment) => protectedSegments.has(segment.toLowerCase()))) {
      fail("file provenance cannot point into an excluded or generated path");
    }
  }
}

export function validateCandidate(candidate) {
  if (!isPlainObject(candidate) || !hasOnlyKeys(candidate, RECORD_KEYS) || RECORD_KEYS.some((key) => !(key in candidate))) {
    fail("candidate does not match the strict pilot knowledge-record schema");
  }
  if (typeof candidate.id !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(candidate.id)) {
    fail("candidate.id must be a lowercase, path-safe stable identifier");
  }
  requireText(candidate.title, "title", 160);
  if (!CATEGORIES.has(candidate.category)) fail("candidate.category is not an allowed knowledge category");
  if (candidate.scope !== PILOT_SCOPE) fail(`candidate.scope must equal ${PILOT_SCOPE}`);
  if (candidate.status !== "candidate") fail("new staged records must have lifecycle status candidate");
  validateSource(candidate.source);
  requireText(candidate.evidence, "evidence", 1200, { multiline: true });
  if (!isIsoDate(candidate.recorded)) fail("recorded must be a valid YYYY-MM-DD date");
  if (candidate.verified !== "not yet verified" && !isIsoDate(candidate.verified)) fail("verified must be a valid date or 'not yet verified'");
  requireText(candidate.claim, "claim", 3000, { multiline: true });
  requireText(candidate.rationale, "rationale", 1200, { multiline: true });

  const serialized = JSON.stringify(candidate);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) fail(`candidate exceeds ${MAX_RECORD_BYTES} bytes`);
  if (/knowledge-pending/iu.test(serialized)) fail("candidate content cannot link to or depend on the private pending queue");
  if (containsSensitiveValue(serialized)) fail("candidate contains a value matching a sensitive-data pattern");
  return candidate;
}

export function validateCandidateBatch(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_CANDIDATES) {
    fail(`records must contain between 1 and ${MAX_CANDIDATES} candidates`);
  }
  const ids = new Set();
  let totalBytes = 0;
  for (const record of records) {
    validateCandidate(record);
    if (ids.has(record.id)) fail(`duplicate candidate id: ${record.id}`);
    ids.add(record.id);
    totalBytes += Buffer.byteLength(JSON.stringify(record), "utf8");
  }
  if (totalBytes > MAX_BATCH_BYTES) fail(`candidate batch exceeds ${MAX_BATCH_BYTES} bytes`);
  return [...records];
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function resolvePilotLocations(cwd, expectedRoot = PILOT_WORKSPACE_ROOT) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) fail("tool context has no valid absolute workspace cwd");
  let realCwd;
  let realExpected;
  try {
    [realCwd, realExpected] = await Promise.all([fs.realpath(cwd), fs.realpath(expectedRoot)]);
  } catch {
    fail("pilot workspace root is unavailable");
  }
  if (path.resolve(cwd) !== realCwd || realCwd !== realExpected) fail("this pilot tool is restricted to its configured workspace root");
  const workspaceStat = await fs.lstat(realCwd);
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) fail("workspace root must be a real directory, not a symlink");

  const agenticDir = path.join(realCwd, "AgenticLab");
  const agenticStat = await lstatOrNull(agenticDir);
  if (!agenticStat || !agenticStat.isDirectory() || agenticStat.isSymbolicLink() || await fs.realpath(agenticDir) !== agenticDir) {
    fail("AgenticLab must be a real directory inside the pilot workspace");
  }
  return {
    workspaceRoot: realCwd,
    agenticDir,
    policyPath: path.join(agenticDir, POLICY_FILE),
    pendingRoot: path.join(agenticDir, PENDING_DIR),
    activeRoot: path.join(agenticDir, ACTIVE_DIR),
    promotionMarkerPath: path.join(agenticDir, PROMOTION_MARKER),
    lockPath: path.join(agenticDir, LOCK_DIR),
  };
}

async function withCaptureLock(locations, operation) {
  try {
    await fs.mkdir(locations.lockPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("another knowledge-capture operation is in progress or a stale lock requires review");
    throw error;
  }
  try {
    return await operation();
  } finally {
    await fs.rmdir(locations.lockPath).catch(() => {});
  }
}

async function readBoundedRegularFile(filePath, maxBytes) {
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) fail(`file is not a bounded regular file: ${path.basename(filePath)}`);
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function parsePolicy(value, workspaceRoot) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["schemaVersion", "project", "workspaceRoot", "pendingStagingEnabled"])) fail("pilot capture policy has an invalid shape");
  if (value.schemaVersion !== 1 || value.project !== PILOT_PROJECT || value.workspaceRoot !== workspaceRoot || typeof value.pendingStagingEnabled !== "boolean") {
    fail("pilot capture policy does not match this workspace or version");
  }
  return value;
}

async function loadPolicy(locations) {
  const stat = await lstatOrNull(locations.policyPath);
  if (!stat) return { schemaVersion: 1, project: PILOT_PROJECT, workspaceRoot: locations.workspaceRoot, pendingStagingEnabled: false, missing: true };
  if (!stat.isFile() || stat.isSymbolicLink()) fail("pilot capture policy must be a regular, non-symlink file");
  let parsed;
  try {
    parsed = JSON.parse(await readBoundedRegularFile(locations.policyPath, 2048));
  } catch (error) {
    if (error instanceof SyntaxError) fail("pilot capture policy is invalid JSON; staging is disabled");
    throw error;
  }
  return parsePolicy(parsed, locations.workspaceRoot);
}

async function writePolicy(locations, enabled) {
  const current = await loadPolicy(locations);
  if (current.missing) fail("pilot capture policy file is missing; opt-in cannot create or replace it");
  const tempPath = path.join(locations.agenticDir, `.knowledge-capture-policy-${randomUUID()}.tmp`);
  const content = `${JSON.stringify({
    schemaVersion: 1,
    project: PILOT_PROJECT,
    workspaceRoot: locations.workspaceRoot,
    pendingStagingEnabled: enabled,
  }, null, 2)}\n`;
  let handle;
  try {
    handle = await fs.open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NOFOLLOW, 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    const currentStat = await lstatOrNull(locations.policyPath);
    if (!currentStat || !currentStat.isFile() || currentStat.isSymbolicLink()) fail("pilot capture policy changed unexpectedly");
    await fs.rename(tempPath, locations.policyPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function getCapturePolicy(cwd, { expectedRoot = PILOT_WORKSPACE_ROOT } = {}) {
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  return loadPolicy(locations);
}

export async function setCaptureEnabled(cwd, enabled, { expectedRoot = PILOT_WORKSPACE_ROOT } = {}) {
  if (typeof enabled !== "boolean") fail("enabled must be a boolean");
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  return withCaptureLock(locations, async () => {
    const current = await loadPolicy(locations);
    if (current.pendingStagingEnabled === enabled) return { changed: false, enabled };
    await writePolicy(locations, enabled);
    return { changed: true, enabled };
  });
}

function ensureDirectoryOrAbsent(target, label) {
  return lstatOrNull(target).then((stat) => {
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fail(`${label} must be absent or a real directory, not a file or symlink`);
    return Boolean(stat);
  });
}

async function readPendingBundle(locations, batchName) {
  if (!/^batch-[0-9a-f-]{36}$/u.test(batchName)) fail("pending queue contains an unexpected entry");
  const batchPath = path.join(locations.pendingRoot, batchName);
  const batchStat = await fs.lstat(batchPath);
  if (!batchStat.isDirectory() || batchStat.isSymbolicLink() || await fs.realpath(batchPath) !== batchPath) fail("pending batch must be a real directory");
  const entries = await fs.readdir(batchPath, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== "bundle.json" || !entries[0].isFile()) fail("pending batch has an unexpected or linked entry");
  const raw = await readBoundedRegularFile(path.join(batchPath, "bundle.json"), MAX_BATCH_BYTES + 2048);
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    fail(`pending batch ${batchName} is invalid JSON`);
  }
  if (!isPlainObject(bundle) || !hasOnlyKeys(bundle, ["schemaVersion", "batchId", "records"]) || bundle.schemaVersion !== 1 || bundle.batchId !== batchName) {
    fail(`pending batch ${batchName} has an invalid envelope`);
  }
  const records = validateCandidateBatch(bundle.records);
  return records;
}

async function readAllPending(locations) {
  const exists = await ensureDirectoryOrAbsent(locations.pendingRoot, "pending root");
  if (!exists) return [];
  if (await fs.realpath(locations.pendingRoot) !== locations.pendingRoot) fail("pending root resolves outside its expected location");
  const directory = await fs.opendir(locations.pendingRoot);
  const entries = [];
  for await (const entry of directory) {
    entries.push(entry);
    if (entries.length > MAX_PENDING_CANDIDATES) fail(`pending queue exceeds ${MAX_PENDING_CANDIDATES} candidate batches`);
  }
  const all = [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail("pending queue contains an unexpected or linked entry");
    const records = await readPendingBundle(locations, entry.name);
    for (const record of records) {
      if (ids.has(record.id)) fail(`pending queue contains colliding candidate id: ${record.id}`);
      ids.add(record.id);
      all.push(record);
      if (all.length > MAX_PENDING_CANDIDATES) fail(`pending queue exceeds ${MAX_PENDING_CANDIDATES} candidates`);
    }
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

async function createPendingRoot(locations) {
  const exists = await ensureDirectoryOrAbsent(locations.pendingRoot, "pending root");
  if (!exists) {
    try {
      await fs.mkdir(locations.pendingRoot, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const stat = await fs.lstat(locations.pendingRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(locations.pendingRoot) !== locations.pendingRoot) {
    fail("pending root must remain a real directory inside AgenticLab");
  }
}

async function writeExclusiveFile(filePath, content, mode = 0o600) {
  const handle = await fs.open(filePath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NOFOLLOW, mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeOwnedTempDirectory(tempPath) {
  const stat = await lstatOrNull(tempPath);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("refusing to remove an unexpected temporary path");
  await fs.rm(tempPath, { recursive: true, force: false });
}

export async function stageCandidates(cwd, records, { expectedRoot = PILOT_WORKSPACE_ROOT } = {}) {
  const candidates = validateCandidateBatch(records);
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  return withCaptureLock(locations, async () => {
    await assertPromotionNotCommitted(locations);
    await activeRootIsAbsent(locations);
    const policy = await loadPolicy(locations);
    if (!policy.pendingStagingEnabled) fail("pending staging is disabled; use /knowledge-opt-in after explicit workspace approval");
    await createPendingRoot(locations);
    const existing = await readAllPending(locations);
    if (existing.length + candidates.length > MAX_PENDING_CANDIDATES) fail(`pending queue is limited to ${MAX_PENDING_CANDIDATES} candidates`);
    const existingIds = new Set(existing.map((record) => record.id));
    for (const candidate of candidates) {
      if (existingIds.has(candidate.id)) fail(`candidate id already exists in pending queue: ${candidate.id}`);
    }

    const batchId = `batch-${randomUUID()}`;
    const finalPath = path.join(locations.pendingRoot, batchId);
    const bundle = { schemaVersion: 1, batchId, records: candidates };
    const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
    if (Buffer.byteLength(bundleText, "utf8") > MAX_BATCH_BYTES + 2048) fail(`serialized candidate batch exceeds ${MAX_BATCH_BYTES} bytes`);
    const tempPath = await fs.mkdtemp(path.join(locations.pendingRoot, ".staging-"));
    try {
      await writeExclusiveFile(path.join(tempPath, "bundle.json"), bundleText);
      if (await lstatOrNull(finalPath)) fail("generated pending batch path unexpectedly collides");
      await fs.rename(tempPath, finalPath);
      return { batchId, count: candidates.length, status: "candidate", location: `AgenticLab/knowledge-pending/${batchId}` };
    } catch (error) {
      await removeOwnedTempDirectory(tempPath).catch(() => {});
      throw error;
    }
  });
}

function quoteBlock(text) {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

function escapeLinkLabel(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("`", "\\`");
}

export function renderActiveRecord(record) {
  const source = `${record.source.kind}: ${record.source.reference}${record.source.revision ? ` (revision ${record.source.revision})` : ""}`;
  return [
    `# ${record.title}`,
    "",
    `- **ID:** ${record.id}`,
    `- **Category:** ${record.category}`,
    `- **Scope:** ${record.scope}`,
    "- **Status:** active",
    `- **Source:** ${source}`,
    `- **Evidence:** ${record.evidence.replaceAll("\n", " ")}`,
    `- **Recorded:** ${record.recorded}`,
    `- **Verified:** ${record.verified}`,
    "",
    "## Claim or decision",
    "",
    quoteBlock(record.claim),
    "",
    "## Rationale / consequence",
    "",
    quoteBlock(record.rationale),
    "",
  ].join("\n");
}

export function renderPromotionPreview(records) {
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const parts = [
    `ALPHA-KNOWLEDGE-PILOT-001: promote ${sorted.length} pending candidate(s) as one batch.`,
    "The following complete record files and INDEX.md will become the active knowledge root.",
    "A committed marker will be recorded and the pending queue will be consumed after the active-root rename; if cleanup fails, the committed marker makes any leftover queue terminal and unavailable to review/staging tools.",
    "",
  ];
  parts.push("## INDEX.md");
  parts.push("```markdown");
  parts.push(`# Project Knowledge Index\n\n- **Project scope:** ${PILOT_SCOPE}\n- **Collection:** project-records\n- **Lifecycle:** active records promoted from one user-approved pilot batch.\n\n## Records\n\n${sorted.map((record) => `- [${record.id}](./${record.id}.md) — ${escapeLinkLabel(record.title)}`).join("\n")}\n`);
  parts.push("```");
  for (const record of sorted) {
    parts.push(`## ${record.id}.md`);
    parts.push("```markdown");
    parts.push(renderActiveRecord(record).trimEnd());
    parts.push("```");
  }
  const preview = parts.join("\n");
  if (Buffer.byteLength(preview, "utf8") > MAX_PREVIEW_BYTES) fail(`complete promotion preview exceeds ${MAX_PREVIEW_BYTES} bytes; no records were promoted`);
  return preview;
}

function pendingSnapshot(records) {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

async function activeRootIsAbsent(locations) {
  const stat = await lstatOrNull(locations.activeRoot);
  if (stat) fail("active AgenticLab/knowledge already exists; this pilot does not merge or repeat promotion");
}

async function assertPromotionNotCommitted(locations) {
  const stat = await lstatOrNull(locations.promotionMarkerPath);
  if (stat) fail("a promotion is already committed or has an incomplete commit marker; this pilot does not repeat promotion");
}

async function writeCommittedMarker(locations) {
  const tempPath = path.join(locations.agenticDir, `.knowledge-promotion-marker-${randomUUID()}.tmp`);
  const content = `${JSON.stringify({ schemaVersion: 1, project: PILOT_PROJECT, state: "committed" }, null, 2)}\n`;
  try {
    await writeExclusiveFile(tempPath, content);
    // link() publishes the fully written marker without replacing any existing marker.
    await fs.link(tempPath, locations.promotionMarkerPath);
    await fs.unlink(tempPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function consumePendingQueue(locations, hooks, approvedSnapshot) {
  const stat = await lstatOrNull(locations.pendingRoot);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(locations.pendingRoot) !== locations.pendingRoot) {
    fail("pending cleanup refused an unexpected or linked queue root");
  }
  const currentRecords = await readAllPending(locations);
  if (pendingSnapshot(currentRecords) !== approvedSnapshot) fail("pending queue changed after the approved commit; leftover items are terminal and were not deleted");
  if (hooks.removePending) {
    await hooks.removePending(locations.pendingRoot);
    return;
  }
  await fs.rm(locations.pendingRoot, { recursive: true, force: false });
}

export async function promotePending(cwd, confirm, { expectedRoot = PILOT_WORKSPACE_ROOT, hooks = {} } = {}) {
  if (typeof confirm !== "function") fail("promotion requires an available UI confirmation function");
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  return withCaptureLock(locations, async () => {
    await assertPromotionNotCommitted(locations);
    await activeRootIsAbsent(locations);
    const records = await readAllPending(locations);
    if (records.length === 0) fail("there are no pending candidates to promote");
    const preview = renderPromotionPreview(records);
    const snapshot = pendingSnapshot(records);
    const approved = await confirm(preview);
    if (approved !== true) return { promoted: false, status: "rejected", count: records.length };

    await assertPromotionNotCommitted(locations);
    await activeRootIsAbsent(locations);
    const currentRecords = await readAllPending(locations);
    if (pendingSnapshot(currentRecords) !== snapshot) fail("pending candidates changed during review; no promotion was made");

    const tempPath = path.join(locations.agenticDir, `.knowledge-promote-${randomUUID()}`);
    let created = false;
    try {
      await fs.mkdir(tempPath, { mode: 0o700 });
      created = true;
      await hooks.afterTempCreated?.(tempPath);
      const indexContent = [
        "# Project Knowledge Index",
        "",
        `- **Project scope:** ${PILOT_SCOPE}`,
        "- **Collection:** project-records",
        "- **Lifecycle:** active records promoted from one user-approved pilot batch.",
        "",
        "## Records",
        "",
        ...records.map((record) => `- [${record.id}](./${record.id}.md) — ${escapeLinkLabel(record.title)}`),
        "",
      ].join("\n");
      await writeExclusiveFile(path.join(tempPath, "INDEX.md"), indexContent);
      await hooks.afterIndexWritten?.(tempPath);
      for (const record of records) {
        await writeExclusiveFile(path.join(tempPath, `${record.id}.md`), renderActiveRecord(record));
      }
      await hooks.beforeRename?.(tempPath, locations.activeRoot);
      await assertPromotionNotCommitted(locations);
      await activeRootIsAbsent(locations);
      if (hooks.rename) await hooks.rename(tempPath, locations.activeRoot);
      else await fs.rename(tempPath, locations.activeRoot);
      created = false;
    } catch (error) {
      if (created) await removeOwnedTempDirectory(tempPath).catch(() => {});
      throw error;
    }

    const warnings = [];
    let pendingConsumed = false;
    try {
      await writeCommittedMarker(locations);
    } catch (error) {
      warnings.push(`Active promotion committed, but the committed marker could not be recorded: ${error.message}`);
    }
    try {
      await consumePendingQueue(locations, hooks, snapshot);
      pendingConsumed = true;
    } catch (error) {
      warnings.push(`Active promotion committed, but pending-queue cleanup failed; the terminal marker/root prevents further staging or review: ${error.message}`);
    }
    return {
      promoted: true,
      status: "active",
      count: records.length,
      location: "AgenticLab/knowledge/",
      pendingConsumed,
      warnings,
    };
  });
}

const MAX_RETRIEVAL_RESULTS = 20;
const MAX_RETRIEVAL_BYTES = 64 * 1024;

function parseFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    meta[field[1]] = field[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(match[0].length) };
}

export async function readKnowledge(cwd, { id, query, limit = MAX_RETRIEVAL_RESULTS } = {}, { expectedRoot = PILOT_WORKSPACE_ROOT } = {}) {
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  const activeStat = await lstatOrNull(locations.activeRoot);
  if (!activeStat || !activeStat.isDirectory() || activeStat.isSymbolicLink() || await fs.realpath(locations.activeRoot) !== locations.activeRoot) {
    return { status: "no_knowledge_store", matches: [], count: 0, note: "no promoted knowledge records exist in this workspace" };
  }

  const directory = await fs.opendir(locations.activeRoot);
  const files = [];
  for await (const entry of directory) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (entry.name === "INDEX.md") continue;
    files.push(entry.name);
  }
  files.sort();

  const records = [];
  let bytesRead = 0;
  for (const name of files) {
    const filePath = path.join(locations.activeRoot, name);
    let text;
    try {
      text = await readBoundedRegularFile(filePath, MAX_RECORD_BYTES);
    } catch {
      continue;
    }
    bytesRead += Buffer.byteLength(text, "utf8");
    if (bytesRead > MAX_RETRIEVAL_BYTES) break;
    const { meta, body } = parseFrontMatter(text);
    records.push({
      id: meta.id || name.replace(/\.md$/u, ""),
      title: meta.title || "",
      category: meta.category || "",
      scope: meta.scope || "",
      status: meta.status || "active",
      file: name,
      content: text,
      body,
    });
  }

  if (typeof id === "string" && id.trim()) {
    const wanted = id.trim().replace(/\.md$/u, "");
    const exact = records.filter((record) => record.id === wanted || record.file === `${wanted}.md`);
    if (exact.length === 0) {
      return { status: "not_found", matches: [], count: 0, note: `no promoted record with id "${wanted}"`, available: records.map((record) => record.id) };
    }
    return { status: "ok", matches: exact, count: exact.length };
  }

  if (typeof query === "string" && query.trim()) {
    const needle = query.trim().toLowerCase();
    const terms = needle.split(/\s+/u).filter(Boolean);
    const scored = records
      .map((record) => {
        const haystack = `${record.id}\n${record.title}\n${record.category}\n${record.scope}\n${record.content}`.toLowerCase();
        const hits = terms.filter((term) => haystack.includes(term)).length;
        return { record, hits };
      })
      .filter((entry) => entry.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.record.id.localeCompare(b.record.id))
      .slice(0, Math.max(1, Math.min(limit, MAX_RETRIEVAL_RESULTS)))
      .map((entry) => entry.record);
    if (scored.length === 0) {
      return { status: "no_match", matches: [], count: 0, note: "no promoted record matched the query", searched: records.length };
    }
    return { status: "ok", matches: scored, count: scored.length, searched: records.length };
  }

  return { status: "ok", matches: records.slice(0, Math.max(1, Math.min(limit, MAX_RETRIEVAL_RESULTS))), count: records.length };
}
