import {
  commit,
  insert,
  rollback,
  startTransaction,
  update
} from '@evershop/postgres-query-builder';
import { getConnection, pool } from '../../../../lib/postgres/connection.js';
import type { PricingRuleRow } from '../../../../types/db/index.js';
import { recordCandidateStagedMetric } from './recordCandidateStagedMetric.js';
import {
  normalizePricingRuleInput,
  PricingRuleInput
} from './pricingRuleSchema.js';

export class DuplicateActivePricingRuleError extends Error {
  constructor() {
    super('An active rule with the same conditions and action already exists');
    this.name = 'DuplicateActivePricingRuleError';
  }
}

export class PricingRuleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingRuleConflictError';
  }
}

function mapDuplicateError(error: any): never {
  if (error?.code === '23505' && error?.constraint === 'pricing_rules_active_condition_action_unique') {
    throw new DuplicateActivePricingRuleError();
  }
  throw error;
}

export async function listPricingRules(
  status: 'active' | 'pending' | 'archived' | 'all' = 'active'
): Promise<PricingRuleRow[]> {
  if (!['active', 'pending', 'archived', 'all'].includes(status)) {
    throw new Error('Status must be active, pending, archived, or all');
  }
  const result = status === 'all'
    ? await pool.query('SELECT * FROM pricing_rules ORDER BY priority ASC, id ASC')
    : await pool.query(
        'SELECT * FROM pricing_rules WHERE status = $1 ORDER BY priority ASC, id ASC',
        [status]
      );
  return result.rows as PricingRuleRow[];
}

export async function getPricingRule(id: number): Promise<PricingRuleRow | null> {
  const result = await pool.query('SELECT * FROM pricing_rules WHERE id = $1', [id]);
  return (result.rows[0] as PricingRuleRow | undefined) ?? null;
}

export async function createPricingRule(input: PricingRuleInput): Promise<PricingRuleRow> {
  const data = normalizePricingRuleInput(input);
  const connection = await getConnection();
  await startTransaction(connection);
  let rule: PricingRuleRow;
  try {
    rule = await insert('pricing_rules')
      .given({ ...data, status: 'pending' })
      .execute(connection) as PricingRuleRow;
    await commit(connection);
  } catch (error) {
    await rollback(connection);
    throw error;
  }
  await recordCandidateStagedMetric();
  return rule;
}

export async function updatePendingPricingRule(
  id: number,
  input: PricingRuleInput
): Promise<PricingRuleRow> {
  const data = normalizePricingRuleInput(input);
  const connection = await getConnection();
  await startTransaction(connection);
  try {
    const current = await connection.query(
      'SELECT * FROM pricing_rules WHERE id = $1 FOR UPDATE',
      [id]
    );
    const rule = current.rows[0] as PricingRuleRow | undefined;
    if (!rule) throw new Error('Pricing rule not found');
    if (rule.status !== 'pending') {
      throw new PricingRuleConflictError('Only pending rules can be edited');
    }
    await update('pricing_rules')
      .given({ ...data, updated_at: new Date() })
      .where('id', '=', id)
      .execute(connection);
    const updated = await connection.query('SELECT * FROM pricing_rules WHERE id = $1', [id]);
    await commit(connection);
    return updated.rows[0] as PricingRuleRow;
  } catch (error) {
    await rollback(connection);
    throw error;
  }
}

export async function approvePricingRule(id: number): Promise<PricingRuleRow> {
  const connection = await getConnection();
  await startTransaction(connection);
  try {
    const selected = await connection.query(
      'SELECT * FROM pricing_rules WHERE id = $1 FOR UPDATE',
      [id]
    );
    const rule = selected.rows[0] as PricingRuleRow | undefined;
    if (!rule) throw new Error('Pricing rule not found');
    if (rule.status !== 'pending') {
      throw new PricingRuleConflictError('Only pending rules can be approved');
    }
    await update('pricing_rules')
      .given({ status: 'active', updated_at: new Date() })
      .where('id', '=', id)
      .execute(connection);
    const approved = await connection.query('SELECT * FROM pricing_rules WHERE id = $1', [id]);
    await commit(connection);
    return approved.rows[0] as PricingRuleRow;
  } catch (error) {
    await rollback(connection);
    mapDuplicateError(error);
  }
}

export async function archivePricingRule(id: number): Promise<PricingRuleRow> {
  const connection = await getConnection();
  await startTransaction(connection);
  try {
    const selected = await connection.query(
      'SELECT * FROM pricing_rules WHERE id = $1 FOR UPDATE',
      [id]
    );
    const rule = selected.rows[0] as PricingRuleRow | undefined;
    if (!rule) throw new Error('Pricing rule not found');
    if (rule.status === 'archived') {
      throw new PricingRuleConflictError('Pricing rule is already archived');
    }
    await update('pricing_rules')
      .given({ status: 'archived', updated_at: new Date() })
      .where('id', '=', id)
      .execute(connection);
    const archived = await connection.query('SELECT * FROM pricing_rules WHERE id = $1', [id]);
    await commit(connection);
    return archived.rows[0] as PricingRuleRow;
  } catch (error) {
    await rollback(connection);
    throw error;
  }
}
