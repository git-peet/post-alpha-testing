import { Button } from '@components/common/ui/Button.js';
import { toast } from '@components/common/ui/Sonner.js';
import React, { useState } from 'react';

export default function WarehouseForm({ warehouseUrl, gridUrl }: { warehouseUrl: string; gridUrl: string }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(warehouseUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, location, timezone })
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || 'Unable to create warehouse');
      toast.success('Warehouse created.');
      window.location.href = gridUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create warehouse');
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="max-w-xl space-y-4 rounded-md border bg-card p-5">
      <label className="block space-y-1"><span>Warehouse name</span><input required maxLength={255} className="w-full rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block space-y-1"><span>Location</span><input className="w-full rounded border px-3 py-2" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
      <label className="block space-y-1"><span>Timezone (IANA)</span><input required className="w-full rounded border px-3 py-2" value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create warehouse'}</Button><Button type="button" variant="outline" onClick={() => { window.location.href = gridUrl; }}>Cancel</Button></div>
    </form>
  );
}
export const layout = { areaId: 'content', sortOrder: 20 };
export const query = `query Query { warehouseUrl: url(routeId: "warehouses") gridUrl: url(routeId: "inventoryGrid") }`;