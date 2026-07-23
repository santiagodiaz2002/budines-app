import {
  createRecord,
  deleteRecord,
  getSession,
  getSummary,
  listRecords,
  login,
  logout,
  registerAccount
} from './api.js?v=quantity-20260723';
import {
  formatArs,
  formatCommercialDate,
  formatInteger,
  formatRecordStatus,
  formatRecordType
} from './format.js';
import { createAudioCoordinator } from './audio-coordinator.js';
import { initMetronome } from './metronome-editor.js?v=auth-20260723';
import { initToolNavigation } from './navigation.js';
import { initTruco } from './truco.js?v=auth-20260723';
import { initTuner } from './tuner.js';
import { clearLocalStorageUser, setLocalStorageUser } from './local-storage.js?v=auth-20260723';
import { parsePositiveIntegerText, validateSaleFields } from './validation.js?v=quantity-20260723';

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

const OWNER_TABS = ['budines', 'truco', 'metronome', 'tuner'];
const COMMON_TABS = ['truco', 'metronome', 'tuner'];

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
  budinesTool: document.querySelector('#budines-tool'),
  budinesTab: document.querySelector('#tab-budines'),
  appView: document.querySelector('#app-view'),
  summaryTotal: document.querySelector('#summary-total'),
  summaryLines: document.querySelector('#summary-lines'),
  showEntry: document.querySelector('#show-entry'),
  showRecords: document.querySelector('#show-records'),
  entrySection: document.querySelector('#entry-section'),
  recordsSection: document.querySelector('#records-section'),
  saleForm: document.querySelector('#sale-form'),
  gramsInput: document.querySelector('#grams-input'),
  quantityUnitButtons: [...document.querySelectorAll('[data-quantity-unit]')],
  amountInput: document.querySelector('#amount-input'),
  amountPreview: document.querySelector('#amount-preview'),
  saleSubmit: document.querySelector('#sale-submit'),
  saleError: document.querySelector('#sale-error'),
  reloadRecords: document.querySelector('#reload-records'),
  recordsState: document.querySelector('#records-state'),
  recordsList: document.querySelector('#records-list'),
  loadMoreRecords: document.querySelector('#load-more-records'),
  voidDialog: document.querySelector('#void-dialog'),
  voidCopy: document.querySelector('#void-copy'),
  voidDetails: document.querySelector('#void-details'),
  voidForm: document.querySelector('#void-form'),
  voidConfirmation: document.querySelector('#void-confirmation'),
  voidError: document.querySelector('#void-error'),
  voidCancel: document.querySelector('#void-cancel'),
  voidSubmit: document.querySelector('#void-submit'),
  liveRegion: document.querySelector('#live-region')
};

const state = {
  user: null,
  authMode: 'login',
  isAuthBusy: false,
  isSubmittingSale: false,
  saleIdempotencyKey: null,
  lastSalePayload: null,
  quantityUnit: 'GR',
  recordsOffset: 0,
  recordsLimit: 30,
  hasMoreRecords: false,
  recordPendingDelete: null,
  deleteTrigger: null,
  isDeletingRecord: false,
  tools: {
    initialized: false,
    navigation: null,
    metronome: null,
    tuner: null
  }
};

const budinesMount = {
  panelParent: dom.budinesTool?.parentNode || null,
  panelNextSibling: dom.budinesTool?.nextSibling || null,
  tabParent: dom.budinesTab?.parentNode || null,
  tabNextSibling: dom.budinesTab?.nextSibling || null
};

init();

function init() {
  registerServiceWorker();
  bindEvents();
  setAuthMode('login');
  bootSession();
}

function bindEvents() {
  dom.authForm.addEventListener('submit', handleAuthSubmit);
  for (const button of dom.authModeButtons) {
    button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
  }
  dom.authPasswordToggle.addEventListener('click', togglePasswordVisibility);
  dom.saleForm.addEventListener('submit', handleSaleSubmit);
  dom.amountInput.addEventListener('input', handleAmountInput);
  dom.gramsInput.addEventListener('input', handleSaleInputChange);
  for (const button of dom.quantityUnitButtons) {
    button.addEventListener('click', () => setQuantityUnit(button.dataset.quantityUnit));
  }
  dom.amountInput.addEventListener('input', handleSaleInputChange);
  dom.showEntry.addEventListener('click', () => switchView('entry'));
  dom.showRecords.addEventListener('click', () => switchView('records'));
  dom.reloadRecords.addEventListener('click', () => loadRecords({ reset: true }));
  dom.loadMoreRecords.addEventListener('click', () => loadRecords({ reset: false }));
  dom.logoutButton.addEventListener('click', handleLogout);
  dom.recordsList.addEventListener('click', handleRecordsClick);
  dom.voidCancel.addEventListener('click', closeDeleteDialog);
  dom.voidConfirmation.addEventListener('input', updateDeleteButtonState);
  dom.voidForm.addEventListener('submit', handleDeleteSubmit);
  dom.voidDialog.addEventListener('click', handleDialogBackdropClick);
  document.addEventListener('keydown', handleDocumentKeydown);
}

async function bootSession() {
  setAuthBusy(true);
  document.body.dataset.authState = 'booting';
  try {
    const session = await getSession();
    if (session.authenticated) {
      await showApp(session.user);
    } else {
      showAuth();
    }
  } catch (error) {
    showAuth(error.message);
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

async function handleSaleSubmit(event) {
  event.preventDefault();
  if (state.isSubmittingSale || !canAccessBudines()) {
    return;
  }

  const gramsRaw = dom.gramsInput.value;
  const amountRaw = dom.amountInput.value;
  const validation = validateSaleFields(gramsRaw, state.quantityUnit, amountRaw);
  if (!validation.ok) {
    showSaleError(validation.message, validation.field);
    return;
  }

  const payload = {
    grams: gramsRaw,
    quantityUnit: state.quantityUnit,
    amountArs: amountRaw
  };

  state.saleIdempotencyKey ||= crypto.randomUUID();
  state.lastSalePayload = payload;
  setSaleBusy(true);
  dom.saleError.textContent = 'Guardando...';
  announce('Guardando registro.');

  try {
    const result = await createRecord({
      ...payload,
      idempotencyKey: state.saleIdempotencyKey
    });

    dom.gramsInput.value = '';
    dom.amountInput.value = '';
    setQuantityUnit('GR');
    dom.amountPreview.textContent = '';
    state.saleIdempotencyKey = null;
    state.lastSalePayload = null;
    dom.saleError.textContent = '';

    await refreshAppData();
    const message = result.result === 'existing' ? 'Registro ya guardado.' : 'Registro guardado.';
    announce(message);
    dom.gramsInput.focus();
  } catch (error) {
    dom.saleError.textContent = `${error.message} Los datos siguen en el formulario.`;
    announce(error.message);
  } finally {
    setSaleBusy(false);
  }
}

function handleAmountInput() {
  const parsed = parsePositiveIntegerText(dom.amountInput.value, 'Importe total');
  dom.amountPreview.textContent = parsed.ok ? formatArs(parsed.value) : '';
}

function handleSaleInputChange() {
  if (!state.lastSalePayload || state.isSubmittingSale) {
    return;
  }

  const unchanged =
    state.lastSalePayload.grams === dom.gramsInput.value &&
    state.lastSalePayload.quantityUnit === state.quantityUnit &&
    state.lastSalePayload.amountArs === dom.amountInput.value;

  if (!unchanged) {
    state.saleIdempotencyKey = null;
    state.lastSalePayload = null;
  }
}

async function handleLogout() {
  dom.logoutButton.disabled = true;
  stopLocalAudio();
  try {
    await logout();
  } finally {
    state.user = null;
    clearLocalStorageUser();
    clearBudinesData();
    showAuth();
    announce('Sesión cerrada.');
    dom.logoutButton.disabled = false;
    reloadAfterLogout();
  }
}

function handleRecordsClick(event) {
  const card = event.target.closest('[data-record-card]');
  if (!card || !canAccessBudines()) {
    return;
  }

  state.deleteTrigger = card;
  openDeleteDialog(card.record);
}

async function handleDeleteSubmit(event) {
  event.preventDefault();
  if (!state.recordPendingDelete || state.isDeletingRecord || !canAccessBudines()) {
    return;
  }

  dom.voidError.textContent = '';
  state.isDeletingRecord = true;
  dom.voidSubmit.disabled = true;
  dom.voidCancel.disabled = true;

  try {
    await deleteRecord({
      id: state.recordPendingDelete.id,
      confirmation: dom.voidConfirmation.value
    });
    state.isDeletingRecord = false;
    dom.voidCancel.disabled = false;
    closeDeleteDialog({ restoreFocus: false });
    await refreshAppData();
    announce('Registro eliminado.');
  } catch (error) {
    dom.voidError.textContent = error.message;
    announce(error.message);
  } finally {
    state.isDeletingRecord = false;
    dom.voidCancel.disabled = false;
    updateDeleteButtonState();
  }
}

async function refreshAppData() {
  if (!canAccessBudines()) {
    return;
  }
  await Promise.all([loadSummary(), loadRecords({ reset: true })]);
}

async function loadSummary() {
  if (!canAccessBudines()) {
    return;
  }

  try {
    const result = await getSummary();
    renderSummary(result.summary);
  } catch (error) {
    dom.summaryTotal.textContent = 'Sin datos';
    dom.summaryLines.replaceChildren(summaryLine('Error', error.message));
  }
}

async function loadRecords({ reset }) {
  if (!canAccessBudines()) {
    return;
  }

  if (reset) {
    state.recordsOffset = 0;
    dom.recordsList.replaceChildren();
  }

  dom.recordsState.textContent = 'Cargando registros...';
  dom.loadMoreRecords.hidden = true;

  try {
    const result = await listRecords({
      limit: state.recordsLimit,
      offset: state.recordsOffset
    });

    if (reset) {
      dom.recordsList.replaceChildren();
    }

    renderRecords(result.records, { append: !reset });
    state.hasMoreRecords = result.pagination.hasMore;
    state.recordsOffset = result.pagination.nextOffset ?? state.recordsOffset + result.records.length;
    dom.loadMoreRecords.hidden = !state.hasMoreRecords;
    dom.recordsState.textContent = dom.recordsList.children.length === 0 ? 'No hay registros activos.' : '';
  } catch (error) {
    dom.recordsState.textContent = error.message;
  }
}

function renderSummary(summary) {
  dom.summaryTotal.textContent = formatArs(summary.totalArs);
  const lines = [summaryLine('Inversión', formatArs(summary.investmentArs))];

  if (!summary.investmentRecovered) {
    lines.push(summaryLine('Falta recuperar', formatArs(summary.missingArs), 'is-missing'));
  } else {
    lines.push(summaryLine('Inversión recuperada', 'Sí'));
    lines.push(summaryLine('Ganancia real', formatArs(summary.profitArs), summary.profitArs > 0 ? 'is-profit' : ''));
  }

  dom.summaryLines.replaceChildren(...lines);
}

function summaryLine(label, value, className = '') {
  const row = document.createElement('div');
  row.className = `summary-line ${className}`.trim();

  const labelElement = document.createElement('span');
  labelElement.textContent = label;

  const valueElement = document.createElement('strong');
  valueElement.textContent = value;

  row.append(labelElement, valueElement);
  return row;
}

function renderRecords(records, { append }) {
  const fragment = document.createDocumentFragment();
  for (const record of records) {
    fragment.append(createRecordCard(record));
  }

  if (append) {
    dom.recordsList.append(fragment);
  } else {
    dom.recordsList.replaceChildren(fragment);
  }
}

function createRecordCard(record) {
  const card = document.createElement('article');
  card.className = 'record-card';
  card.tabIndex = 0;
  card.role = 'button';
  card.dataset.recordCard = record.id;
  card.setAttribute('aria-label', `Abrir acciones de ${formatArs(record.amountArs)}`);
  card.record = record;
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      state.deleteTrigger = card;
      openDeleteDialog(record);
    }
  });

  const head = document.createElement('div');
  head.className = 'record-head';

  const amount = document.createElement('p');
  amount.className = 'record-amount';
  amount.textContent = formatArs(record.amountArs);

  const pill = document.createElement('span');
  pill.className = 'record-pill';
  pill.textContent = formatRecordStatus(record.status);

  head.append(amount, pill);

  const details = document.createElement('dl');
  details.className = 'record-details';
  details.append(
    detailItem('Tipo', formatRecordType(record.type)),
    detailItem('Usuario', record.user?.displayName || 'Saldo inicial'),
    detailItem('Cantidad', formatQuantity(record)),
    detailItem('Fecha', formatCommercialDate(record.commercialDate))
  );

  card.append(head, details);
  return card;
}

function detailItem(label, value) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');

  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);
  return wrapper;
}

function openDeleteDialog(record) {
  state.recordPendingDelete = record;
  dom.voidCopy.textContent = `Vas a eliminar ${formatArs(record.amountArs)}. La fila queda guardada como baja lógica y deja de contar en el resumen.`;
  dom.voidDetails.replaceChildren(
    detailItem('Importe', formatArs(record.amountArs)),
    detailItem('Tipo', formatRecordType(record.type)),
    detailItem('Usuario', record.user?.displayName || 'Saldo inicial'),
    detailItem('Cantidad', formatQuantity(record)),
    detailItem('Fecha', formatCommercialDate(record.commercialDate)),
    detailItem('Estado', formatRecordStatus(record.status))
  );
  dom.voidConfirmation.value = '';
  dom.voidError.textContent = '';
  dom.voidDialog.hidden = false;
  updateDeleteButtonState();
  dom.voidConfirmation.focus();
}

function closeDeleteDialog({ restoreFocus = true } = {}) {
  if (state.isDeletingRecord) {
    return;
  }

  const trigger = state.deleteTrigger;
  state.recordPendingDelete = null;
  state.deleteTrigger = null;
  dom.voidDialog.hidden = true;
  dom.voidDetails.replaceChildren();
  dom.voidConfirmation.value = '';
  dom.voidError.textContent = '';
  dom.voidCancel.disabled = false;
  updateDeleteButtonState();

  if (restoreFocus && trigger?.isConnected) {
    trigger.focus();
  }
}

function updateDeleteButtonState() {
  dom.voidSubmit.disabled = state.isDeletingRecord || dom.voidConfirmation.value !== 'ELIMINAR';
}

function handleDialogBackdropClick(event) {
  if (event.target === dom.voidDialog) {
    closeDeleteDialog();
  }
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape' && !dom.voidDialog.hidden) {
    closeDeleteDialog();
  }
}

function switchView(view) {
  if (!canAccessBudines()) {
    return;
  }

  const records = view === 'records';
  dom.entrySection.hidden = records;
  dom.recordsSection.hidden = !records;
  dom.showEntry.classList.toggle('is-active', !records);
  dom.showRecords.classList.toggle('is-active', records);

  if (records) {
    loadRecords({ reset: true });
  } else {
    dom.gramsInput.focus();
  }
}

function showAuth(message = '') {
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

async function showApp(user) {
  state.user = user;
  setLocalStorageUser(user);
  setBudinesAccess(Boolean(user.capabilities?.canAccessBudines));
  initLocalTools();
  initNavigationForUser(user);

  document.body.dataset.authState = 'app';
  dom.authView.hidden = true;
  dom.bottomTabs.hidden = false;
  dom.userSession.hidden = false;
  dom.sessionBadge.textContent = user.displayName;

  if (canAccessBudines()) {
    state.tools.navigation?.selectTab('budines');
    switchView('entry');
    await refreshAppData();
    dom.gramsInput.focus();
  } else {
    clearBudinesData();
    state.tools.navigation?.selectTab('truco');
  }
}

function initLocalTools() {
  if (state.tools.initialized) {
    return;
  }

  const audioCoordinator = createAudioCoordinator();
  initToolSafely('truco', () => initTruco());
  state.tools.metronome = initToolSafely('metrónomo', () =>
    initMetronome(document.querySelector('#metronome-tool'), audioCoordinator)
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

function initNavigationForUser(user) {
  if (state.tools.navigation) {
    return;
  }

  const allowedTabs = user.capabilities?.canAccessBudines ? OWNER_TABS : COMMON_TABS;
  state.tools.navigation = initToolNavigation({
    allowedTabs,
    initialTab: allowedTabs[0]
  });
}

function setBudinesAccess(allowed) {
  document.body.dataset.budinesAccess = allowed ? 'true' : 'false';
  if (allowed) {
    attachBudinesPanel();
    return;
  }

  detachBudinesPanel();
}

function attachBudinesPanel() {
  if (dom.budinesTool && !dom.budinesTool.isConnected && budinesMount.panelParent) {
    budinesMount.panelParent.insertBefore(dom.budinesTool, budinesMount.panelNextSibling);
  }
  if (dom.budinesTab && !dom.budinesTab.isConnected && budinesMount.tabParent) {
    budinesMount.tabParent.insertBefore(dom.budinesTab, budinesMount.tabNextSibling);
  }
}

function detachBudinesPanel() {
  dom.budinesTool?.remove();
  dom.budinesTab?.remove();
}

function hideToolPanels() {
  for (const panel of document.querySelectorAll('[data-tool-panel]')) {
    panel.hidden = true;
  }
}

function clearBudinesData() {
  dom.summaryTotal.textContent = '$ 0';
  dom.summaryLines.replaceChildren();
  dom.recordsList.replaceChildren();
  dom.recordsState.textContent = '';
  dom.loadMoreRecords.hidden = true;
  dom.saleError.textContent = '';
  dom.amountPreview.textContent = '';
  dom.gramsInput.value = '';
  dom.amountInput.value = '';
  setQuantityUnit('GR');
  state.saleIdempotencyKey = null;
  state.lastSalePayload = null;
  state.recordPendingDelete = null;
}

function showSaleError(message, field) {
  dom.saleError.textContent = message;
  dom.gramsInput.setAttribute('aria-invalid', field === 'grams' ? 'true' : 'false');
  dom.amountInput.setAttribute('aria-invalid', field === 'amount' ? 'true' : 'false');
  const target = field === 'amount' ? dom.amountInput : dom.gramsInput;
  target.focus();
  announce(message);
}

function setQuantityUnit(unit) {
  if (unit !== 'GR' && unit !== 'AP') {
    return;
  }

  const changed = state.quantityUnit !== unit;
  state.quantityUnit = unit;
  for (const button of dom.quantityUnitButtons) {
    const active = button.dataset.quantityUnit === unit;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  if (changed) {
    handleSaleInputChange();
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

function setSaleBusy(isBusy) {
  state.isSubmittingSale = isBusy;
  dom.saleSubmit.disabled = isBusy;
  dom.gramsInput.disabled = isBusy;
  dom.amountInput.disabled = isBusy;
  for (const button of dom.quantityUnitButtons) {
    button.disabled = isBusy;
  }
  dom.saleSubmit.textContent = isBusy ? 'Guardando...' : 'Registrar';
  if (!isBusy) {
    dom.gramsInput.removeAttribute('aria-invalid');
    dom.amountInput.removeAttribute('aria-invalid');
  }
}

function togglePasswordVisibility() {
  const visible = dom.authPassword.type === 'text';
  dom.authPassword.type = visible ? 'password' : 'text';
  dom.authPasswordToggle.textContent = visible ? 'Mostrar' : 'Ocultar';
  dom.authPasswordToggle.setAttribute('aria-pressed', visible ? 'false' : 'true');
  dom.authPassword.focus();
}

function canAccessBudines() {
  return Boolean(state.user?.capabilities?.canAccessBudines);
}

function formatQuantity(record) {
  if (record.grams === null || record.grams === undefined) {
    return 'Sin informar';
  }

  const unit = record.quantityUnit === 'AP' ? 'AP' : 'GR';
  return `${formatInteger(record.grams)} ${unit}`;
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
    serviceWorker.register('/sw.js').catch(() => {});
  }
}
