import { CREATED, INTERNAL_SERVER_ERROR, UNPROCESSABLE_ENTITY } from '../../../../lib/util/httpStatus.js';
import { createPricingRule } from '../../services/pricingRules/pricingRuleService.js';

export default async (request, response, next) => {
  try {
    const rule = await createPricingRule(request.body);
    response.status(CREATED);
    response.$body = { data: rule };
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create pricing rule';
    const status = error instanceof Error && /required|must be|unsupported|valid JSON|cannot exceed|choose/i.test(message)
      ? UNPROCESSABLE_ENTITY
      : INTERNAL_SERVER_ERROR;
    response.status(status).json({ error: { status, message } });
  }
};
