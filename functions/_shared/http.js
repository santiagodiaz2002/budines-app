import { MAX_JSON_BODY_BYTES } from './constants.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function assertSameOrigin(request) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return;
  }

  const origin = request.headers.get('Origin');
  if (!origin) {
    throw new ApiError(403, 'invalid_origin', 'Origen no permitido.');
  }

  let requestOrigin;
  let headerOrigin;
  try {
    requestOrigin = new URL(request.url).origin;
    headerOrigin = new URL(origin).origin;
  } catch {
    throw new ApiError(403, 'invalid_origin', 'Origen no permitido.');
  }

  if (requestOrigin !== headerOrigin) {
    throw new ApiError(403, 'invalid_origin', 'Origen no permitido.');
  }
}

export function jsonResponse(data, { status = 200, headers = {} } = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');

  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders
  });
}

export function methodNotAllowed(allowedMethods) {
  return jsonResponse(
    {
      ok: false,
      error: {
        code: 'method_not_allowed',
        message: 'Método no permitido.'
      }
    },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(', ')
      }
    }
  );
}

export async function readJsonBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'La petición debe usar JSON.');
  }

  const text = await request.text();
  const byteLength = new TextEncoder().encode(text).length;

  if (byteLength > maxBytes) {
    throw new ApiError(413, 'body_too_large', 'La petición es demasiado grande.');
  }

  if (text.length === 0) {
    throw new ApiError(400, 'invalid_json', 'El cuerpo JSON es obligatorio.');
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new ApiError(400, 'invalid_json', 'El cuerpo JSON debe ser un objeto.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(400, 'invalid_json', 'El cuerpo JSON no es válido.');
  }
}

export async function withApiErrorHandling(handler) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message
          }
        },
        { status: error.status }
      );
    }

    console.error('Unhandled API error', {
      name: error?.name || 'Error',
      message: String(error?.message || 'Unknown error').slice(0, 240)
    });

    return jsonResponse(
      {
        ok: false,
        error: {
          code: 'internal_error',
          message: 'No se pudo completar la operación.'
        }
      },
      { status: 500 }
    );
  }
}

export function assertDb(env) {
  if (!env?.DB) {
    throw new ApiError(503, 'database_unavailable', 'La base de datos no está disponible.');
  }
  return env.DB;
}
