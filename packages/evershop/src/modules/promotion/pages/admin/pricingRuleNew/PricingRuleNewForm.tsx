import PricingRuleForm from '../pricingRuleEdit+pricingRuleNew/PricingRuleForm.js';
import React from 'react';

export default function PricingRuleNewForm(props: {
  action: string;
  gridUrl: string;
  editUrlTemplate: string;
}) {
  return <PricingRuleForm {...props} />;
}

export const layout = { areaId: 'content', sortOrder: 20 };
export const query = `
  query Query {
    action: url(routeId: "createPricingRule")
    gridUrl: url(routeId: "pricingRuleGrid")
    editUrlTemplate: url(routeId: "pricingRuleEdit", params: [{ key: "id", value: "__RULE_ID__" }])
  }
`;
