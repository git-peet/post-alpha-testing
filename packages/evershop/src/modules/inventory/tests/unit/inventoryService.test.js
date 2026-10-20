import { describe, expect, it } from '@jest/globals';
import {
  crossedBelowThreshold,
  normalizeInventoryAdjustments,
  normalizeThresholdChanges
} from '../../services/inventoryService.js';

describe('inventory threshold rules', () => {
  it('normalizes valid threshold entries and rejects duplicate pairs', () => {
    expect(normalizeThresholdChanges([
      { product_id: 1, warehouse_id: 2, min_threshold: 5 }
    ])).toEqual([{ product_id: 1, warehouse_id: 2, min_threshold: 5 }]);
    expect(() => normalizeThresholdChanges([
      { product_id: 1, warehouse_id: 2, min_threshold: 5 },
      { product_id: 1, warehouse_id: 2, min_threshold: 6 }
    ])).toThrow('Duplicate product/warehouse threshold entry');
  });

  it('requires positive IDs and nonnegative integer thresholds', () => {
    expect(() => normalizeThresholdChanges([
      { product_id: 0, warehouse_id: 2, min_threshold: 5 }
    ])).toThrow('product_id must be a positive integer');
    expect(() => normalizeThresholdChanges([
      { product_id: 1, warehouse_id: 2, min_threshold: -1 }
    ])).toThrow('min_threshold must be a nonnegative integer');
  });

  it('validates nonnegative stock adjustments and rejects duplicate pairs', () => {
    expect(normalizeInventoryAdjustments([
      { product_id: 1, warehouse_id: 2, quantity: 0 }
    ])).toEqual([{ product_id: 1, warehouse_id: 2, quantity: 0 }]);
    expect(() => normalizeInventoryAdjustments([
      { product_id: 1, warehouse_id: 2, quantity: 1 },
      { product_id: 1, warehouse_id: 2, quantity: 2 }
    ])).toThrow('Duplicate product/warehouse adjustment');
    expect(() => normalizeInventoryAdjustments([
      { product_id: 1, warehouse_id: 2, quantity: -1 }
    ])).toThrow('quantity must be a nonnegative integer');
  });

  it('detects only downward threshold crossings', () => {
    expect(crossedBelowThreshold(10, 9, 10)).toBe(true);
    expect(crossedBelowThreshold(9, 8, 10)).toBe(false);
    expect(crossedBelowThreshold(8, 12, 10)).toBe(false);
    expect(crossedBelowThreshold(10, 10, 10)).toBe(false);
  });
});