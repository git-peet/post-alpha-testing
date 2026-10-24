import { translate } from '../../../../lib/locale/translate/translate.js';
import { error } from '../../../../lib/log/logger.js';
import { pool } from '../../../../lib/postgres/connection.js';
import {
  INTERNAL_SERVER_ERROR,
  INVALID_PAYLOAD,
  OK,
  UNAUTHORIZED
} from '../../../../lib/util/httpStatus.js';
import type { EvershopRequest } from '../../../../types/request.js';
import type { EvershopResponse } from '../../../../types/response.js';
import { addWishlistItem } from '../../services/wishlist.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
          message: translate('You must be logged in to manage your wishlist')
        }
      });
    }

    const productUuid = request.body?.product_uuid;
    if (typeof productUuid !== 'string' || !UUID_PATTERN.test(productUuid)) {
      response.status(INVALID_PAYLOAD);
      return response.json({
        error: {
          status: INVALID_PAYLOAD,
          message: translate('A valid product is required')
        }
      });
    }

    const added = await addWishlistItem(
      customer.customer_id,
      productUuid,
      pool
    );
    if (!added) {
      response.status(INVALID_PAYLOAD);
      return response.json({
        error: {
          status: INVALID_PAYLOAD,
          message: translate('This product is no longer available')
        }
      });
    }

    response.status(OK);
    response.$body = { data: { product_uuid: productUuid } };
    return next();
  } catch (e) {
    error(e);
    response.status(INTERNAL_SERVER_ERROR);
    return response.json({
      error: {
        status: INTERNAL_SERVER_ERROR,
        message: translate('Unable to save this product')
      }
    });
  }
};
