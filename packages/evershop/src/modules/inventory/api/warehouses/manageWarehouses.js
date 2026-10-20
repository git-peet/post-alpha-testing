import {
  createWarehouse,
  getWarehouses,
  InventoryServiceError
} from '../../services/inventoryService.js';

export default async (request, response, next) => {
  try {
    if (request.method === 'POST') {
      const warehouse = await createWarehouse(request.body || {});
      response.status(201).json({ data: warehouse });
      return;
    }
    const warehouses = await getWarehouses();
    response.status(200).json({ data: warehouses });
  } catch (error) {
    const status = error instanceof InventoryServiceError ? error.statusCode : 500;
    response.status(status).json({
      error: { status, message: error instanceof Error ? error.message : 'Unable to manage warehouses' }
    });
  }
};