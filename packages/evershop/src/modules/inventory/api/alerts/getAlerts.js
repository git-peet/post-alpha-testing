import {
  getOpenStockAlerts,
  InventoryServiceError
} from '../../services/inventoryService.js';

export default async (request, response, next) => {
  try {
    const rows = await getOpenStockAlerts(request.query.product_id);
    response.status(200).json({ data: rows });
  } catch (error) {
    const status = error instanceof InventoryServiceError ? error.statusCode : 500;
    response.status(status).json({
      error: { status, message: error instanceof Error ? error.message : 'Unable to load alerts' }
    });
  }
};