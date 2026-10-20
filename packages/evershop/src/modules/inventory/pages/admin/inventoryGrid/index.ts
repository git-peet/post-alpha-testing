import { setPageMetaInfo } from '../../../../cms/services/pageMetaInfo.js';

export default (request) => {
  setPageMetaInfo(request, {
    title: 'Inventory Grid',
    description: 'Multi-Warehouse Inventory'
  });
};