import {
  InventoryServiceError,
  proposeThresholdChanges
} from '../../services/inventoryService.js';

export default async (request, response, next) => {
  try {
    const thresholds = await proposeThresholdChanges(request.body?.thresholds);
    response.status(200).json({ data: { proposed: thresholds.length } });
  } catch (error) {
    const status = error instanceof InventoryServiceError ? error.statusCode : 500;
    response.status(status).json({
      error: { status, message: error instanceof Error ? error.message : 'Unable to stage threshold changes' }
    });
  }
};