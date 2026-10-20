import {
  adjustInventory,
  InventoryServiceError
} from '../../services/inventoryService.js';

export default async (request, response, next) => {
  try {
    const result = await adjustInventory(request.body?.adjustments);
    response.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof InventoryServiceError ? error.statusCode : 500;
    response.status(status).json({
      error: { status, message: error instanceof Error ? error.message : 'Unable to adjust inventory' }
    });
  }
};