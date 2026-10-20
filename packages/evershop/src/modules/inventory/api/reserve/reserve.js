import {
  InventoryServiceError,
  reserveInventory
} from '../../services/inventoryService.js';

export default async (request, response, next) => {
  try {
    const result = await reserveInventory(
      request.body?.product_id,
      request.body?.warehouse_id,
      request.body?.qty
    );
    response.status(200).json({ data: result });
  } catch (error) {
    const status = error instanceof InventoryServiceError ? error.statusCode : 500;
    response.status(status).json({
      error: { status, message: error instanceof Error ? error.message : 'Reserve failed' }
    });
  }
};