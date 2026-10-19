import { BAD_REQUEST, INTERNAL_SERVER_ERROR, OK } from '../../../../lib/util/httpStatus.js';
import { listPricingRules } from '../../services/pricingRules/pricingRuleService.js';

export default async (request, response, next) => {
  try {
    const requested = request.query.status;
    const status = typeof requested === 'string' ? requested : 'active';
    if (!['active', 'pending', 'archived', 'all'].includes(status)) {
      return response.status(BAD_REQUEST).json({
        error: { status: BAD_REQUEST, message: 'Invalid pricing rule status' }
      });
    }
    const rules = await listPricingRules(status as 'active' | 'pending' | 'archived' | 'all');
    response.status(OK);
    response.$body = { data: rules };
    next();
  } catch (error) {
    response.status(INTERNAL_SERVER_ERROR).json({
      error: { status: INTERNAL_SERVER_ERROR, message: 'Unable to load pricing rules' }
    });
  }
};
