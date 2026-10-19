export type PricingRuleStatus = 'pending' | 'active' | 'archived';

export interface PricingRuleCondition {
  minimum_cart_amount?: number;
  customer_group_ids?: number[];
  category_ids?: number[];
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface PricingRuleAction {
  discount_type: 'fixed' | 'percentage' | 'none';
  amount?: number;
  free_shipping: boolean;
}

export interface PricingRuleInput {
  name: string;
  description?: string;
  priority?: number;
  condition_json: PricingRuleCondition | string;
  action_json: PricingRuleAction | string;
}

function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function positiveIdArray(value: unknown, label: string): number[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').map((part) => part.trim()).filter(Boolean)
      : null;
  if (!values) throw new Error(`${label} must be an array of positive integer IDs`);
  const ids = values.map((item) => Number(item));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error(`${label} must contain only positive integer IDs`);
  }
  return [...new Set(ids)].sort((a, b) => a - b);
}

function optionalDate(value: unknown, label: string): string | null | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === null) return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a valid date-time`);
  }
  return new Date(value).toISOString();
}

export function normalizePricingRuleInput(input: PricingRuleInput) {
  if (!input || typeof input !== 'object') throw new Error('Rule data is required');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 255) throw new Error('Name is required and must be at most 255 characters');
  const description = input.description === undefined ? '' : input.description;
  if (typeof description !== 'string' || description.length > 4000) {
    throw new Error('Description must be a string of at most 4000 characters');
  }
  const priority = input.priority === undefined ? 100 : Number(input.priority);
  if (!Number.isSafeInteger(priority) || priority < 0) {
    throw new Error('Priority must be a non-negative integer');
  }

  const rawCondition = parseJsonObject(input.condition_json, 'Conditions');
  const allowedConditions = new Set([
    'minimum_cart_amount',
    'customer_group_ids',
    'category_ids',
    'starts_at',
    'ends_at'
  ]);
  if (Object.keys(rawCondition).some((key) => !allowedConditions.has(key))) {
    throw new Error('Conditions contain an unsupported field');
  }
  const condition: PricingRuleCondition = {};
  if (rawCondition.minimum_cart_amount !== undefined && rawCondition.minimum_cart_amount !== '') {
    const amount = Number(rawCondition.minimum_cart_amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Minimum cart amount must be a non-negative number');
    }
    if (amount > 0) condition.minimum_cart_amount = amount;
  }
  const groups = positiveIdArray(rawCondition.customer_group_ids, 'Customer groups');
  const categories = positiveIdArray(rawCondition.category_ids, 'Categories');
  if (groups?.length) condition.customer_group_ids = groups;
  if (categories?.length) condition.category_ids = categories;
  const startsAt = optionalDate(rawCondition.starts_at, 'Start date');
  const endsAt = optionalDate(rawCondition.ends_at, 'End date');
  if (startsAt !== undefined) condition.starts_at = startsAt;
  if (endsAt !== undefined) condition.ends_at = endsAt;
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new Error('End date must be later than start date');
  }

  const rawAction = parseJsonObject(input.action_json, 'Action');
  if (Object.keys(rawAction).some((key) => !['discount_type', 'amount', 'free_shipping'].includes(key))) {
    throw new Error('Action contains an unsupported field');
  }
  const discountType = rawAction.discount_type;
  if (!['fixed', 'percentage', 'none'].includes(String(discountType))) {
    throw new Error('Discount type must be fixed, percentage, or none');
  }
  const freeShipping = rawAction.free_shipping === true;
  if (rawAction.free_shipping !== undefined && typeof rawAction.free_shipping !== 'boolean') {
    throw new Error('Free shipping must be a boolean');
  }
  const action: PricingRuleAction = {
    discount_type: discountType as PricingRuleAction['discount_type'],
    free_shipping: freeShipping
  };
  if (discountType === 'fixed' || discountType === 'percentage') {
    const amount = Number(rawAction.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Discount amount must be greater than zero');
    if (discountType === 'percentage' && amount > 100) {
      throw new Error('Percentage discount cannot exceed 100');
    }
    action.amount = amount;
  } else if (rawAction.amount !== undefined) {
    throw new Error('Amount is only valid for fixed or percentage discounts');
  }
  if (discountType === 'none' && !freeShipping) {
    throw new Error('Choose a discount or enable free shipping');
  }

  return { name, description, priority, condition_json: condition, action_json: action };
}
