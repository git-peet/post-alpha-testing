import { INTERNAL_SERVER_ERROR, NOT_FOUND, OK } from '../../../../lib/util/httpStatus.js';
import { getPricingRule } from '../../services/pricingRules/pricingRuleService.js';

export default async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return response.status(NOT_FOUND).json({ error: { status: NOT_FOUND, message: 'Pricing rule not found' } });
  }
  try {
    const rule = await getPricingRule(id);
    if (!rule) {
      return response.status(NOT_FOUND).json({ error: { status: NOT_FOUND, message: 'Pricing rule not found' } });
    }
    response.status(OK);
    response.$body = { data: rule };
    next();
  } catch {
    response.status(INTERNAL_SERVER_ERROR).json({ error: { status: INTERNAL_SERVER_ERROR, message: 'Unable to load pricing rule' } });
  }
};
