import { PageHeading } from '@components/admin/PageHeading.js';
import { Button } from '@components/common/ui/Button.js';
import { _ } from '@evershop/evershop/lib/locale/translate/_';
import React from 'react';

export default function PricingRuleGridHeading({ newUrl }: { newUrl: string }) {
  return (
    <div className="flex items-center justify-between">
      <PageHeading heading={_('Pricing Rules')} />
      <Button onClick={() => { window.location.href = newUrl; }}>{_('New rule')}</Button>
    </div>
  );
}

export const layout = { areaId: 'content', sortOrder: 10 };
export const query = `
  query Query {
    newUrl: url(routeId: "pricingRuleNew")
  }
`;
