import { BAD_REQUEST, CONFLICT, INTERNAL_SERVER_ERROR, NOT_FOUND, OK } from '../../../../lib/util/httpStatus.js';
import {
  archivePricingRule,
  PricingRuleConflictError
} from '../../services/pricingRules/pricingRuleService.js';

export default async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return response.status(BAD_REQUEST).json({ error: { status: BAD_REQUEST, message: 'Invalid pricing rule id' } });
  }
  try {
    const rule = await archivePricingRule(id);
    response.status(OK);
    response.$body = { data: rule };
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to archive pricing rule';
    if (message === 'Pricing rule not found') {
      return response.status(NOT_FOUND).json({ error: { status: NOT_FOUND, message } });
    }
    if (error instanceof PricingRuleConflictError) {
      return response.status(CONFLICT).json({ error: { status: CONFLICT, message } });
    }
    return response.status(INTERNAL_SERVER_ERROR).json({ error: { status: INTERNAL_SERVER_ERROR, message: 'Unable to archive pricing rule' } });
  }
};
