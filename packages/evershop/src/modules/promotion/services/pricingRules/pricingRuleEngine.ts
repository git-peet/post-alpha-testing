import { pool } from '../../../../lib/postgres/connection.js';
import { getValueSync } from '../../../../lib/util/registry.js';
import { getPriceIncludingTax } from '../../../tax/services/taxSettings.js';
import { toPrice } from '../../../checkout/services/toPrice.js';
import type { PricingRuleRow } from '../../../../types/db/index.js';

export interface RuleDiscountEvaluation {
  discounts: Map<string, number>;
  freeShipping: boolean;
  totalDiscount: number;
}

interface CartLike {
  getData(key: string): any;
  getItems(): Array<{ getId(): string; getData(key: string): any }>;
}

function parseJson(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function money(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isRuleEligible(rule: PricingRuleRow, cart: CartLike, subtotal: number, now: number): boolean {
  if (rule.status !== 'active') return false;
  const condition = parseJson(rule.condition_json);
  if (condition.minimum_cart_amount !== undefined && subtotal < Number(condition.minimum_cart_amount)) return false;
  const groups = Array.isArray(condition.customer_group_ids) ? condition.customer_group_ids.map(Number) : [];
  if (groups.length > 0 && !groups.includes(Number(cart.getData('customer_group_id')))) return false;
  if (condition.starts_at && now < Date.parse(condition.starts_at)) return false;
  if (condition.ends_at && now > Date.parse(condition.ends_at)) return false;
  return true;
}

/** Pure rule evaluator used by the cart integration and unit tests. */
export function calculateRuleDiscounts(
  rules: PricingRuleRow[],
  cart: CartLike,
  { priceIncludingTax = false, now = Date.now() }: { priceIncludingTax?: boolean; now?: number } = {}
): RuleDiscountEvaluation {
  const items = cart.getItems();
  const baseById = new Map<string, number>();
  for (const item of items) {
    baseById.set(
      item.getId(),
      money(item.getData(priceIncludingTax ? 'line_total_incl_tax' : 'line_total'))
    );
  }
  const subtotal = [...baseById.values()].reduce((sum, amount) => sum + amount, 0);
  const discounts = new Map<string, number>();
  let freeShipping = false;

  const orderedRules = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const rule of orderedRules) {
    if (!isRuleEligible(rule, cart, subtotal, now)) continue;
    const condition = parseJson(rule.condition_json);
    const categoryIds = Array.isArray(condition.category_ids) ? condition.category_ids.map(Number) : [];
    const eligible = items.filter((item) =>
      categoryIds.length === 0 || categoryIds.includes(Number(item.getData('category_id')))
    );
    if (eligible.length === 0) continue;

    const action = parseJson(rule.action_json);
    if (action.free_shipping === true) freeShipping = true;
    if (!['fixed', 'percentage'].includes(action.discount_type)) continue;

    const remainingById = new Map<string, number>();
    for (const item of eligible) {
      const id = item.getId();
      remainingById.set(id, Math.max(0, (baseById.get(id) ?? 0) - (discounts.get(id) ?? 0)));
    }
    const eligibleTotal = [...remainingById.values()].reduce((sum, amount) => sum + amount, 0);
    if (eligibleTotal <= 0) continue;

    if (action.discount_type === 'percentage') {
      const percentage = Number(action.amount);
      if (!Number.isFinite(percentage) || percentage <= 0) continue;
      for (const [id, remaining] of remainingById) {
        const discount = Math.min(remaining, Number(toPrice(String((remaining * percentage) / 100))));
        discounts.set(id, Number(toPrice(String((discounts.get(id) ?? 0) + discount))));
      }
      continue;
    }

    let amountLeft = Math.min(money(action.amount), eligibleTotal);
    const eligibleEntries = [...remainingById.entries()].filter(([, remaining]) => remaining > 0);
    let allocated = 0;
    eligibleEntries.forEach(([id, remaining], index) => {
      const remainingBudget = Math.max(0, amountLeft - allocated);
      const proportionalShare = (amountLeft * remaining) / eligibleTotal;
      const requestedShare = index === eligibleEntries.length - 1
        ? remainingBudget
        : Number(toPrice(String(proportionalShare)));
      const share = Number(toPrice(String(Math.min(remaining, remainingBudget, requestedShare))));
      discounts.set(id, Number(toPrice(String((discounts.get(id) ?? 0) + share))));
      allocated += share;
    });
  }

  const totalDiscount = Number(toPrice(String([...discounts.values()].reduce((sum, amount) => sum + amount, 0))));
  return { discounts, freeShipping, totalDiscount };
}

export async function evaluatePricingRules(cart: CartLike): Promise<RuleDiscountEvaluation> {
  const loadRules = getValueSync('pricingRulesLoaderFunction', () => async () => {
    const result = await pool.query(
      `SELECT id, name, description, condition_json, action_json, priority, status, created_at, updated_at
       FROM pricing_rules
       WHERE status = 'active'
       ORDER BY priority ASC, id ASC`
    );
    return result.rows;
  }, {});
  const rules = await loadRules();
  return calculateRuleDiscounts(rules as PricingRuleRow[], cart, {
    priceIncludingTax: getPriceIncludingTax()
  });
}

/** Build a read-only cart/item view so coupon calculators see prices after rules. */
export function createRuleAdjustedCartView(
  cart: CartLike,
  evaluation: RuleDiscountEvaluation,
  priceIncludingTax: boolean,
  couponDiscounts: Map<string, number>
) {
  const baseSubtotal = money(cart.getData(priceIncludingTax ? 'sub_total_incl_tax' : 'sub_total'));
  const adjustedSubtotal = Math.max(0, baseSubtotal - evaluation.totalDiscount);
  const wrappedItems = cart.getItems().map((item) => {
    const id = item.getId();
    const ruleDiscount = evaluation.discounts.get(id) ?? 0;
    const baseQty = Math.max(1, Number(item.getData('qty')) || 1);
    const unitDiscount = ruleDiscount / baseQty;
    return new Proxy(item, {
      get(target, property) {
        if (property === 'getData') {
          return (key: string) => {
            if (key === 'discount_amount') return couponDiscounts.get(id) ?? 0;
            if (key === 'line_total') return Math.max(0, money(target.getData('line_total')) - (priceIncludingTax ? 0 : ruleDiscount));
            if (key === 'line_total_incl_tax') return Math.max(0, money(target.getData('line_total_incl_tax')) - (priceIncludingTax ? ruleDiscount : 0));
            if (key === 'final_price') return Math.max(0, money(target.getData('final_price')) - (priceIncludingTax ? 0 : unitDiscount));
            if (key === 'final_price_incl_tax') return Math.max(0, money(target.getData('final_price_incl_tax')) - (priceIncludingTax ? unitDiscount : 0));
            return target.getData(key);
          };
        }
        if (property === 'setData') {
          return async (key: string, value: number) => {
            if (key === 'discount_amount') {
              couponDiscounts.set(id, money(value));
              return value;
            }
            return (target as any).setData(key, value);
          };
        }
        if (property === 'getCart') return () => cartView;
        const value = Reflect.get(target as any, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  });

  const cartView = new Proxy(cart as any, {
    get(target, property) {
      if (property === 'getItems') return () => wrappedItems;
      if (property === 'getData') {
        return (key: string) => {
          if (key === 'sub_total') return Math.max(0, money(target.getData('sub_total')) - (priceIncludingTax ? 0 : evaluation.totalDiscount));
          if (key === 'sub_total_incl_tax') return Math.max(0, money(target.getData('sub_total_incl_tax')) - (priceIncludingTax ? evaluation.totalDiscount : 0));
          return target.getData(key);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

  return { cart: cartView, adjustedSubtotal };
}
