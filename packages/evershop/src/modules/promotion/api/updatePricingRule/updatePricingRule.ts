import { BAD_REQUEST, INTERNAL_SERVER_ERROR, NOT_FOUND, OK, UNPROCESSABLE_ENTITY } from '../../../../lib/util/httpStatus.js';
import { PricingRuleConflictError, updatePendingPricingRule } from '../../services/pricingRules/pricingRuleService.js';

export default async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return response.status(BAD_REQUEST).json({ error: { status: BAD_REQUEST, message: 'Invalid pricing rule id' } });
  }
  try {
    const rule = await updatePendingPricingRule(id, request.body);
    response.status(OK);
    response.$body = { data: rule };
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update pricing rule';
    if (message === 'Pricing rule not found') {
      return response.status(NOT_FOUND).json({ error: { status: NOT_FOUND, message } });
    }
    if (error instanceof PricingRuleConflictError) {
      return response.status(409).json({ error: { status: 409, message } });
    }
    const status = /required|must be|unsupported|valid JSON|cannot exceed|choose/i.test(message)
      ? UNPROCESSABLE_ENTITY
      : INTERNAL_SERVER_ERROR;
    return response.status(status).json({ error: { status, message } });
  }
};
