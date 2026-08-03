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

export async function getSummary() {
  return apiRequest('/api/summary');
}

export async function getOwnerSummary() {
  return apiRequest('/api/owner-summary');
}

export async function listRecords({ limit = 30, offset = 0 } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset)
  });
  return apiRequest(`/api/records?${params}`);
}

export async function createRecord({ grams, quantityUnit, amountArs, idempotencyKey }) {
  return apiRequest('/api/records', {
    method: 'POST',
    body: {
      grams,
      quantityUnit,
      amountArs,
      idempotencyKey
    }
  });
}

export async function deleteRecord({ id, confirmation }) {
  return apiRequest(`/api/records/${encodeURIComponent(id)}/void`, {
    method: 'POST',
    body: {
      confirmation
    }
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
  try {
    response = await fetch(path, options);
  } catch {
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
