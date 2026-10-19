import PricingRuleForm from '../pricingRuleEdit+pricingRuleNew/PricingRuleForm.js';
import React from 'react';

export default function PricingRuleEditForm(props: {
  action: string;
  ruleUrl: string;
  gridUrl: string;
  editUrlTemplate: string;
}) {
  const ruleId = props.ruleUrl.split('/').filter(Boolean).at(-1);
  return <PricingRuleForm {...props} ruleId={ruleId} />;
}

export const layout = { areaId: 'content', sortOrder: 20 };
export const query = `
  query Query {
    action: url(routeId: "updatePricingRule", params: [{ key: "id", value: getContextValue("pricingRuleId") }])
    ruleUrl: url(routeId: "getPricingRule", params: [{ key: "id", value: getContextValue("pricingRuleId") }])
    gridUrl: url(routeId: "pricingRuleGrid")
    editUrlTemplate: url(routeId: "pricingRuleEdit", params: [{ key: "id", value: "__RULE_ID__" }])
  }
`;
