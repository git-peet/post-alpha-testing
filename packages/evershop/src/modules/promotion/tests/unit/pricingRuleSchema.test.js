import { describe, expect, it } from '@jest/globals';
import { normalizePricingRuleInput } from '../../services/pricingRules/pricingRuleSchema.js';

const validRule = {
  name: 'Category sale',
  description: 'Twenty percent off category 2',
  priority: 5,
  condition_json: {
    minimum_cart_amount: 50,
    customer_group_ids: [2, 1, 2],
    category_ids: [8],
    starts_at: '2026-01-01T00:00:00.000Z',
    ends_at: '2026-12-31T00:00:00.000Z'
  },
  action_json: { discount_type: 'percentage', amount: 20, free_shipping: false }
};

describe('pricing rule input validation', () => {
  it('normalizes IDs and validates a percentage rule', () => {
    const rule = normalizePricingRuleInput(validRule);
    expect(rule.condition_json.customer_group_ids).toEqual([1, 2]);
    expect(rule.condition_json.category_ids).toEqual([8]);
    expect(rule.action_json).toEqual({ discount_type: 'percentage', amount: 20, free_shipping: false });
  });

  it('normalizes empty condition values so duplicate checks compare equivalent rules', () => {
    const rule = normalizePricingRuleInput({
      ...validRule,
      condition_json: {
        minimum_cart_amount: 0,
        customer_group_ids: [],
        category_ids: [],
        starts_at: null,
        ends_at: null
      }
    });
    expect(rule.condition_json).toEqual({});
  });

  it('accepts a free-shipping-only action', () => {
    const rule = normalizePricingRuleInput({
      ...validRule,
      action_json: { discount_type: 'none', free_shipping: true }
    });
    expect(rule.action_json).toEqual({ discount_type: 'none', free_shipping: true });
  });

  it('rejects an invalid percentage', () => {
    expect(() => normalizePricingRuleInput({
      ...validRule,
      action_json: { discount_type: 'percentage', amount: 100.1, free_shipping: false }
    })).toThrow('Percentage discount cannot exceed 100');
  });

  it('rejects an inverted date range', () => {
    expect(() => normalizePricingRuleInput({
      ...validRule,
      condition_json: { starts_at: '2026-12-01T00:00:00.000Z', ends_at: '2026-01-01T00:00:00.000Z' }
    })).toThrow('End date must be later than start date');
  });

  it('requires a discount or free shipping', () => {
    expect(() => normalizePricingRuleInput({
      ...validRule,
      action_json: { discount_type: 'none', free_shipping: false }
    })).toThrow('Choose a discount or enable free shipping');
  });
});
