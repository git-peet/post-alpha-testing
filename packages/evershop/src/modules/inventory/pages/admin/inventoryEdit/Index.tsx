import InventoryGrid from '../inventoryGrid/Grid.js';
import React from 'react';

export default function InventoryProductEdit(props: {
  inventoryUrl: string;
  proposalUrl: string;
  decisionUrl: string;
  adjustmentUrl: string;
  editUrlTemplate: string;
}) {
  return <InventoryGrid {...props} />;
}

export const layout = { areaId: 'content', sortOrder: 20 };
export const query = `
  query Query {
    inventoryUrl: url(routeId: "productInventory", params: [{ key: "product_id", value: getContextValue("inventoryProductId") }])
    proposalUrl: url(routeId: "inventoryThresholdProposal")
    decisionUrl: url(routeId: "inventoryThresholdDecision")
    adjustmentUrl: url(routeId: "inventoryAdjustment")
    editUrlTemplate: url(routeId: "inventoryEdit", params: [{ key: "id", value: "__PRODUCT_ID__" }])
  }
`;