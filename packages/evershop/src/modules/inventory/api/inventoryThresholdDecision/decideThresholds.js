import {
  decideThresholdChanges,
  InventoryServiceError
} from '../../services/inventoryService.js';

export default async (request, response, next) => {
  try {
    const result = await decideThresholdChanges(
      request.body?.thresholds,
      request.body?.decision
    );
    response.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof InventoryServiceError ? error.statusCode : 500;
    response.status(status).json({
      error: { status, message: error instanceof Error ? error.message : 'Unable to decide threshold changes' }
    });
  }
};