import { setPageMetaInfo } from '../../../../cms/services/pageMetaInfo.js';

export default (request) => {
  setPageMetaInfo(request, {
    title: 'Create a new inventory threshold',
    description: 'Create a new inventory threshold'
  });
};