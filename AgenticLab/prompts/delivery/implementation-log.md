# V5 `/implementation-log` Prompt

**Purpose:** Render a durable implementation log from the `implement-record.json` snapshot, or reconstruct it from current state if the record is already consumed.

**Invocation:** Manual. Run as:

```
/implementation-log <pbi-id-slug>
```

E.g. `/implementation-log pbi-1-dynamic-pricing` or `/implementation-log pbi-2-multi-warehouse-inventory`.

**What it does:**

1. **Check for snapshot (use `read` tool — `bash` is blocked by knowledge-write-gate for `AgenticLab/`):**
   - Read `AgenticLab/implementation-logs/<workspace-key>/<pbi-id-slug>/implement-record.json`
   - If **found**: render `implementation-log.md` from the record content; then delete the record file with `bash rm`.
   - If **not found**: the record was already consumed. Reconstruct `implementation-log.md` from the existing log (if present) + session history, and append a manual amendment noting post-record changes.

2. Render `AgenticLab/implementation-logs/<workspace-key>/<pbi-id-slug>/implementation-log.md` using the template below.

3. If the record was found and consumed: exit. If not found: you may add a brief manual amendment after the rendered log — just edit the file; no prompt re-run needed.

**Template rendered to `implementation-log.md`:**

```
# PBI <id> — <title>

**Status:** implemented | rolled-back | superseded  
**Implemented:** <completedAt>  
**Workspace:** <workspace-key>  
**EverShop version:** <from project source>  

## Files changed
- <list from implement-record.json.filesChanged, or manual>

## API endpoints added/changed
- <list from implement-record.json.apiEndpoints, or manual>

## Migrations
- <list from implement-record.json.migrations, or manual>

## Risks / assumptions
- <list from implement-record.json.risks, or manual>

## Test results
- <list from implement-record.json.validation.results, or manual>

## Premortem notes (if any)
- <manual>

## Learning candidates
- <list from implement-record.json.learningCandidates, or manual>
```

**Notes for the user:**

- Run this once after `/implement` completes (or retroactively). The first run will consume the `implement-record.json` and create the durable log. Subsequent runs will find no record and fall back to the existing log + your manual additions.
- The rendered `implementation-log.md` lives under `AgenticLab/implementation-logs/<workspace-key>/<pbi-id-slug>/` and is entirely markdown — no code in project source.
- If you amend the log manually after the first run, just edit the file directly. No prompt re-invocation needed unless you want to regenerate from a fresh state.
- This prompt does **not** modify project code, `.env`, or database records. It only touches `AgenticLab/implementation-logs/`.

**Example invocation (from the delivery workspace):**

```
herdr agent prompt w8:p1 "/implementation-log pbi-1-dynamic-pricing"
```

(Or from the sub session with the appropriate agent ID.)