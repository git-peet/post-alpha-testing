import path from 'path';
import { pathToFileURL } from 'url';
import { CONSTANTS } from '../../../../lib/helpers.js';
import { warning } from '../../../../lib/log/logger.js';

/** Emit only the allowlisted event; rule data is never passed to the harness adapter. */
export async function recordCandidateStagedMetric(): Promise<void> {
  try {
    const adapterPath = path.resolve(
      CONSTANTS.ROOTPATH,
      'AgenticLab/adapters/pi/knowledge-capture-metrics.mjs'
    );
    const adapter = await import(pathToFileURL(adapterPath).href);
    await adapter.recordKnowledgeCaptureMetric('candidate_staged', {
      workspaceRoot: CONSTANTS.ROOTPATH
    });
  } catch (error) {
    // Metrics are observational; a metrics-write failure must not roll back
    // a successfully-created business rule.
    warning(`Could not record candidate_staged metric: ${(error as Error).message}`);
  }
}
