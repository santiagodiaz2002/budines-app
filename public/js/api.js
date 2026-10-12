class ApiClientError extends Error {
  constructor(message, { status = 0, code = 'network_error', payload = null } = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export async function getSession() {
  return apiRequest('/api/session');
}

export function listChatMessages(after = 0) {
  return apiRequest(`/api/chat?after=${encodeURIComponent(after)}`);
}

export function sendChatMessage(message) {
  return apiRequest('/api/chat', { method: 'POST', body: message });
}

export async function login({ username, password }) {
  return apiRequest('/api/login', {
    method: 'POST',
    body: {
      username,
      password
    }
  });
}

export async function registerAccount({ username, password }) {
  return apiRequest('/api/register', {
    method: 'POST',
    body: {
      username,
      password
    }
  });
}

export async function logout() {
  return apiRequest('/api/logout', {
    method: 'POST'
  });
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json'
    }
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  const controller = new AbortController();
  options.signal = controller.signal;
  options.cache = 'no-store';
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    response = await fetch(path, options);
  } catch {
    clearTimeout(timeout);
    throw new ApiClientError('No hay conexión o el servidor no respondió.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError('La respuesta del servidor no fue válida.', {
      status: response.status,
      code: 'invalid_response'
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok || payload?.ok === false) {
    throw new ApiClientError(payload?.error?.message || 'No se pudo completar la operación.', {
      status: response.status,
      code: payload?.error?.code || 'api_error',
      payload
    });
  }

  return payload;
}
