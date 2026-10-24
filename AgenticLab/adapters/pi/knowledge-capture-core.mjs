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

export function validateCandidate(candidate, expectedScope = PILOT_SCOPE) {
  if (!isPlainObject(candidate) || !hasOnlyKeys(candidate, RECORD_KEYS) || RECORD_KEYS.some((key) => !(key in candidate))) {
    fail("candidate does not match the strict pilot knowledge-record schema");
  }
  if (typeof candidate.id !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(candidate.id)) {
    fail("candidate.id must be a lowercase, path-safe stable identifier");
  }
  requireText(candidate.title, "title", 160);
  if (!CATEGORIES.has(candidate.category)) fail("candidate.category is not an allowed knowledge category");
  if (candidate.scope !== expectedScope) fail(`candidate.scope must equal ${expectedScope}`);
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

export function validateCandidateBatch(records, expectedScope = PILOT_SCOPE) {
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_CANDIDATES) {
    fail(`records must contain between 1 and ${MAX_CANDIDATES} candidates`);
  }
  const ids = new Set();
  let totalBytes = 0;
  for (const record of records) {
    validateCandidate(record, expectedScope);
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
  const allowedKeys = ["schemaVersion", "project", "workspaceRoot", "pendingStagingEnabled", "metricsEnabled", "scope", "maxCandidates", "requiredFields"];
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) fail("capture policy has an invalid shape");
  if ((value.schemaVersion !== undefined && value.schemaVersion !== 1) || typeof value.pendingStagingEnabled !== "boolean") {
    fail("capture policy has an unsupported version or invalid staging setting");
  }
  if (value.project !== undefined) requireText(value.project, "project", 160);
  if (value.workspaceRoot !== undefined && value.workspaceRoot !== workspaceRoot) fail("capture policy does not match this workspace");
  if (value.metricsEnabled !== undefined && typeof value.metricsEnabled !== "boolean") fail("capture policy metricsEnabled must be a boolean");

  const scope = value.scope ?? (value.project ? `project:${value.project}` : PILOT_SCOPE);
  requireText(scope, "scope", 160);
  if (!scope.startsWith("project:")) fail("capture policy scope must identify a project");
  if (value.maxCandidates !== undefined && (!Number.isSafeInteger(value.maxCandidates) || value.maxCandidates < 1 || value.maxCandidates > MAX_PENDING_CANDIDATES)) {
    fail(`capture policy maxCandidates must be between 1 and ${MAX_PENDING_CANDIDATES}`);
  }
  if (value.requiredFields !== undefined && (!Array.isArray(value.requiredFields) || value.requiredFields.some((field) => typeof field !== "string" || !RECORD_KEYS.includes(field)))) {
    fail("capture policy requiredFields contains an unsupported record field");
  }
  return { ...value, scope };
}

async function loadPolicy(locations) {
  const stat = await lstatOrNull(locations.policyPath);
  if (!stat) return { schemaVersion: 1, project: PILOT_PROJECT, workspaceRoot: locations.workspaceRoot, pendingStagingEnabled: false, scope: PILOT_SCOPE, missing: true };
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
  const preservedPolicy = { ...current };
  delete preservedPolicy.missing;
  const content = `${JSON.stringify({ ...preservedPolicy, pendingStagingEnabled: enabled }, null, 2)}\n`;
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

async function readPendingBundle(locations, batchName, expectedScope = PILOT_SCOPE) {
  if (!/^batch-[0-9a-f-]{36}$/u.test(batchName)) fail("pending queue contains an unexpected entry");
  const batchPath = path.join(locations.pendingRoot, batchName);
  const batchStat = await fs.lstat(batchPath);
  if (!batchStat.isDirectory() || batchStat.isSymbolicLink() || await fs.realpath(batchPath) !== batchPath) fail("pending batch must be a real directory");
  let entries = await fs.readdir(batchPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!/^\.bundle-[0-9a-f-]{36}\.tmp$/u.test(entry.name)) continue;
    if (!entry.isFile() || entry.isSymbolicLink()) fail("pending batch contains an unsafe temporary bundle entry");
    await fs.unlink(path.join(batchPath, entry.name));
  }
  entries = await fs.readdir(batchPath, { withFileTypes: true });
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
  const records = validateCandidateBatch(bundle.records, expectedScope);
  return records;
}

async function readAllPending(locations, expectedScope = PILOT_SCOPE) {
  const exists = await ensureDirectoryOrAbsent(locations.pendingRoot, "pending root");
  if (!exists) return [];
  if (await fs.realpath(locations.pendingRoot) !== locations.pendingRoot) fail("pending root resolves outside its expected location");
  const directory = await fs.opendir(locations.pendingRoot);
  const entries = [];
  for await (const entry of directory) {
    if (entry.name.startsWith(".consumed-")) {
      if (!/^\.consumed-batch-[0-9a-f-]{36}$/u.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
        fail("pending queue contains an unexpected consumed-batch entry");
      }
      await removeOwnedTempDirectory(path.join(locations.pendingRoot, entry.name));
      continue;
    }
    entries.push(entry);
    if (entries.length > MAX_PENDING_CANDIDATES) fail(`pending queue exceeds ${MAX_PENDING_CANDIDATES} candidate batches`);
  }
  const all = [];
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail("pending queue contains an unexpected or linked entry");
    const records = await readPendingBundle(locations, entry.name, expectedScope);
    for (const record of records) {
      if (ids.has(record.id)) fail(`pending queue contains colliding candidate id: ${record.id}`);
      ids.add(record.id);
      all.push(record);
      if (all.length > MAX_PENDING_CANDIDATES) fail(`pending queue exceeds ${MAX_PENDING_CANDIDATES} candidates`);
    }
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

async function locatePendingCandidate(locations, id, expectedScope) {
  const allRecords = await readAllPending(locations, expectedScope);
  const candidate = allRecords.find((record) => record.id === id);
  if (!candidate) return null;

  const directory = await fs.opendir(locations.pendingRoot);
  let located = null;
  for await (const entry of directory) {
    if (entry.name.startsWith(".consumed-")) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail("pending queue contains an unexpected or linked entry");
    const records = await readPendingBundle(locations, entry.name, expectedScope);
    if (!records.some((record) => record.id === id)) continue;
    if (located) fail(`candidate ID appears in more than one pending batch: ${id}`);
    located = { batchId: entry.name, candidate, records };
  }
  return located;
}

async function consumePendingCandidate(locations, batchId, id, expectedCandidate, expectedScope, hooks = {}) {
  const batchPath = path.join(locations.pendingRoot, batchId);
  const records = await readPendingBundle(locations, batchId, expectedScope);
  const candidate = records.find((record) => record.id === id);
  if (!candidate || JSON.stringify(candidate) !== JSON.stringify(expectedCandidate)) {
    fail("pending candidate changed before its approved promotion could be consumed");
  }
  await hooks.beforePendingConsume?.(batchId, id);

  if (records.length === 1) {
    const consumedPath = path.join(locations.pendingRoot, `.consumed-${batchId}`);
    if (await lstatOrNull(consumedPath)) fail("consumed-batch cleanup path unexpectedly exists");
    await fs.rename(batchPath, consumedPath);
    const warnings = [];
    try {
      await hooks.afterPendingDetach?.(consumedPath);
    } catch (error) {
      warnings.push(`Pending candidate was detached, but cleanup hook failed: ${error.message}`);
    }
    try {
      await removeOwnedTempDirectory(consumedPath);
    } catch (error) {
      warnings.push(`Pending candidate was detached, but its consumed batch could not be removed: ${error.message}`);
    }
    try {
      if ((await fs.readdir(locations.pendingRoot)).length === 0) await fs.rmdir(locations.pendingRoot);
    } catch (error) {
      if (error?.code !== "ENOENT") warnings.push(`Pending candidate was detached, but the empty queue could not be removed: ${error.message}`);
    }
    return { pendingConsumed: true, warnings };
  }

  const remaining = records.filter((record) => record.id !== id);
  const bundlePath = path.join(batchPath, "bundle.json");
  const bundleStat = await fs.lstat(bundlePath);
  if (!bundleStat.isFile() || bundleStat.isSymbolicLink()) fail("pending bundle changed to an unsafe file before consumption");
  const replacementPath = path.join(batchPath, `.bundle-${randomUUID()}.tmp`);
  const bundle = { schemaVersion: 1, batchId, records: remaining };
  try {
    await writeExclusiveFile(replacementPath, `${JSON.stringify(bundle, null, 2)}\n`);
    await hooks.beforePendingReplace?.(batchId, id);
    await fs.rename(replacementPath, bundlePath);
  } catch (error) {
    await fs.unlink(replacementPath).catch(() => {});
    throw error;
  }
  const warnings = [];
  try {
    await hooks.afterPendingReplace?.(batchId, id);
  } catch (error) {
    warnings.push(`Pending candidate was removed from its batch, but cleanup hook failed: ${error.message}`);
  }
  return { pendingConsumed: true, warnings };
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

async function readActiveRecordIds(locations) {
  const activeStat = await lstatOrNull(locations.activeRoot);
  if (!activeStat) return new Set();
  if (!activeStat.isDirectory() || activeStat.isSymbolicLink() || await fs.realpath(locations.activeRoot) !== locations.activeRoot) {
    fail("active knowledge root must be a real directory before candidate staging");
  }

  const inventory = await collectActiveRecordPaths(locations.activeRoot);
  if (inventory.issues.length) fail(`active record inventory is incomplete: ${inventory.issues[0].reason}`);
  const ids = new Set();
  for (const filePath of inventory.files) {
    const header = await readRecordMetadataHeader(filePath);
    if (header.kind === "map") continue;
    if (header.kind !== "record") fail(`active record metadata is incomplete: ${path.relative(locations.activeRoot, filePath)}`);
    const relativePath = path.relative(locations.activeRoot, filePath).split(path.sep).join("/");
    const filenameId = path.basename(filePath, ".md");
    const id = header.meta.id;
    if (typeof id !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(id) || id !== filenameId) {
      fail(`active record ID is invalid or does not match its filename: ${relativePath}`);
    }
    if (ids.has(id)) fail(`active knowledge contains a duplicate record ID: ${id}`);
    ids.add(id);
  }
  return ids;
}

export async function stageCandidates(cwd, records, { expectedRoot = PILOT_WORKSPACE_ROOT } = {}) {
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  return withCaptureLock(locations, async () => {
    const policy = await loadPolicy(locations);
    if (!policy.pendingStagingEnabled) fail("pending staging is disabled; use /knowledge-opt-in after explicit workspace approval");
    if (policy.scope === PILOT_SCOPE) await assertPromotionNotCommitted(locations);

    const candidates = validateCandidateBatch(records, policy.scope);
    const maxCandidates = Math.min(policy.maxCandidates ?? MAX_PENDING_CANDIDATES, MAX_PENDING_CANDIDATES);
    if (candidates.length > maxCandidates) fail(`candidate batch is limited to ${maxCandidates} candidates by workspace policy`);

    const activeIds = await readActiveRecordIds(locations);
    for (const candidate of candidates) {
      if (activeIds.has(candidate.id)) fail(`candidate ID already exists in active knowledge: ${candidate.id}`);
    }

    const existing = await readAllPending(locations, policy.scope);
    if (existing.length + candidates.length > maxCandidates) fail(`pending queue is limited to ${maxCandidates} candidates by workspace policy`);
    const existingIds = new Set(existing.map((record) => record.id));
    for (const candidate of candidates) {
      if (existingIds.has(candidate.id)) fail(`candidate id already exists in pending queue: ${candidate.id}`);
    }

    await createPendingRoot(locations);
    const batchId = `batch-${randomUUID()}`;
    const finalPath = path.join(locations.pendingRoot, batchId);
    const bundle = { schemaVersion: 1, batchId, records: candidates };
    const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
    if (Buffer.byteLength(bundleText, "utf8") > MAX_BATCH_BYTES + 2048) fail(`serialized candidate batch exceeds ${MAX_BATCH_BYTES + 2048} bytes`);
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
    "---",
    `id: ${JSON.stringify(record.id)}`,
    `title: ${JSON.stringify(record.title)}`,
    `category: ${JSON.stringify(record.category)}`,
    `scope: ${JSON.stringify(record.scope)}`,
    'status: "active"',
    `source: ${JSON.stringify(source)}`,
    `evidence: ${JSON.stringify(record.evidence)}`,
    `recorded: ${JSON.stringify(record.recorded)}`,
    `verified: ${JSON.stringify(record.verified)}`,
    "---",
    "",
    `# ${record.title}`,
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

export function renderCandidatePromotionPreview(record, { alreadyActive = false } = {}) {
  const location = `AgenticLab/knowledge/${record.id}.md`;
  const parts = [
    alreadyActive
      ? `Confirm cleanup of pending candidate ${record.id}; an identical active record already exists.`
      : `Promote one pending candidate (${record.id}) into the existing active knowledge collection.`,
    `Target: ${location}`,
    `Scope: ${record.scope}`,
    alreadyActive
      ? "No active record will be written or changed; only the duplicate pending copy will be removed."
      : "The operation adds exactly one new record. Existing active records, INDEX.md, and topic maps will not be changed.",
    "Other pending candidates will remain pending. Promotion requires this explicit confirmation.",
    "",
    "## Complete active record preview",
    "```markdown",
    renderActiveRecord(record).trimEnd(),
    "```",
  ];
  const preview = parts.join("\n");
  if (Buffer.byteLength(preview, "utf8") > MAX_PREVIEW_BYTES) fail(`complete candidate promotion preview exceeds ${MAX_PREVIEW_BYTES} bytes`);
  return preview;
}

export async function listPendingCandidates(cwd, { expectedRoot = PILOT_WORKSPACE_ROOT } = {}) {
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  return withCaptureLock(locations, async () => {
    const policy = await loadPolicy(locations);
    const records = await readAllPending(locations, policy.scope);
    return {
      status: records.length ? "ok" : "empty",
      count: records.length,
      candidates: records.map(({ id, title, category, scope, status, recorded }) => ({ id, title, category, scope, status, recorded })),
    };
  });
}

export async function promoteCandidate(cwd, id, confirm, { expectedRoot = PILOT_WORKSPACE_ROOT, hooks = {} } = {}) {
  if (typeof id !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(id)) fail("promotion requires a valid candidate ID");
  if (typeof confirm !== "function") fail("candidate promotion requires an available UI confirmation function");
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  return withCaptureLock(locations, async () => {
    const policy = await loadPolicy(locations);
    const activeStat = await lstatOrNull(locations.activeRoot);
    if (!activeStat || !activeStat.isDirectory() || activeStat.isSymbolicLink() || await fs.realpath(locations.activeRoot) !== locations.activeRoot) {
      fail("additive candidate promotion requires an existing real AgenticLab/knowledge directory");
    }

    const located = await locatePendingCandidate(locations, id, policy.scope);
    if (!located) fail(`no pending candidate with ID "${id}" exists`);
    const { candidate, batchId } = located;
    const recordContent = renderActiveRecord(candidate);
    if (Buffer.byteLength(recordContent, "utf8") > MAX_RECORD_BYTES) fail(`promoted record exceeds ${MAX_RECORD_BYTES} bytes`);

    const activeIds = await readActiveRecordIds(locations);
    let alreadyActive = activeIds.has(id);
    if (alreadyActive) {
      const activeContent = await readBoundedRegularFile(path.join(locations.activeRoot, `${id}.md`), MAX_RECORD_BYTES);
      if (activeContent !== recordContent) fail(`active record ID collision: ${id}`);
    }

    const snapshot = pendingSnapshot([candidate]);
    const approved = await confirm(renderCandidatePromotionPreview(candidate, { alreadyActive }));
    if (approved !== true) return { promoted: false, status: "rejected", count: 1, pendingConsumed: false, warnings: [] };

    const currentPolicy = await loadPolicy(locations);
    if (currentPolicy.scope !== policy.scope) fail("workspace knowledge scope changed during candidate promotion review");
    const currentLocated = await locatePendingCandidate(locations, id, currentPolicy.scope);
    if (!currentLocated || pendingSnapshot([currentLocated.candidate]) !== snapshot || currentLocated.batchId !== batchId) {
      fail("pending candidate changed during promotion review; no active record was written");
    }

    const currentActiveIds = await readActiveRecordIds(locations);
    const currentAlreadyActive = currentActiveIds.has(id);
    if (currentAlreadyActive !== alreadyActive) fail("active record state changed during promotion review; retry with a fresh preview");
    if (currentAlreadyActive) {
      const activeContent = await readBoundedRegularFile(path.join(locations.activeRoot, `${id}.md`), MAX_RECORD_BYTES);
      if (activeContent !== recordContent) fail(`active record ID collision: ${id}`);
    }

    const warnings = [];
    if (!currentAlreadyActive) {
      const tempDir = await fs.mkdtemp(path.join(locations.activeRoot, `.promotion-${randomUUID()}-`));
      const tempRecordPath = path.join(tempDir, `${id}.md`);
      const activeRecordPath = path.join(locations.activeRoot, `${id}.md`);
      try {
        await writeExclusiveFile(tempRecordPath, recordContent);
        await hooks.beforePublish?.(tempRecordPath, activeRecordPath);
        if (await lstatOrNull(activeRecordPath)) fail(`active record ID collision: ${id}`);
        await fs.link(tempRecordPath, activeRecordPath);
      } catch (error) {
        await removeOwnedTempDirectory(tempDir).catch(() => {});
        throw error;
      }
      try {
        await removeOwnedTempDirectory(tempDir);
      } catch (error) {
        warnings.push(`Active record was published, but its temporary directory could not be removed: ${error.message}`);
      }
      try {
        await hooks.afterPublish?.(activeRecordPath);
      } catch (error) {
        warnings.push(`Active record was published, but the post-publish hook failed: ${error.message}`);
      }
    }

    let pendingConsumed = false;
    try {
      const cleanup = await consumePendingCandidate(locations, batchId, id, candidate, policy.scope, hooks);
      pendingConsumed = cleanup.pendingConsumed;
      warnings.push(...cleanup.warnings);
    } catch (error) {
      warnings.push(`Active record ${currentAlreadyActive ? "was already present" : "was published"}, but the pending candidate could not be removed: ${error.message}`);
    }

    return {
      promoted: !currentAlreadyActive,
      status: currentAlreadyActive ? "already_active" : "active",
      count: 1,
      id,
      location: `AgenticLab/knowledge/${id}.md`,
      pendingConsumed,
      warnings,
    };
  });
}

const MAX_RETRIEVAL_RESULTS = 20;
const MAX_RETRIEVAL_BYTES = 64 * 1024;
const MAX_METADATA_BYTES = 4096;
const MAX_RECORD_FILES = 1000;
const VALID_RECORD_STATUSES = new Set(["active", "candidate", "inactive", "stale", "superseded"]);

function parseFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    const rawValue = field[2].trim();
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try {
        meta[field[1]] = JSON.parse(rawValue);
        continue;
      } catch {
        // Preserve unparseable quoted YAML as text instead of dropping metadata.
      }
    }
    meta[field[1]] = rawValue.replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(match[0].length) };
}

function parseMarkdownRecordHeader(text) {
  const meta = {};
  let title = "";
  for (const line of text.split(/\r?\n/u)) {
    if (!title) {
      const heading = /^#\s+(.+?)\s*$/u.exec(line);
      if (heading) title = heading[1];
    }
    if (/^\s*(?:-\s+)?\*\*Map ID:\*\*/u.test(line) || /^\s*Map ID:/u.test(line)) return { kind: "map" };
    const field = /^\s*-\s+\*\*(ID|Category|Scope|Status|Recorded|Verified):\*\*\s*(.*)$/iu.exec(line);
    if (field) {
      const key = field[1].toLowerCase();
      meta[key] = field[2].trim().replace(/^`|`$/gu, "").replace(/^['"]|['"]$/gu, "");
    }
    if (/^##\s/u.test(line)) {
      if (title && ["id", "category", "scope", "status", "recorded", "verified"].every((key) => meta[key])) {
        return { kind: "record", meta: { ...meta, title } };
      }
      return { kind: "invalid", reason: "record metadata header is incomplete" };
    }
  }
  if (title && ["id", "category", "scope", "status", "recorded", "verified"].every((key) => meta[key])) {
    return { kind: "record", meta: { ...meta, title } };
  }
  return { kind: "pending" };
}

async function readRecordMetadataHeader(filePath) {
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { kind: "incomplete", reason: "record path is not a regular file" };
    const maxBytes = Math.min(stat.size, MAX_METADATA_BYTES);
    const chunks = [];
    let offset = 0;
    while (offset < maxBytes) {
      const chunk = Buffer.alloc(Math.min(1024, maxBytes - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      offset += bytesRead;
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
        const frontMatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(text);
        if (frontMatter) return { kind: "record", meta: parseFrontMatter(frontMatter[0]).meta };
      } else {
        const parsed = parseMarkdownRecordHeader(text);
        if (parsed.kind !== "pending") return parsed;
      }
    }
    return { kind: "incomplete", reason: "record metadata header is missing or exceeds the metadata scan limit" };
  } finally {
    await handle.close();
  }
}

async function collectActiveRecordPaths(activeRoot) {
  const files = [];
  const issues = [];
  let capped = false;
  async function walk(directory) {
    if (capped) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      issues.push({ file: path.relative(activeRoot, directory), reason: "directory could not be inventoried" });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (capped) return;
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        issues.push({ file: path.relative(activeRoot, filePath), reason: "symbolic links are not eligible records" });
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "_candidates" || entry.name === "knowledge-pending") continue;
        await walk(filePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "INDEX.md") continue;
      files.push(filePath);
      if (files.length > MAX_RECORD_FILES) {
        files.pop();
        issues.push({ file: path.relative(activeRoot, filePath), reason: `record inventory exceeds the ${MAX_RECORD_FILES}-file limit` });
        capped = true;
      }
    }
  }
  await walk(activeRoot);
  return { files, issues };
}

function normalizeRecordMetadata(meta, file, workspaceScope) {
  const filenameId = path.basename(file, ".md");
  const required = ["id", "title", "category", "scope", "status", "recorded", "verified"];
  if (required.some((key) => typeof meta[key] !== "string" || !meta[key].trim())) {
    return { kind: "incomplete", reason: "record is missing required metadata" };
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/u.test(meta.id) || meta.id !== filenameId) {
    return { kind: "incomplete", reason: "record ID is invalid or does not match its filename" };
  }
  if (!isIsoDate(meta.recorded) || (meta.verified !== "not yet verified" && !isIsoDate(meta.verified))) {
    return { kind: "incomplete", reason: "record dates are invalid" };
  }
  if (!VALID_RECORD_STATUSES.has(meta.status)) return { kind: "incomplete", reason: "record lifecycle status is unknown" };
  if (!CATEGORIES.has(meta.category)) return { kind: "filtered", reason: "record category is not in the current knowledge contract", record: { id: meta.id, title: meta.title, category: meta.category, scope: meta.scope, status: meta.status, file } };
  if (!scopeBelongsToWorkspace(meta.scope, workspaceScope)) {
    return { kind: "filtered", reason: "record belongs to a different project scope", record: { id: meta.id, title: meta.title, category: meta.category, scope: meta.scope, status: meta.status, file } };
  }
  if (meta.status !== "active") return { kind: "filtered", reason: `record status is ${meta.status}`, record: { id: meta.id, title: meta.title, category: meta.category, scope: meta.scope, status: meta.status, file } };
  return { kind: "record", record: { id: meta.id, title: meta.title, category: meta.category, scope: meta.scope, status: meta.status, recorded: meta.recorded, verified: meta.verified, file } };
}

function scopeBelongsToWorkspace(recordScope, workspaceScope) {
  return !recordScope.startsWith("project:") || recordScope === workspaceScope || recordScope.startsWith(`${workspaceScope}/`);
}

function scopeMatches(recordScope, requestedScope, workspaceScope) {
  if (!requestedScope || requestedScope === workspaceScope || recordScope === workspaceScope) return true;
  return recordScope === requestedScope || recordScope.startsWith(`${requestedScope}/`) || requestedScope.startsWith(`${recordScope}/`);
}

export async function readKnowledge(cwd, { id, query, scope, category, limit = MAX_RETRIEVAL_RESULTS } = {}, { expectedRoot = PILOT_WORKSPACE_ROOT } = {}) {
  const locations = await resolvePilotLocations(cwd, expectedRoot);
  const activeStat = await lstatOrNull(locations.activeRoot);
  if (!activeStat) {
    return { status: "no_knowledge_store", matches: [], count: 0, complete: false, note: "no promoted knowledge store exists in this workspace" };
  }
  if (!activeStat.isDirectory() || activeStat.isSymbolicLink()) {
    return { status: "unavailable", matches: [], count: 0, complete: false, note: "active knowledge root is not a real directory" };
  }
  try {
    if (await fs.realpath(locations.activeRoot) !== locations.activeRoot) {
      return { status: "unavailable", matches: [], count: 0, complete: false, note: "active knowledge root resolves outside its expected path" };
    }
  } catch {
    return { status: "unavailable", matches: [], count: 0, complete: false, note: "active knowledge root could not be resolved" };
  }

  if (scope !== undefined) requireText(scope, "scope", 160);
  if (category !== undefined && !CATEGORIES.has(category)) fail("category is not an allowed knowledge category");
  if (!Number.isSafeInteger(limit) || limit < 1) fail("limit must be a positive integer");

  let policy;
  try {
    policy = await loadPolicy(locations);
  } catch (error) {
    return { status: "unavailable", matches: [], count: 0, complete: false, note: `workspace scope policy could not be read: ${error.message}` };
  }

  const inventory = await collectActiveRecordPaths(locations.activeRoot);
  const issues = [...inventory.issues];
  const filtered = [];
  const eligible = [];
  for (const filePath of inventory.files) {
    const relativePath = path.relative(locations.activeRoot, filePath).split(path.sep).join("/");
    let header;
    try {
      header = await readRecordMetadataHeader(filePath);
    } catch (error) {
      issues.push({ file: relativePath, reason: `metadata could not be read: ${error.message}` });
      continue;
    }
    if (header.kind === "map") continue;
    if (header.kind !== "record") {
      issues.push({ file: relativePath, reason: header.reason || "record metadata could not be classified" });
      continue;
    }

    const normalized = normalizeRecordMetadata(header.meta, relativePath, policy.scope);
    if (normalized.kind === "incomplete") {
      issues.push({ file: relativePath, reason: normalized.reason });
      continue;
    }
    const record = normalized.record;
    if (normalized.kind === "filtered") {
      filtered.push({ ...record, reason: normalized.reason });
      continue;
    }
    if (!scopeBelongsToWorkspace(record.scope, policy.scope)) {
      filtered.push({ ...record, reason: "record belongs to a different project scope" });
      continue;
    }
    if (!scopeMatches(record.scope, scope, policy.scope)) {
      filtered.push({ ...record, reason: "record scope does not match the requested task scope" });
      continue;
    }
    if (category && record.category !== category) {
      filtered.push({ ...record, reason: "record category does not match the requested category" });
      continue;
    }
    if (record.status !== "active") {
      filtered.push({ ...record, reason: `record status is ${record.status}` });
      continue;
    }
    eligible.push({ ...record, filePath });
  }

  const complete = issues.length === 0;
  const filteredSummary = filtered.slice(0, MAX_RETRIEVAL_RESULTS).map(({ id, title, category: recordCategory, scope: recordScope, status, file, reason }) => ({
    id, title, category: recordCategory, scope: recordScope, status, file, reason,
  }));
  const base = {
    complete,
    searched: 0,
    filteredCount: filtered.length,
    filtered: filteredSummary,
    ...(issues.length ? { issues: issues.slice(0, MAX_RETRIEVAL_RESULTS) } : {}),
  };

  if (typeof id === "string" && id.trim()) {
    const wanted = id.trim().replace(/\.md$/u, "");
    const match = eligible.find((record) => record.id === wanted);
    if (!match) {
      const excluded = filtered.find((record) => record.id === wanted);
      if (issues.length) return { ...base, status: "incomplete", matches: [], count: 0, note: "the eligible record inventory was incomplete" };
      if (excluded) {
        const excludedSummary = filteredSummary.find((record) => record.id === wanted);
        return { ...base, status: "filtered", filteredCount: 1, filtered: excludedSummary ? [excludedSummary] : [], matches: [], count: 0, note: excluded.reason };
      }
      return { ...base, status: "not_found", matches: [], count: 0, note: `no active in-scope record with id "${wanted}"` };
    }
    try {
      const content = await readBoundedRegularFile(match.filePath, MAX_RECORD_BYTES);
      const { body } = parseFrontMatter(content);
      const selected = { ...match, content, body };
      delete selected.filePath;
      return { ...base, status: complete ? "ok" : "incomplete", matches: [selected], count: 1, searched: 1, ...(issues.length ? { note: "the matching record was read, but the full inventory was incomplete" } : {}) };
    } catch (error) {
      return { ...base, status: "incomplete", matches: [], count: 0, issues: [...(base.issues || []), { file: match.file, reason: `record body could not be read: ${error.message}` }], note: "the matching record body could not be read" };
    }
  }

  const terms = typeof query === "string" && query.trim() ? query.trim().toLowerCase().split(/\s+/u).filter(Boolean) : [];
  const scored = [];
  let bytesRead = 0;
  let searched = 0;
  for (const record of eligible) {
    let content;
    try {
      content = await readBoundedRegularFile(record.filePath, MAX_RECORD_BYTES);
    } catch (error) {
      issues.push({ file: record.file, reason: `record body could not be read: ${error.message}` });
      continue;
    }
    const size = Buffer.byteLength(content, "utf8");
    if (bytesRead + size > MAX_RETRIEVAL_BYTES) {
      issues.push({ file: record.file, reason: `eligible record search exceeded the ${MAX_RETRIEVAL_BYTES}-byte limit` });
      break;
    }
    bytesRead += size;
    searched += 1;
    const { body } = parseFrontMatter(content);
    const materialized = { ...record, content, body };
    delete materialized.filePath;
    if (terms.length === 0) {
      scored.push({ record: materialized, hits: 0 });
      continue;
    }
    const haystack = `${record.id}\n${record.title}\n${record.category}\n${record.scope}\n${content}`.toLowerCase();
    const hits = terms.filter((term) => haystack.includes(term)).length;
    if (hits >= Math.max(1, Math.ceil(terms.length / 2))) scored.push({ record: materialized, hits });
  }

  scored.sort((a, b) => b.hits - a.hits || a.record.id.localeCompare(b.record.id));
  const resultLimit = Math.max(1, Math.min(limit, MAX_RETRIEVAL_RESULTS));
  const matches = scored.slice(0, resultLimit).map((entry) => entry.record);
  const totalMatches = scored.length;
  const isComplete = issues.length === 0;
  if (!isComplete) {
    return { ...base, complete: false, status: "incomplete", matches, count: matches.length, totalMatches, searched, note: "the eligible record search did not complete" };
  }
  if (matches.length) {
    return { ...base, status: "ok", matches, count: matches.length, totalMatches, searched, truncated: totalMatches > resultLimit };
  }
  if (filtered.length) {
    return { ...base, status: "filtered", matches: [], count: 0, searched, note: "records existed but were excluded by scope, status, or category" };
  }
  return { ...base, status: "no_match", matches: [], count: 0, searched, note: "complete active in-scope record search found no match" };
}
