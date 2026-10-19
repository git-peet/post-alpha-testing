import { FormButtons } from '@components/admin/FormButtons.js';
import { Form, useFormContext } from '@components/common/form/Form.js';
import { CheckboxField } from '@components/common/form/CheckboxField.js';
import { InputField } from '@components/common/form/InputField.js';
import { NumberField } from '@components/common/form/NumberField.js';
import { RadioGroupField } from '@components/common/form/RadioGroupField.js';
import { TextareaField } from '@components/common/form/TextareaField.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@components/common/ui/Card.js';
import { toast } from '@components/common/ui/Sonner.js';
import { _ } from '@evershop/evershop/lib/locale/translate/_';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

interface PricingRuleFormValues {
  name: string;
  description: string;
  priority: number | null;
  minimum_cart_amount: number | null;
  customer_group_ids: string;
  category_ids: string;
  starts_at: string;
  ends_at: string;
  discount_type: 'fixed' | 'percentage' | 'none';
  amount: number | null;
  free_shipping: boolean;
}

interface Props {
  action: string;
  ruleUrl?: string;
  gridUrl: string;
  editUrlTemplate: string;
  ruleId?: string;
}

function csvIds(value: string): number[] {
  if (!value.trim()) return [];
  return value.split(',').map((part) => Number(part.trim())).filter((id) => Number.isSafeInteger(id) && id > 0);
}

function dateInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 16);
}

function RuleFields({ status }: { status?: string }) {
  const { watch } = useFormContext<PricingRuleFormValues>();
  const discountType = watch('discount_type');
  const readOnly = Boolean(status && status !== 'pending');
  return (
    <fieldset disabled={readOnly} className="space-y-5">
      <Card>
        <CardHeader><CardTitle>{_('General')}</CardTitle><CardDescription>{_('Define the rule and its evaluation priority.')}</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          <InputField name="name" label={_('Name')} required maxLength={255} />
          <TextareaField name="description" label={_('Description')} />
          <NumberField name="priority" label={_('Priority')} defaultValue={100} min={0} allowDecimals={false} helperText={_('Lower values are evaluated first.')} />
          {status && <p className="text-sm text-muted-foreground">{_('Status')}: {status}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{_('Conditions')}</CardTitle><CardDescription>{_('All supplied conditions must match the cart.')}</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <NumberField name="minimum_cart_amount" label={_('Minimum cart amount')} min={0} />
          <InputField name="customer_group_ids" label={_('Customer group IDs')} placeholder={_('For example: 1, 2')} helperText={_('Leave empty to match every customer group.')} />
          <InputField name="category_ids" label={_('Product category IDs')} placeholder={_('For example: 3, 7')} helperText={_('Leave empty to match all product categories.')} />
          <InputField name="starts_at" type="datetime-local" label={_('Starts at (UTC)')} />
          <InputField name="ends_at" type="datetime-local" label={_('Ends at (UTC)')} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{_('Action')}</CardTitle><CardDescription>{_('Discounts apply to eligible cart lines; free shipping can be combined with a discount.')}</CardDescription></CardHeader>
        <CardContent className="grid gap-4">
          <RadioGroupField
            name="discount_type"
            label={_('Discount type')}
            required
            options={[
              { value: 'fixed', label: _('Fixed amount') },
              { value: 'percentage', label: _('Percentage') },
              { value: 'none', label: _('Free shipping only') }
            ]}
            defaultValue="fixed"
          />
          {discountType !== 'none' && (
            <NumberField
              name="amount"
              label={discountType === 'percentage' ? _('Percentage amount') : _('Fixed amount')}
              required
              min={0.01}
              max={discountType === 'percentage' ? 100 : undefined}
              helperText={discountType === 'fixed' ? _('Fixed discount is distributed across eligible cart lines.') : undefined}
            />
          )}
          <CheckboxField name="free_shipping" label={_('Also provide free shipping')} defaultValue={false} />
        </CardContent>
      </Card>
    </fieldset>
  );
}

export default function PricingRuleForm({ action, ruleUrl, gridUrl, editUrlTemplate, ruleId }: Props) {
  const form = useForm<PricingRuleFormValues>({
    defaultValues: {
      name: '', description: '', priority: 100, minimum_cart_amount: null,
      customer_group_ids: '', category_ids: '', starts_at: '', ends_at: '',
      discount_type: 'fixed', amount: null, free_shipping: false
    }
  });
  const [status, setStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ruleId || !ruleUrl) return;
    let cancelled = false;
    setLoading(true);
    fetch(ruleUrl, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error?.message || _('Unable to load rule'));
        return result.data;
      })
      .then((rule) => {
        if (cancelled) return;
        const condition = rule.condition_json || {};
        const actionData = rule.action_json || {};
        setStatus(rule.status);
        form.reset({
          name: rule.name || '',
          description: rule.description || '',
          priority: Number(rule.priority ?? 100),
          minimum_cart_amount: condition.minimum_cart_amount ?? null,
          customer_group_ids: (condition.customer_group_ids || []).join(', '),
          category_ids: (condition.category_ids || []).join(', '),
          starts_at: dateInput(condition.starts_at),
          ends_at: dateInput(condition.ends_at),
          discount_type: actionData.discount_type || 'none',
          amount: actionData.amount ?? null,
          free_shipping: actionData.free_shipping === true
        });
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : _('Unable to load rule')))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [form, ruleId, ruleUrl]);

  const submit = async (values: PricingRuleFormValues) => {
    const condition_json: Record<string, unknown> = {};
    if (values.minimum_cart_amount !== null && values.minimum_cart_amount !== undefined) {
      condition_json.minimum_cart_amount = Number(values.minimum_cart_amount);
    }
    const groups = csvIds(values.customer_group_ids || '');
    const categories = csvIds(values.category_ids || '');
    if (groups.length) condition_json.customer_group_ids = groups;
    if (categories.length) condition_json.category_ids = categories;
    if (values.starts_at) condition_json.starts_at = new Date(values.starts_at).toISOString();
    if (values.ends_at) condition_json.ends_at = new Date(values.ends_at).toISOString();
    const action_json: Record<string, unknown> = {
      discount_type: values.discount_type,
      free_shipping: Boolean(values.free_shipping)
    };
    if (values.discount_type !== 'none') action_json.amount = Number(values.amount);

    try {
      const response = await fetch(action, {
        method: ruleId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: values.name,
          description: values.description,
          priority: Number(values.priority ?? 100),
          condition_json,
          action_json
        })
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error?.message || _('Unable to save pricing rule'));
      toast.success(_('Pricing rule saved as pending review.'));
      if (!ruleId && result.data?.id) {
        window.location.href = editUrlTemplate.replace('__RULE_ID__', String(result.data.id));
      } else {
        window.location.href = gridUrl;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : _('Unable to save pricing rule'));
    }
  };

  return (
    <Form form={form} action={action} method={ruleId ? 'PATCH' : 'POST'} onSubmit={submit} submitBtn={false} id="pricingRuleForm" loading={loading}>
      <RuleFields status={status} />
      {(!status || status === 'pending') && <FormButtons formId="pricingRuleForm" cancelUrl={gridUrl} />}
    </Form>
  );
}
