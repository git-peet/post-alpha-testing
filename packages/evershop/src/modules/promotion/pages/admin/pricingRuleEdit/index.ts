import { select } from '@evershop/postgres-query-builder';
import { pool } from '../../../../../lib/postgres/connection.js';
import { buildUrl } from '../../../../../lib/router/buildUrl.js';
import { setPageMetaInfo } from '../../../../cms/services/pageMetaInfo.js';
import { setContextValue } from '../../../../graphql/services/contextHelper.js';

export default async (request, response, next) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    response.redirect(302, buildUrl('pricingRuleGrid'));
    return;
  }
  try {
    const rule = await select().from('pricing_rules').where('id', '=', id).load(pool);
    if (!rule) {
      response.redirect(302, buildUrl('pricingRuleGrid'));
      return;
    }
    setContextValue(request, 'pricingRuleId', String(id));
    setPageMetaInfo(request, { title: rule.name, description: 'Edit pricing rule' });
    next();
  } catch (error) {
    next(error);
  }
};
