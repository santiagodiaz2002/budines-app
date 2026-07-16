import {
  activateDevice,
  createRecord,
  deleteRecord,
  getSession,
  getSummary,
  listRecords,
  logout
} from './api.js';
import {
  formatArs,
  formatCommercialDate,
  formatInteger,
  formatRecordStatus,
  formatRecordType
} from './format.js';
import { createAudioCoordinator } from './audio-coordinator.js';
import { initMetronome } from './metronome-editor.js?v=metronome-fix-20260716c';
import { initToolNavigation } from './navigation.js';
import { initTruco } from './truco.js?v=metronome-fix-20260716c';
import { initTuner } from './tuner.js';
import { parsePositiveIntegerText, validateSaleFields } from './validation.js';

const dom = {
  activationView: document.querySelector('#activation-view'),
  activationForm: document.querySelector('#activation-form'),
  activationUser: document.querySelector('#activation-user'),
  activationCode: document.querySelector('#activation-code'),
  activationSubmit: document.querySelector('#activation-submit'),
  activationError: document.querySelector('#activation-error'),
  appView: document.querySelector('#app-view'),
  sessionBadge: document.querySelector('#session-badge'),
  summaryTotal: document.querySelector('#summary-total'),
  summaryLines: document.querySelector('#summary-lines'),
  showEntry: document.querySelector('#show-entry'),
  showRecords: document.querySelector('#show-records'),
  entrySection: document.querySelector('#entry-section'),
  recordsSection: document.querySelector('#records-section'),
  saleForm: document.querySelector('#sale-form'),
  gramsInput: document.querySelector('#grams-input'),
  amountInput: document.querySelector('#amount-input'),
  amountPreview: document.querySelector('#amount-preview'),
  saleSubmit: document.querySelector('#sale-submit'),
  saleError: document.querySelector('#sale-error'),
  logoutButton: document.querySelector('#logout-button'),
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
  isSubmittingSale: false,
  saleIdempotencyKey: null,
  lastSalePayload: null,
  recordsOffset: 0,
  recordsLimit: 30,
  hasMoreRecords: false,
  recordPendingDelete: null,
  deleteTrigger: null,
  isDeletingRecord: false
};

init();

function init() {
  registerServiceWorker();
  initLocalTools();
  bindEvents();
  bootSession();
}

function initLocalTools() {
  const audioCoordinator = createAudioCoordinator();
  initToolSafely('navegación', () => initToolNavigation());
  initToolSafely('truco', () => initTruco());
  initToolSafely('metrónomo', () => initMetronome(document.querySelector('#metronome-tool'), audioCoordinator));
  initToolSafely('afinador', () => initTuner(document.querySelector('#tuner-tool'), audioCoordinator));
}

function initToolSafely(name, initializer) {
  try {
    return initializer();
  } catch (error) {
    console.error(`No se pudo iniciar ${name}.`, error);
    return null;
  }
}

function bindEvents() {
  dom.activationForm.addEventListener('submit', handleActivationSubmit);
  dom.saleForm.addEventListener('submit', handleSaleSubmit);
  dom.amountInput.addEventListener('input', handleAmountInput);
  dom.gramsInput.addEventListener('input', handleSaleInputChange);
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
  setActivationBusy(true);
  try {
    const session = await getSession();
    if (session.authenticated) {
      showApp(session.user);
      await refreshAppData();
    } else {
      showActivation();
    }
  } catch (error) {
    showActivation(error.message);
  } finally {
    setActivationBusy(false);
  }
}

async function handleActivationSubmit(event) {
  event.preventDefault();
  dom.activationError.textContent = '';
  setActivationBusy(true);

  try {
    const result = await activateDevice({
      userName: dom.activationUser.value,
      activationCode: dom.activationCode.value
    });
    dom.activationCode.value = '';
    showApp(result.user);
    announce('Dispositivo activado.');
    await refreshAppData();
    dom.gramsInput.focus();
  } catch (error) {
    dom.activationError.textContent = error.message;
    announce(error.message);
  } finally {
    setActivationBusy(false);
  }
}

async function handleSaleSubmit(event) {
  event.preventDefault();
  if (state.isSubmittingSale) {
    return;
  }

  const gramsRaw = dom.gramsInput.value;
  const amountRaw = dom.amountInput.value;
  const validation = validateSaleFields(gramsRaw, amountRaw);
  if (!validation.ok) {
    showSaleError(validation.message, validation.field);
    return;
  }

  const payload = {
    grams: gramsRaw,
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
    state.lastSalePayload.amountArs === dom.amountInput.value;

  if (!unchanged) {
    state.saleIdempotencyKey = null;
    state.lastSalePayload = null;
  }
}

async function handleLogout() {
  dom.logoutButton.disabled = true;
  try {
    await logout();
  } finally {
    state.user = null;
    showActivation();
    announce('Sesion cerrada.');
    dom.logoutButton.disabled = false;
  }
}

function handleRecordsClick(event) {
  const card = event.target.closest('[data-record-card]');
  if (!card) {
    return;
  }

  state.deleteTrigger = card;
  openDeleteDialog(card.record);
}

async function handleDeleteSubmit(event) {
  event.preventDefault();
  if (!state.recordPendingDelete || state.isDeletingRecord) {
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
  await Promise.all([loadSummary(), loadRecords({ reset: true })]);
}

async function loadSummary() {
  try {
    const result = await getSummary();
    renderSummary(result.summary);
  } catch (error) {
    dom.summaryTotal.textContent = 'Sin datos';
    dom.summaryLines.replaceChildren(summaryLine('Error', error.message));
  }
}

async function loadRecords({ reset }) {
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
  const lines = [summaryLine('Inversion', formatArs(summary.investmentArs))];

  if (!summary.investmentRecovered) {
    lines.push(summaryLine('Falta recuperar', formatArs(summary.missingArs), 'is-missing'));
  } else {
    lines.push(summaryLine('Inversion recuperada', 'Si'));
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
    detailItem('Gramos', record.grams === null ? 'Sin informar' : `${formatInteger(record.grams)} g`),
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
  dom.voidCopy.textContent = `Vas a eliminar ${formatArs(record.amountArs)}. La fila queda guardada como baja logica y deja de contar en el resumen.`;
  dom.voidDetails.replaceChildren(
    detailItem('Importe', formatArs(record.amountArs)),
    detailItem('Tipo', formatRecordType(record.type)),
    detailItem('Usuario', record.user?.displayName || 'Saldo inicial'),
    detailItem('Gramos', record.grams === null ? 'Sin informar' : `${formatInteger(record.grams)} g`),
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

function showActivation(message = '') {
  dom.activationView.hidden = false;
  dom.appView.hidden = true;
  dom.sessionBadge.hidden = true;
  dom.sessionBadge.textContent = '';
  dom.activationError.textContent = message;
  dom.activationCode.value = '';
  dom.activationCode.focus();
}

function showApp(user) {
  state.user = user;
  dom.activationView.hidden = true;
  dom.appView.hidden = false;
  dom.sessionBadge.hidden = false;
  dom.sessionBadge.textContent = user.displayName;
  switchView('entry');
}

function showSaleError(message, field) {
  dom.saleError.textContent = message;
  dom.gramsInput.setAttribute('aria-invalid', field === 'grams' ? 'true' : 'false');
  dom.amountInput.setAttribute('aria-invalid', field === 'amount' ? 'true' : 'false');
  const target = field === 'grams' ? dom.gramsInput : dom.amountInput;
  target.focus();
  announce(message);
}

function setActivationBusy(isBusy) {
  dom.activationSubmit.disabled = isBusy;
  dom.activationUser.disabled = isBusy;
  dom.activationCode.disabled = isBusy;
  dom.activationSubmit.textContent = isBusy ? 'Activando...' : 'Activar';
}

function setSaleBusy(isBusy) {
  state.isSubmittingSale = isBusy;
  dom.saleSubmit.disabled = isBusy;
  dom.gramsInput.disabled = isBusy;
  dom.amountInput.disabled = isBusy;
  dom.saleSubmit.textContent = isBusy ? 'Guardando...' : 'Registrar';
  if (!isBusy) {
    dom.gramsInput.removeAttribute('aria-invalid');
    dom.amountInput.removeAttribute('aria-invalid');
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
