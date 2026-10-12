import { getSession, login, logout, registerAccount } from './api.js?v=tools-only-20261012';
import { createAudioCoordinator } from './audio-coordinator.js';
import { initMetronome } from './metronome-editor.js?v=songbook-20261012';
import { initToolNavigation } from './navigation.js?v=tools-only-20261012';
import { initTruco } from './truco.js?v=joint-access-20260805';
import { initTuner } from './tuner.js?v=redesign13-20260730';
import { clearLocalStorageUser, setLocalStorageUser } from './local-storage.js?v=auth-20260723';
import { rememberLocalProfile, readLocalProfile, forgetLocalProfile } from './local-profile.js?v=offline-chat-20260907';
import { initChat } from './chat.js?v=offline-chat-20260907';

const AUTH_MODES = Object.freeze({
  login: {
    title: 'Ingresá a la app',
    submit: 'Iniciar sesión',
    busy: 'Ingresando...',
    autocomplete: 'current-password'
  },
  register: {
    title: 'Crear cuenta',
    submit: 'Crear cuenta',
    busy: 'Creando...',
    autocomplete: 'new-password'
  }
});

const APP_TABS = ['chat', 'truco', 'metronome', 'tuner'];
let chat = null;
let localMode = false;

const dom = {
  authView: document.querySelector('#auth-view'),
  authForm: document.querySelector('#auth-form'),
  authTitle: document.querySelector('#auth-title'),
  authUsername: document.querySelector('#auth-username'),
  authPassword: document.querySelector('#auth-password'),
  authPasswordToggle: document.querySelector('#auth-password-toggle'),
  authSubmit: document.querySelector('#auth-submit'),
  authMessage: document.querySelector('#auth-message'),
  authModeButtons: [...document.querySelectorAll('[data-auth-mode]')],
  userSession: document.querySelector('#user-session'),
  sessionBadge: document.querySelector('#session-badge'),
  logoutButton: document.querySelector('#logout-button'),
  bottomTabs: document.querySelector('#bottom-tabs'),
  liveRegion: document.querySelector('#live-region')
};

const state = {
  user: null,
  authMode: 'login',
  isAuthBusy: false,
  tools: {
    initialized: false,
    navigation: null,
    truco: null,
    metronome: null,
    tuner: null
  }
};

init();

function init() {
  registerServiceWorker();
  bindEvents();
  setAuthMode('login');
  bootSession();
}

function bindEvents() {
  document.querySelector('#local-tools-button').addEventListener('click', () => showLocalApp());
  document.querySelector('#connection-retry').addEventListener('click', () => window.location.reload());
  window.addEventListener('online', () => { if (localMode) window.location.reload(); });
  dom.authForm.addEventListener('submit', handleAuthSubmit);
  for (const button of dom.authModeButtons) {
    button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
  }
  dom.authPasswordToggle.addEventListener('click', togglePasswordVisibility);
  dom.logoutButton.addEventListener('click', handleLogout);
  document.addEventListener('keydown', handleDocumentKeydown);
}

function handleDocumentKeydown(event) {
  if (event.key !== 'Tab') {
    return;
  }

  const dialog = document.querySelector('.dialog-backdrop:not([hidden])');
  if (!dialog) {
    return;
  }

  const focusable = [...dialog.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter((element) => element.getClientRects().length > 0);

  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable.at(-1);
  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function bootSession() {
  setAuthBusy(true);
  document.body.dataset.authState = 'booting';
  try {
    if (navigator.onLine === false) {
      await showLocalApp();
      return;
    }
    const session = await getSession();
    if (session.authenticated) {
      await showApp(session.user);
    } else {
      forgetLocalProfile();
      showAuth();
    }
  } catch (error) {
    await showLocalApp();
  } finally {
    setAuthBusy(false);
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (state.isAuthBusy) {
    return;
  }

  dom.authMessage.textContent = '';
  setAuthBusy(true);

  try {
    const credentials = {
      username: dom.authUsername.value,
      password: dom.authPassword.value
    };
    const result = state.authMode === 'login' ? await login(credentials) : await registerAccount(credentials);
    dom.authPassword.value = '';
    await showApp(result.user);
    announce(state.authMode === 'login' ? 'Sesión iniciada.' : 'Cuenta creada.');
  } catch (error) {
    dom.authMessage.textContent = error.message;
    announce(error.message);
    dom.authPassword.focus();
  } finally {
    setAuthBusy(false);
  }
}

async function handleLogout() {
  dom.logoutButton.disabled = true;
  stopLocalAudio();
  try {
    if (localMode) {
      forgetLocalProfile();
      window.location.reload();
      return;
    }
    await logout();
  } catch (error) {
    announce(error.message);
    dom.logoutButton.disabled = false;
    return;
  }
  {
    state.user = null;
    state.tools.metronome?.setSession?.({ authenticated: false });
    chat?.destroy();
    forgetLocalProfile();
    clearLocalStorageUser();
    showAuth();
    announce('Sesión cerrada.');
    dom.logoutButton.disabled = false;
    reloadAfterLogout();
  }
}

function showAuth(message = '') {
  chat?.destroy();
  document.body.dataset.authState = 'auth';
  dom.authView.hidden = false;
  hideToolPanels();
  dom.bottomTabs.hidden = true;
  dom.userSession.hidden = true;
  dom.sessionBadge.textContent = '';
  dom.authMessage.textContent = message;
  dom.authPassword.value = '';
  dom.authUsername.focus();
}

async function showLocalApp() {
  localMode = true;
  await showApp(readLocalProfile(), { offline: true });
  document.querySelector('#connection-notice').hidden = false;
}

async function showApp(user, { offline = false } = {}) {
  localMode = offline;
  if (!offline) rememberLocalProfile(user);
  document.querySelector('#connection-notice').hidden = !offline;
  state.user = user;
  setLocalStorageUser(user);
  initLocalTools(user);
  chat?.destroy();
  chat = initChat(document.querySelector('#chat-tool'), user, { offline });
  initNavigationForUser();

  document.body.dataset.authState = 'app';
  dom.authView.hidden = true;
  dom.bottomTabs.hidden = false;
  dom.userSession.hidden = false;
  dom.sessionBadge.textContent = user.displayName;
  state.tools.navigation?.selectTab(offline ? 'truco' : 'chat');
  chat.refresh();
}

function initLocalTools(user) {
  if (state.tools.initialized) {
    state.tools.truco?.setAuthenticatedUser?.(user);
    state.tools.metronome?.setSession?.({ authenticated: !localMode });
    return;
  }

  const audioCoordinator = createAudioCoordinator();
  state.tools.truco = initToolSafely('truco', () => initTruco(document.querySelector('#truco-tool'), user));
  state.tools.metronome = initToolSafely('metrónomo', () =>
    initMetronome(document.querySelector('#metronome-tool'), audioCoordinator, { authenticated: !localMode })
  );
  state.tools.tuner = initToolSafely('afinador', () => initTuner(document.querySelector('#tuner-tool'), audioCoordinator));
  state.tools.initialized = true;
}

function initToolSafely(name, initializer) {
  try {
    return initializer();
  } catch (error) {
    console.error(`No se pudo iniciar ${name}.`, error);
    return null;
  }
}

function initNavigationForUser() {
  if (state.tools.navigation) {
    return;
  }

  state.tools.navigation = initToolNavigation({
    allowedTabs: APP_TABS,
    initialTab: 'chat',
    onChange: () => chat?.refresh()
  });
}

function hideToolPanels() {
  for (const panel of document.querySelectorAll('[data-tool-panel]')) {
    panel.hidden = true;
  }
}

function setAuthMode(mode) {
  if (!Object.hasOwn(AUTH_MODES, mode)) {
    return;
  }

  state.authMode = mode;
  const config = AUTH_MODES[mode];
  dom.authTitle.textContent = config.title;
  dom.authSubmit.textContent = config.submit;
  dom.authPassword.autocomplete = config.autocomplete;
  dom.authMessage.textContent = '';

  for (const button of dom.authModeButtons) {
    const active = button.dataset.authMode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function setAuthBusy(isBusy) {
  state.isAuthBusy = isBusy;
  const config = AUTH_MODES[state.authMode];
  dom.authSubmit.disabled = isBusy;
  dom.authUsername.disabled = isBusy;
  dom.authPassword.disabled = isBusy;
  dom.authPasswordToggle.disabled = isBusy;
  for (const button of dom.authModeButtons) {
    button.disabled = isBusy;
  }
  dom.authSubmit.textContent = isBusy ? config.busy : config.submit;
}

function togglePasswordVisibility() {
  const visible = dom.authPassword.type === 'text';
  dom.authPassword.type = visible ? 'password' : 'text';
  dom.authPasswordToggle.textContent = visible ? 'Mostrar' : 'Ocultar';
  dom.authPasswordToggle.setAttribute('aria-pressed', visible ? 'false' : 'true');
  dom.authPassword.focus();
}

function stopLocalAudio() {
  state.tools.metronome?.stop?.({ silent: true });
  state.tools.tuner?.stop?.();
  globalThis.window?.speechSynthesis?.cancel?.();
}

function reloadAfterLogout() {
  try {
    globalThis.window?.setTimeout?.(() => {
      try {
        globalThis.window.location.reload();
      } catch {
        // A reload is a convenience for a clean user switch; logout is already complete.
      }
    }, 0);
  } catch {
    // A reload is a convenience for a clean user switch; logout is already complete.
  }
}

function announce(message) {
  dom.liveRegion.textContent = message;
}

function registerServiceWorker() {
  const serviceWorker = globalThis.navigator?.serviceWorker || globalThis.window?.navigator?.serviceWorker;
  if (serviceWorker) {
    serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => registration.update()).catch(() => {});
  }
}
