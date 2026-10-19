import { describe, expect, it } from '@jest/globals';
import {
  calculateRuleDiscounts,
  createRuleAdjustedCartView
} from '../../services/pricingRules/pricingRuleEngine.js';

function fakeCart({ customerGroupId = 2, items }) {
  const subTotal = items.reduce((total, item) => total + item.line_total, 0);
  const subTotalInclTax = items.reduce((total, item) => total + item.line_total_incl_tax, 0);
  return {
    getData(key) {
      if (key === 'customer_group_id') return customerGroupId;
      if (key === 'sub_total') return subTotal;
      if (key === 'sub_total_incl_tax') return subTotalInclTax;
      return undefined;
    },
    getItems() {
      return items.map((item) => ({
        getId: () => item.id,
        getData: (key) => item[key]
      }));
    }
  };
}

function rule(id, priority, condition, action) {
  return { id, priority, status: 'active', condition_json: condition, action_json: action };
}

describe('pricing rule evaluator', () => {
  it('applies matching percentage then fixed rules in priority order and caps at eligible totals', () => {
    const cart = fakeCart({ items: [
      { id: 'a', line_total: 100, line_total_incl_tax: 110, category_id: 1 },
      { id: 'b', line_total: 50, line_total_incl_tax: 55, category_id: 2 }
    ] });
    const result = calculateRuleDiscounts([
      rule(1, 10, { category_ids: [1] }, { discount_type: 'percentage', amount: 20 }),
      rule(2, 20, {}, { discount_type: 'fixed', amount: 30, free_shipping: true })
    ], cart, { priceIncludingTax: false, now: Date.parse('2026-06-01T00:00:00.000Z') });

    expect(result.discounts.get('a')).toBe(38.46);
    expect(result.discounts.get('b')).toBe(11.54);
    expect(result.totalDiscount).toBe(50);
    expect(result.freeShipping).toBe(true);
  });

  it('filters on subtotal, customer group, category, and date window', () => {
    const cart = fakeCart({ customerGroupId: 3, items: [
      { id: 'a', line_total: 20, line_total_incl_tax: 22, category_id: 4 }
    ] });
    const result = calculateRuleDiscounts([
      rule(1, 1, {
        minimum_cart_amount: 10,
        customer_group_ids: [3],
        category_ids: [4],
        starts_at: '2026-01-01T00:00:00.000Z',
        ends_at: '2026-12-31T00:00:00.000Z'
      }, { discount_type: 'fixed', amount: 100 })
    ], cart, { now: Date.parse('2026-06-01T00:00:00.000Z') });
    expect(result.discounts.get('a')).toBe(20);
  });

  it('exposes remaining line totals to the existing coupon calculator', async () => {
    const cart = fakeCart({ items: [
      { id: 'a', line_total: 100, line_total_incl_tax: 110, category_id: 1, qty: 1 }
    ] });
    const evaluation = calculateRuleDiscounts([
      rule(1, 1, {}, { discount_type: 'fixed', amount: 20 })
    ], cart, { priceIncludingTax: false });
    const couponDiscounts = new Map();
    const adjusted = createRuleAdjustedCartView(cart, evaluation, false, couponDiscounts);
    expect(adjusted.adjustedSubtotal).toBe(80);
    expect(adjusted.cart.getData('sub_total')).toBe(80);
    expect(adjusted.cart.getItems()[0].getData('line_total')).toBe(80);
    await adjusted.cart.getItems()[0].setData('discount_amount', 5);
    expect(couponDiscounts.get('a')).toBe(5);
  });

  it('does not apply an expired or nonmatching customer-group rule', () => {
    const cart = fakeCart({ customerGroupId: 9, items: [
      { id: 'a', line_total: 20, line_total_incl_tax: 22, category_id: 4 }
    ] });
    const result = calculateRuleDiscounts([
      rule(1, 1, { customer_group_ids: [3], ends_at: '2026-01-01T00:00:00.000Z' }, {
        discount_type: 'fixed', amount: 10, free_shipping: true
      })
    ], cart, { now: Date.parse('2026-06-01T00:00:00.000Z') });
    expect(result.totalDiscount).toBe(0);
    expect(result.freeShipping).toBe(false);
  });
});
