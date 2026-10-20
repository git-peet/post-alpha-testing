import { Button } from '@components/common/ui/Button.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@components/common/ui/Table.js';
import { toast } from '@components/common/ui/Sonner.js';
import React, { useEffect, useState } from 'react';

interface InventoryRow {
  product_id: number;
  sku: string;
  warehouse_id: number;
  warehouse_name: string;
  location: string;
  quantity: number;
  min_threshold: number | null;
  is_low_stock: boolean;
}
interface ThresholdChange { product_id: number; warehouse_id: number; min_threshold: number; }
interface Props { inventoryUrl: string; proposalUrl: string; decisionUrl: string; adjustmentUrl: string; editUrlTemplate: string; }

export default function InventoryGrid({ inventoryUrl, proposalUrl, decisionUrl, adjustmentUrl, editUrlTemplate }: Props) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [thresholdValues, setThresholdValues] = useState<Record<string, string>>({});
  const [quantityValues, setQuantityValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ThresholdChange[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const rowKey = (row: InventoryRow) => `${row.product_id}:${row.warehouse_id}`;
  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${inventoryUrl}?page=1&page_size=100`, { headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || 'Unable to load inventory');
      const inventoryRows: InventoryRow[] = result.data || [];
      setRows(inventoryRows);
      setThresholdValues(Object.fromEntries(inventoryRows.map((row) => [rowKey(row), String(row.min_threshold ?? '')])));
      setQuantityValues(Object.fromEntries(inventoryRows.map((row) => [rowKey(row), String(row.quantity)])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load inventory');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, [inventoryUrl]);

  const saveQuantities = async () => {
    const adjustments = rows
      .filter((row) => quantityValues[rowKey(row)] !== String(row.quantity))
      .map((row) => ({ product_id: row.product_id, warehouse_id: row.warehouse_id, quantity: Number(quantityValues[rowKey(row)]) }));
    if (!adjustments.length) { toast.message('No quantity changes to save.'); return; }
    setBusy(true);
    try {
      const response = await fetch(adjustmentUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ adjustments })
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || 'Unable to save quantities');
      toast.success(`${adjustments.length} stock quantity change(s) saved.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save quantities');
    } finally { setBusy(false); }
  };

  const stage = async () => {
    const changes = rows
      .filter((row) => thresholdValues[rowKey(row)] !== String(row.min_threshold ?? ''))
      .map((row) => ({ product_id: row.product_id, warehouse_id: row.warehouse_id, min_threshold: Number(thresholdValues[rowKey(row)]) }));
    if (!changes.length) { toast.message('No threshold changes to stage.'); return; }
    setBusy(true);
    try {
      const response = await fetch(proposalUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ thresholds: changes })
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || 'Unable to stage threshold changes');
      setPending(changes);
      toast.success(`${changes.length} threshold change(s) staged for review.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to stage threshold changes');
    } finally { setBusy(false); }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await fetch(decisionUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ decision, thresholds: pending })
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || 'Unable to record threshold decision');
      setPending(null);
      toast.success(decision === 'approve' ? 'Threshold changes approved.' : 'Threshold changes rejected.');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to record threshold decision');
    } finally { setBusy(false); }
  };

  if (loading) return <p className="p-5">Loading inventory…</p>;
  return (
    <div className="space-y-4 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Stock by product and active warehouse. Threshold changes require operator review.</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void saveQuantities()}>Save stock quantities</Button>
          <Button disabled={busy || !!pending} onClick={() => void stage()}>Stage threshold changes</Button>
        </div>
      </div>
      {pending && <div className="flex items-center gap-3 rounded border p-3" role="status">
        <span>{pending.length} change(s) awaiting decision</span>
        <Button disabled={busy} onClick={() => void decide('approve')}>Approve</Button>
        <Button variant="outline" disabled={busy} onClick={() => void decide('reject')}>Reject</Button>
      </div>}
      <Table>
        <TableHeader><TableRow>
          <TableHead>Product</TableHead><TableHead>Warehouse</TableHead><TableHead>Location</TableHead>
          <TableHead>Quantity</TableHead><TableHead>Minimum threshold</TableHead><TableHead>Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center">No inventory or active warehouses found.</TableCell></TableRow>}
          {rows.map((row) => <TableRow key={rowKey(row)} className={row.is_low_stock ? 'bg-red-50 text-red-800' : undefined}>
            <TableCell><a className="text-primary underline" href={editUrlTemplate.replace('__PRODUCT_ID__', String(row.product_id))}>{row.sku}</a></TableCell>
            <TableCell>{row.warehouse_name}</TableCell><TableCell>{row.location}</TableCell>
            <TableCell><input aria-label={`Quantity for ${row.sku} at ${row.warehouse_name}`} type="number" min="0" step="1" className="w-24 rounded border px-2 py-1" value={quantityValues[rowKey(row)] ?? String(row.quantity)} onChange={(event) => setQuantityValues((old) => ({ ...old, [rowKey(row)]: event.target.value }))} /></TableCell>
            <TableCell><input aria-label={`Threshold for ${row.sku} at ${row.warehouse_name}`}  type="number" min="0" step="1" className="w-24 rounded border px-2 py-1" value={thresholdValues[rowKey(row)] ?? ''} onChange={(event) => setThresholdValues((old) => ({ ...old, [rowKey(row)]: event.target.value }))} /></TableCell>
            <TableCell><span className={row.is_low_stock ? 'font-semibold text-red-700' : 'text-green-700'}>{row.min_threshold === null ? 'No threshold' : row.is_low_stock ? 'Low stock' : 'In stock'}</span></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
  );
}

export const layout = { areaId: 'content', sortOrder: 20 };
export const query = `
  query Query {
    inventoryUrl: url(routeId: "inventory")
    proposalUrl: url(routeId: "inventoryThresholdProposal")
    decisionUrl: url(routeId: "inventoryThresholdDecision")
    adjustmentUrl: url(routeId: "inventoryAdjustment")
    editUrlTemplate: url(routeId: "inventoryEdit", params: [{ key: "id", value: "__PRODUCT_ID__" }])
  }
`;