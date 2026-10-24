import { AccountHeader } from '@components/frontStore/customer/AccountHeader.js';
import { AccountNav } from '@components/frontStore/customer/AccountNav.js';
import { Button } from '@components/common/ui/Button.js';
import { _ } from '@evershop/evershop/lib/locale/translate/_';
import React, { useCallback, useEffect, useState } from 'react';

type WishlistItem = {
  productUuid: string;
  productUrl: string | null;
  name: string | null;
  unavailable: boolean;
  outOfStock: boolean;
  createdAt: string;
};

type ViewState = 'loading' | 'ready' | 'error';

export default function Wishlist() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [removing, setRemoving] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setViewState('loading');
    setActionError(false);
    try {
      const response = await fetch('/api/customers/me/wishlist', {
        credentials: 'same-origin',
        signal
      });
      if (!response.ok) {
        throw new Error('Wishlist request failed');
      }
      const result = await response.json();
      if (!Array.isArray(result.data)) {
        throw new Error('Wishlist response was invalid');
      }
      setItems(result.data);
      setViewState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      setViewState('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadItems(controller.signal);
    return () => controller.abort();
  }, [loadItems]);

  const removeItem = async (productUuid: string) => {
    setRemoving(productUuid);
    setActionError(false);
    try {
      const response = await fetch(
        `/api/customers/me/wishlist/${encodeURIComponent(productUuid)}`,
        { method: 'DELETE', credentials: 'same-origin' }
      );
      if (!response.ok) {
        throw new Error('Wishlist removal failed');
      }
      setItems((current) =>
        current.filter((item) => item.productUuid !== productUuid)
      );
    } catch {
      setActionError(true);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="account mx-auto max-w-2xl py-10">
      <AccountHeader />
      <AccountNav active="wishlist" />
      <main className="mt-8">
        <h1 className="mb-4 h5">{_('My Wishlist')}</h1>
        {viewState === 'loading' && (
          <p role="status" className="text-muted-foreground">
            {_('Loading your wishlist…')}
          </p>
        )}
        {viewState === 'error' && (
          <div role="alert" className="space-y-3 text-destructive">
            <p>{_('We could not load your wishlist. Please try again.')}</p>
            <Button type="button" variant="outline" onClick={() => void loadItems()}>
              {_('Try again')}
            </Button>
          </div>
        )}
        {viewState === 'ready' && items.length === 0 && (
          <p className="text-muted-foreground">
            {_('Your wishlist is empty.')}
          </p>
        )}
        {viewState === 'ready' && items.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((item) => (
              <li
                key={item.productUuid}
                className="flex items-center justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  {!item.unavailable && item.productUrl ? (
                    <a
                      href={item.productUrl}
                      className="font-medium hover:underline"
                    >
                      {item.name || _('View saved product')}
                    </a>
                  ) : (
                    <span className="font-medium text-muted-foreground">
                      {item.name || _('This product is no longer available')}
                    </span>
                  )}
                  {item.unavailable && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {_('This product is no longer available.')}
                    </p>
                  )}
                  {item.outOfStock && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {_('Currently out of stock')}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  isLoading={removing === item.productUuid}
                  disabled={removing !== null}
                  onClick={() => void removeItem(item.productUuid)}
                >
                  {_('Remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {actionError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {_('We could not remove this item. Please try again.')}
          </p>
        )}
      </main>
    </div>
  );
}

export const layout = {
  areaId: 'content',
  sortOrder: 10
};
