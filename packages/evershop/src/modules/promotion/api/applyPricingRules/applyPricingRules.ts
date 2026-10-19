import { getCartByUUID } from '../../../checkout/services/getCartByUUID.js';
import { saveCart } from '../../../checkout/services/saveCart.js';
import { INTERNAL_SERVER_ERROR, INVALID_PAYLOAD, OK } from '../../../../lib/util/httpStatus.js';

export default async (request, response, next) => {
  try {
    const cartId = request.body?.cart_id;
    if (typeof cartId !== 'string' || !cartId) {
      return response.status(INVALID_PAYLOAD).json({
        error: { status: INVALID_PAYLOAD, message: 'cart_id is required' }
      });
    }
    const cart = await getCartByUUID(cartId);
    if (!cart) {
      return response.status(INVALID_PAYLOAD).json({
        error: { status: INVALID_PAYLOAD, message: 'Invalid cart' }
      });
    }
    if (cart.getItems().length === 0) {
      return response.status(INVALID_PAYLOAD).json({
        error: { status: INVALID_PAYLOAD, message: 'Cart has no items' }
      });
    }
    await cart.build();
    await saveCart(cart);
    const items = cart.getItems().map((item) => ({
      uuid: item.getId(),
      discount_amount: item.getData('discount_amount'),
      line_total_with_discount: item.getData('line_total_with_discount'),
      line_total_with_discount_incl_tax: item.getData('line_total_with_discount_incl_tax')
    }));
    response.status(OK);
    response.$body = {
      data: {
        cart_id: cartId,
        discount_amount: cart.getData('discount_amount'),
        grand_total: cart.getData('grand_total'),
        items
      }
    };
    next();
  } catch (error) {
    response.status(INTERNAL_SERVER_ERROR).json({
      error: { status: INTERNAL_SERVER_ERROR, message: 'Unable to apply pricing rules' }
    });
  }
};
