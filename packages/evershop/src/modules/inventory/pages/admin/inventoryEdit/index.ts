import { buildUrl } from '../../../../../lib/router/buildUrl.js';
import { setPageMetaInfo } from '../../../../cms/services/pageMetaInfo.js';
import { setContextValue } from '../../../../graphql/services/contextHelper.js';

export default (request, response) => {
  const productId = Number(request.params.id);
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    response.redirect(302, buildUrl('inventoryGrid'));
    return;
  }
  setContextValue(request, 'inventoryProductId', String(productId));
  setPageMetaInfo(request, { title: `Inventory for product ${productId}`, description: 'Manage per-warehouse stock thresholds' });
};