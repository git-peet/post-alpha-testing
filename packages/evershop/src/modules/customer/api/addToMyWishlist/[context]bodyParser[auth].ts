import bodyParser from 'body-parser';
import type { EvershopRequest } from '../../../../types/request.js';
import type { EvershopResponse } from '../../../../types/response.js';

export default (
  request: EvershopRequest,
  response: EvershopResponse,
  next: () => void
) => {
  bodyParser.json({ inflate: false })(request, response, next);
};
