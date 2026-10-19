import { NavigationItemGroup } from '@components/admin/NavigationItemGroup.js';
import { _ } from '@evershop/evershop/lib/locale/translate/_';
import { GiftIcon } from 'lucide-react';
import React from 'react';

interface CouponMenuGroupProps {
  couponGrid: string;
  pricingRuleGrid: string;
}

export default function CatalogMenuGroup({ couponGrid, pricingRuleGrid }: CouponMenuGroupProps) {
  return (
    <NavigationItemGroup
      id="couponMenuGroup"
      name={_('Promotion')}
      items={[
        {
          Icon: GiftIcon,
          url: couponGrid,
          title: _('Coupons')
        },
        {
          Icon: GiftIcon,
          url: pricingRuleGrid,
          title: _('Pricing Rules')
        }
      ]}
    />
  );
}

export const layout = {
  areaId: 'adminMenu',
  sortOrder: 50
};

export const query = `
  query Query {
    couponGrid: url(routeId:"couponGrid")
    pricingRuleGrid: url(routeId:"pricingRuleGrid")
  }
`;
