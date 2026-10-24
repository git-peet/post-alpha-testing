import { Button } from '@components/common/ui/Button.js';
import { useCustomer } from '@components/frontStore/customer/CustomerContext.js';
import { useProduct } from '@components/frontStore/catalog/ProductContext.js';
import { _ } from '@evershop/evershop/lib/locale/translate/_';
import { buildUrl } from '@evershop/evershop/lib/router/buildUrl';
import React, { useEffect, useState } from 'react';

const WISHLIST_API = '/api/customers/me/wishlist';

type SaveState = 'loading' | 'ready' | 'error';

export function SaveToWishlist() {
  const { customer } = useCustomer();
  const { uuid } = useProduct();
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState<SaveState>('loading');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!customer) {
      setState('ready');
      setSaved(false);
      return;
    }

    const controller = new AbortController();
    setState('loading');
    fetch(WISHLIST_API, {
      credentials: 'same-origin',
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Wishlist request failed');
        }
        return response.json();
      })
      .then((result) => {
        if (!Array.isArray(result.data)) {
          throw new Error('Wishlist response was invalid');
        }
        setSaved(
          result.data.some((item: { productUuid: string }) => item.productUuid === uuid)
        );
        setState('ready');
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setState('error');
      });

    return () => controller.abort();
  }, [customer, uuid]);

  const toggleSaved = async () => {
    if (!customer || saving) {
      return;
    }
    setSaving(true);
    setState('ready');
    try {
      const response = saved
        ? await fetch(`${WISHLIST_API}/${encodeURIComponent(uuid)}`,
            { method: 'DELETE', credentials: 'same-origin' }
          )
        : await fetch(WISHLIST_API, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_uuid: uuid })
          });
      if (!response.ok) {
        throw new Error('Wishlist update failed');
      }
      setSaved(!saved);
    } catch {
      setState('error');
    } finally {
      setSaving(false);
    }
  };

  if (!customer) {
    return (
      <p className="mt-3 text-sm">
        <a className="underline" href={buildUrl('login')}>
          {_('Sign in to save this product')}
        </a>
      </p>
    );
  }

  if (state === 'error') {
    return (
      <p role="alert" className="mt-3 text-sm text-destructive">
        {_('Wishlist is temporarily unavailable. Please try again.')}
      </p>
    );
  }

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="outline"
        disabled={saving || state === 'loading'}
        isLoading={saving || state === 'loading'}
        onClick={() => void toggleSaved()}
      >
        {saved ? _('Remove from wishlist') : _('Save to wishlist')}
      </Button>
    </div>
  );
}
