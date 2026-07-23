import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync('public/index.html', 'utf8');

let windowRef;
let fetchCalls;
let sessionUser;
let loginUser;
let registerUser;

beforeEach(() => {
  fetchCalls = [];
  sessionUser = null;
  loginUser = null;
  registerUser = null;
  setupWindow();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  windowRef?.close();
});

describe('pantalla de acceso y permisos de UI', () => {
  it('sin sesión muestra solo login/registro con usuario y contraseña', async () => {
    await importApp();
    await waitFor(() => !document.querySelector('#auth-view').hidden);

    const inputs = [...document.querySelectorAll('#auth-form input')].map((input) => input.name);

    expect(document.body.dataset.authState).toBe('auth');
    expect(document.querySelector('#bottom-tabs').hidden).toBe(true);
    expect(inputs).toEqual(['username', 'password']);
    expect(document.querySelector('#auth-username').autocomplete).toBe('username');
    expect(document.querySelector('#auth-password').autocomplete).toBe('current-password');

    document.querySelector('#auth-password-toggle').click();
    expect(document.querySelector('#auth-password').type).toBe('text');
    expect(document.querySelector('#auth-password-toggle').textContent).toBe('Ocultar');

    document.querySelector('#auth-mode-register').click();
    expect(document.querySelector('#auth-submit').textContent).toBe('Crear cuenta');
    expect(document.querySelector('#auth-password').autocomplete).toBe('new-password');
  });

  it('registro común inicia sesión, remueve Budines y no precarga datos comerciales', async () => {
    registerUser = {
      id: 'user-common-1',
      displayName: 'Comun',
      capabilities: {
        canAccessBudines: false
      }
    };

    await importApp();
    await waitFor(() => !document.querySelector('#auth-view').hidden);
    document.querySelector('#auth-mode-register').click();
    document.querySelector('#auth-username').value = 'Comun';
    document.querySelector('#auth-password').value = 'common-password';
    document.querySelector('#auth-form').dispatchEvent(new windowRef.Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => document.body.dataset.authState === 'app');

    expect(document.querySelector('#tab-budines')).toBeNull();
    expect(document.querySelector('#budines-tool')).toBeNull();
    expect([...document.querySelectorAll('[data-tool-tab]')].map((tab) => tab.dataset.toolTab)).toEqual([
      'truco',
      'metronome',
      'tuner'
    ]);
    expect(document.querySelector('#truco-tool').hidden).toBe(false);
    expect(fetchCalls.some((call) => call.path === '/api/summary')).toBe(false);
    expect(fetchCalls.some((call) => call.path === '/api/records')).toBe(false);
    expect(document.querySelector('#session-badge').textContent).toBe('Comun');
    expect(document.querySelector('#user-session').textContent).not.toContain('common');
  });

  it('owner ve cuatro pestañas y carga Budines después del login', async () => {
    loginUser = {
      id: 'santi',
      displayName: 'Santi',
      capabilities: {
        canAccessBudines: true
      }
    };

    await importApp();
    await waitFor(() => !document.querySelector('#auth-view').hidden);
    document.querySelector('#auth-username').value = 'santi';
    document.querySelector('#auth-password').value = 'owner-password';
    document.querySelector('#auth-form').dispatchEvent(new windowRef.Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => document.querySelector('#budines-tool') && !document.querySelector('#budines-tool').hidden);

    expect([...document.querySelectorAll('[data-tool-tab]')].map((tab) => tab.dataset.toolTab)).toEqual([
      'budines',
      'truco',
      'metronome',
      'tuner'
    ]);
    expect(fetchCalls.some((call) => call.path === '/api/summary')).toBe(true);
    expect(fetchCalls.some((call) => call.path === '/api/records')).toBe(true);
    expect(document.querySelector('#summary-total').textContent).toContain('3.000');
  });

  it('logout llama backend, cancela voz y vuelve al acceso', async () => {
    sessionUser = {
      id: 'santi',
      displayName: 'Santi',
      capabilities: {
        canAccessBudines: true
      }
    };
    windowRef.location.reload = vi.fn();

    await importApp();
    await waitFor(() => document.body.dataset.authState === 'app');
    document.querySelector('#logout-button').click();
    await waitFor(() => document.body.dataset.authState === 'auth');

    expect(fetchCalls.some((call) => call.path === '/api/logout')).toBe(true);
    expect(windowRef.speechSynthesis.cancel).toHaveBeenCalled();
  });
});

async function importApp() {
  vi.resetModules();
  await import('../public/js/app.js');
}

function setupWindow() {
  windowRef?.close();
  windowRef = new Window({ url: 'https://budines.test/' });
  windowRef.document.write(html);
  windowRef.document.close();

  class FakeUtterance {
    constructor(text) {
      this.text = text;
    }
  }

  vi.stubGlobal('window', windowRef);
  vi.stubGlobal('document', windowRef.document);
  vi.stubGlobal('navigator', {
    serviceWorker: {
      register: vi.fn().mockResolvedValue({})
    }
  });
  vi.stubGlobal('HTMLElement', windowRef.HTMLElement);
  vi.stubGlobal('Event', windowRef.Event);
  vi.stubGlobal('KeyboardEvent', windowRef.KeyboardEvent);
  vi.stubGlobal('MouseEvent', windowRef.MouseEvent);
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => 'ui-uuid')
  });
  vi.stubGlobal('fetch', vi.fn(handleFetch));
  windowRef.SpeechSynthesisUtterance = FakeUtterance;
  windowRef.speechSynthesis = {
    getVoices: vi.fn(() => []),
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener: vi.fn()
  };
}

async function handleFetch(input, options = {}) {
  const url = new URL(String(input), 'https://budines.test');
  const method = options.method || 'GET';
  fetchCalls.push({ path: url.pathname, method });

  if (url.pathname === '/api/session') {
    return json({
      ok: true,
      authenticated: Boolean(sessionUser),
      user: sessionUser
    });
  }

  if (url.pathname === '/api/register' && method === 'POST') {
    sessionUser = registerUser;
    return json(
      {
        ok: true,
        user: registerUser
      },
      201,
      {
        'Set-Cookie': 'budines_session=registered; Path=/; HttpOnly; Secure; SameSite=Lax'
      }
    );
  }

  if (url.pathname === '/api/login' && method === 'POST') {
    sessionUser = loginUser;
    return json(
      {
        ok: true,
        user: loginUser
      },
      200,
      {
        'Set-Cookie': 'budines_session=logged; Path=/; HttpOnly; Secure; SameSite=Lax'
      }
    );
  }

  if (url.pathname === '/api/logout' && method === 'POST') {
    sessionUser = null;
    return json({ ok: true }, 200, {
      'Set-Cookie': 'budines_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    });
  }

  if (url.pathname === '/api/summary') {
    return json({
      ok: true,
      summary: {
        totalArs: 3000,
        investmentArs: 120000,
        investmentRecovered: false,
        missingArs: 117000,
        profitArs: 0
      }
    });
  }

  if (url.pathname === '/api/records') {
    return json({
      ok: true,
      records: [],
      pagination: {
        limit: 30,
        offset: 0,
        hasMore: false,
        nextOffset: null
      }
    });
  }

  return json(
    {
      ok: false,
      error: {
        code: 'not_found',
        message: 'No encontrado.'
      }
    },
    404
  );
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timeout');
}
