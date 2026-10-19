import { setPageMetaInfo } from '../../../../cms/services/pageMetaInfo.js';

export default (request) => {
  setPageMetaInfo(request, {
    title: 'Create pricing rule',
    description: 'Create a pricing rule for admin review'
  });
};
