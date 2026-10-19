import { Button } from '@components/common/ui/Button.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@components/common/ui/Table.js';
import { toast } from '@components/common/ui/Sonner.js';
import { _ } from '@evershop/evershop/lib/locale/translate/_';
import React, { useEffect, useState } from 'react';

interface PricingRule {
  id: number;
  name: string;
  description: string;
  condition_json: Record<string, unknown>;
  action_json: { discount_type?: string; amount?: number; free_shipping?: boolean };
  priority: number;
  status: 'pending' | 'active' | 'archived';
}

interface Props {
  listUrl: string;
  editUrlTemplate: string;
  approveUrlTemplate: string;
  archiveUrlTemplate: string;
}

export default function PricingRuleGrid({ listUrl, editUrlTemplate, approveUrlTemplate, archiveUrlTemplate }: Props) {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${listUrl}?status=all`, { headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || _('Unable to load pricing rules'));
      setRules(result.data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : _('Unable to load pricing rules'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [listUrl]);

  const transition = async (rule: PricingRule, action: 'approve' | 'archive') => {
    setBusyId(rule.id);
    try {
      const template = action === 'approve' ? approveUrlTemplate : archiveUrlTemplate;
      const url = template.replace('__RULE_ID__', String(rule.id));
      const response = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || _('Unable to update pricing rule'));
      toast.success(action === 'approve' ? _('Pricing rule approved.') : _('Pricing rule archived.'));
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : _('Unable to update pricing rule'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="p-5">{_('Loading pricing rules…')}</p>;
  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{_('Name')}</TableHead>
            <TableHead>{_('Priority')}</TableHead>
            <TableHead>{_('Action')}</TableHead>
            <TableHead>{_('Status')}</TableHead>
            <TableHead>{_('Actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.length === 0 && <TableRow><TableCell colSpan={5} className="text-center">{_('No pricing rules yet.')}</TableCell></TableRow>}
          {rules.map((rule) => (
            <TableRow key={rule.id}>
              <TableCell>
                {rule.status === 'pending' ? (
                  <a className="text-primary underline" href={editUrlTemplate.replace('__RULE_ID__', String(rule.id))}>{rule.name}</a>
                ) : rule.name}
                {rule.description && <div className="text-sm text-muted-foreground">{rule.description}</div>}
              </TableCell>
              <TableCell>{rule.priority}</TableCell>
              <TableCell>
                {rule.action_json.discount_type === 'none'
                  ? _('Free shipping')
                  : `${rule.action_json.amount}${rule.action_json.discount_type === 'percentage' ? '%' : ''} ${rule.action_json.discount_type}`}
                {rule.action_json.free_shipping && <div className="text-sm">{_('Also free shipping')}</div>}
              </TableCell>
              <TableCell><span className="capitalize">{rule.status}</span></TableCell>
              <TableCell className="flex gap-2">
                {rule.status === 'pending' && <Button size="sm" disabled={busyId === rule.id} onClick={() => void transition(rule, 'approve')}>{_('Approve')}</Button>}
                {rule.status !== 'archived' && <Button size="sm" variant="outline" disabled={busyId === rule.id} onClick={() => void transition(rule, 'archive')}>{_('Archive')}</Button>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export const layout = { areaId: 'content', sortOrder: 20 };
export const query = `
  query Query {
    listUrl: url(routeId: "getPricingRules")
    editUrlTemplate: url(routeId: "pricingRuleEdit", params: [{ key: "id", value: "__RULE_ID__" }])
    approveUrlTemplate: url(routeId: "approvePricingRule", params: [{ key: "id", value: "__RULE_ID__" }])
    archiveUrlTemplate: url(routeId: "archivePricingRule", params: [{ key: "id", value: "__RULE_ID__" }])
  }
`;
