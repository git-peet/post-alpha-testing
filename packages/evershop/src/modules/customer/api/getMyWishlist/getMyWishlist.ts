import { translate } from '../../../../lib/locale/translate/translate.js';
import { buildUrl } from '../../../../lib/router/buildUrl.js';
import { error } from '../../../../lib/log/logger.js';
import { pool } from '../../../../lib/postgres/connection.js';
import {
  INTERNAL_SERVER_ERROR,
  UNAUTHORIZED
} from '../../../../lib/util/httpStatus.js';
import type { EvershopRequest } from '../../../../types/request.js';
import type { EvershopResponse } from '../../../../types/response.js';
import { getWishlistItems } from '../../services/wishlist.js';

export default async (
  request: EvershopRequest,
  response: EvershopResponse,
  next: () => void
) => {
  try {
    const customer = request.getCurrentCustomer();
    if (!customer) {
      response.status(UNAUTHORIZED);
      return response.json({
        error: {
          status: UNAUTHORIZED,
          message: translate('You must be logged in to view your wishlist')
        }
      });
    }

    const items = await getWishlistItems(customer.customer_id, pool);
    response.$body = {
      data: items.map((item) => ({
        ...item,
        // Build route-based URLs on the server. The client route registry may not
        // include productView on the account-page bundle.
        productUrl: item.unavailable
          ? null
          : buildUrl('productView', { uuid: item.productUuid })
      }))
    };
    return next();
  } catch (e) {
    error(e);
    response.status(INTERNAL_SERVER_ERROR);
    return response.json({
      error: {
        status: INTERNAL_SERVER_ERROR,
        message: translate('Unable to load your wishlist')
      }
    });
  }
};
