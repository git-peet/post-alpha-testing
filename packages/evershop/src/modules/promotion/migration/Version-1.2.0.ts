import { execute } from '@evershop/postgres-query-builder';
import type { PoolClient } from '@evershop/postgres-query-builder';

export default async (connection: PoolClient): Promise<void> => {
  await execute(
    connection,
    `CREATE TABLE pricing_rules (
      id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      condition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      action_json JSONB NOT NULL,
      priority INT NOT NULL DEFAULT 100 CHECK (priority >= 0),
      status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'archived')),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT pricing_rules_condition_object CHECK (jsonb_typeof(condition_json) = 'object'),
      CONSTRAINT pricing_rules_action_object CHECK (jsonb_typeof(action_json) = 'object')
    )`
  );
  await execute(
    connection,
    `CREATE INDEX pricing_rules_status_priority_idx
       ON pricing_rules(status, priority, id)`
  );
  // JSONB equality is structural, so object key order does not allow duplicate
  // active rules. Pending and archived duplicates remain available for review/history.
  await execute(
    connection,
    `CREATE UNIQUE INDEX pricing_rules_active_condition_action_unique
       ON pricing_rules(condition_json, action_json)
       WHERE status = 'active'`
  );
};
