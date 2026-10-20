import {
  getInventoryByProduct,
  getInventoryGrid,
  InventoryServiceError
} from '../../services/inventoryService.js';

export default async (request, response, next) => {
  try {
    const productId = request.query.product_id;
    if (productId !== undefined) {
      const rows = await getInventoryByProduct(productId);
      response.status(200).json({ data: rows });
      return;
    }
    const result = await getInventoryGrid({
      page: request.query.page,
      pageSize: request.query.page_size
    });
    response.status(200).json({
      data: result.rows,
      pagination: { page: result.page, page_size: result.pageSize, total: result.total }
    });
  } catch (error) {
    const status = error instanceof InventoryServiceError ? error.statusCode : 500;
    response.status(status).json({
      error: { status, message: error instanceof Error ? error.message : 'Unable to load inventory' }
    });
  }
};