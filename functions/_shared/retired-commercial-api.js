import { jsonResponse } from './http.js';

export function retiredCommercialResponse() {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: 'section_removed',
        message: 'Esta sección fue eliminada.'
      }
    },
    { status: 410 }
  );
}
