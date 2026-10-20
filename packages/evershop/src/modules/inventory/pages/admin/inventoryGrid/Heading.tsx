import { PageHeading } from '@components/admin/PageHeading.js';
import { Button } from '@components/common/ui/Button.js';
import React from 'react';

export default function InventoryGridHeading({ newWarehouseUrl }: { newWarehouseUrl: string }) {
  return (
    <div className="flex items-center justify-between">
      <PageHeading heading="Multi-Warehouse Inventory" />
      <Button onClick={() => { window.location.href = newWarehouseUrl; }}>Add warehouse</Button>
    </div>
  );
}

export const layout = { areaId: 'content', sortOrder: 10 };
export const query = `query Query { newWarehouseUrl: url(routeId: "inventoryNew") }`;