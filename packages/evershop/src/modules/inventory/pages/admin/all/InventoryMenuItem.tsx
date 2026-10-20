import { NavigationItem } from '@components/admin/NavigationItem.js';
import { _ } from '@evershop/evershop/lib/locale/translate/_';
import { LayoutTemplate } from 'lucide-react';
import React from 'react';

interface InventoryMenuItemProps {
  inventoryGrid: string;
}

export default function InventoryMenuItem({ inventoryGrid }: InventoryMenuItemProps) {
  return (
    <NavigationItem
      Icon={LayoutTemplate}
      url={inventoryGrid}
      title={_('Inventory')}
    />
  );
}

export const layout = {
  areaId: 'couponMenuGroup',
  sortOrder: 30
};

export const query = `
  query Query {
    inventoryGrid: url(routeId: "inventoryGrid")
  }
`;