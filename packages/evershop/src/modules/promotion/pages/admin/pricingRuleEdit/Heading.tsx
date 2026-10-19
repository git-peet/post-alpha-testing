import { PageHeading } from '@components/admin/PageHeading.js';
import { _ } from '@evershop/evershop/lib/locale/translate/_';
import React from 'react';

export default function PricingRuleEditHeading() {
  return <PageHeading heading={_('Edit pricing rule')} />;
}

export const layout = { areaId: 'content', sortOrder: 10 };
