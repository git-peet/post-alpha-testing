import { setPageMetaInfo } from '../../../../cms/services/pageMetaInfo.js';

export default (request) => {
  setPageMetaInfo(request, {
    title: 'Pricing Rules',
    description: 'Review and manage pricing rules'
  });
};
