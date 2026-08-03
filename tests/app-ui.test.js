import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync('public/index.html', 'utf8');

let windowRef;
let records;
let summary;
let ownerSummary;
let ownerSummaryCalls;
let ownerSummaryShouldFail;
let ownerSummaryGate;
let deleteCalls;
let createCalls;
let deleteShouldFail;

beforeEach(async () => {
  records = [
    {
      id: 'saldo-inicial-ars-3000',
      type: 'saldo_inicial',
      status: 'activo',
      grams: null,
      amountArs: 3000,
      user: null,
      commercialDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      voidedAt: null,
      voidedBy: null
    }
  ];
  summary = {
    totalArs: 3000,
    investmentArs: 120000,
    state: 'recuperando',
    investmentRecovered: false,
    missingArs: 117000,
    profitArs: 0
  };
  ownerSummary = {
    santiArs: 2000,
    leandroArs: 1000,
    totalArs: 3000
  };
  ownerSummaryCalls = 0;
  ownerSummaryShouldFail = false;
  ownerSummaryGate = null;
  deleteCalls = [];
  createCalls = [];
  deleteShouldFail = false;

  windowRef = new Window({
    url: 'https://budines.test/'
  });
  windowRef.document.write(html);
  windowRef.document.close();

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
  let uuidCounter = 0;
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => {
      uuidCounter += 1;
      return `test-uuid-${uuidCounter}`;
    })
  });
  vi.stubGlobal('fetch', vi.fn(handleFetch));

  vi.resetModules();
  await import('../public/js/app.js');
  await waitFor(() => !document.querySelector('#budines-tool').hidden);
  document.querySelector('#show-records').click();
  await waitFor(() => document.querySelectorAll('[data-record-card]').length === records.length);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  windowRef?.close();
});

describe('interfaz de carga de Budines', () => {
  it('navega los subtabs con flechas, Home y End', async () => {
    const entryTab = document.querySelector('#show-entry');
    const recordsTab = document.querySelector('#show-records');
    const entrySection = document.querySelector('#entry-section');
    const recordsSection = document.querySelector('#records-section');

    recordsTab.focus();
    recordsTab.dispatchEvent(new windowRef.KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true
    }));

    expect(entryTab.getAttribute('aria-selected')).toBe('true');
    expect(recordsTab.getAttribute('aria-selected')).toBe('false');
    expect(entryTab.tabIndex).toBe(0);
    expect(recordsTab.tabIndex).toBe(-1);
    expect(entrySection.hidden).toBe(false);
    expect(recordsSection.hidden).toBe(true);
    expect(document.activeElement).toBe(entryTab);

    entryTab.dispatchEvent(new windowRef.KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true
    }));

    expect(recordsTab.getAttribute('aria-selected')).toBe('true');
    expect(recordsSection.hidden).toBe(false);
    expect(document.activeElement).toBe(recordsTab);

    recordsTab.dispatchEvent(new windowRef.KeyboardEvent('keydown', {
      key: 'Home',
      bubbles: true,
      cancelable: true
    }));

    expect(entryTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(entryTab);

    entryTab.dispatchEvent(new windowRef.KeyboardEvent('keydown', {
      key: 'End',
      bubbles: true,
      cancelable: true
    }));

    expect(recordsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(recordsTab);
    await waitFor(() => document.querySelectorAll('[data-record-card]').length === records.length);
  });

  it('usa GR como unidad inicial y permite guardar GR', async () => {
    document.querySelector('#show-entry').click();

    expect(document.querySelector('#quantity-unit-gr').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#quantity-unit-ap').getAttribute('aria-pressed')).toBe('false');

    document.querySelector('#grams-input').value = '350';
    document.querySelector('#amount-input').value = '7000';
    document.querySelector('#sale-form').dispatchEvent(new windowRef.Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => createCalls.length === 1);

    expect(createCalls[0]).toMatchObject({
      grams: '350',
      quantityUnit: 'GR',
      amountArs: '7000'
    });
    expect(summary.totalArs).toBe(10000);

    document.querySelector('#show-records').click();
    await waitFor(() => document.querySelector('#records-list').textContent.includes('350 GR'));
    expect(document.querySelector('#records-list').textContent).toContain('350 GR');
  });

  it('cambia a AP, guarda AP y vuelve el selector a GR', async () => {
    document.querySelector('#show-entry').click();
    document.querySelector('#quantity-unit-ap').click();

    expect(document.querySelector('#quantity-unit-gr').getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('#quantity-unit-ap').getAttribute('aria-pressed')).toBe('true');

    document.querySelector('#grams-input').value = '12';
    document.querySelector('#amount-input').value = '5000';
    document.querySelector('#sale-form').dispatchEvent(new windowRef.Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => createCalls.length === 1);

    expect(createCalls[0]).toMatchObject({
      grams: '12',
      quantityUnit: 'AP',
      amountArs: '5000'
    });
    await waitFor(() => document.querySelector('#quantity-unit-gr').getAttribute('aria-pressed') === 'true');
    expect(document.querySelector('#quantity-unit-gr').getAttribute('aria-pressed')).toBe('true');
    expect(summary.totalArs).toBe(8000);

    document.querySelector('#show-records').click();
    await waitFor(() => document.querySelector('#records-list').textContent.includes('12 AP'));
    expect(document.querySelector('#records-list').textContent).toContain('12 AP');
  });

  it('muestra registros antiguos sin unidad como GR', async () => {
    records = [
      {
        id: 'venta-vieja-sin-unidad',
        type: 'venta',
        status: 'activo',
        grams: 350,
        amountArs: 7000,
        user: {
          id: 'santi',
          displayName: 'Santi'
        },
        commercialDate: '2026-07-23',
        createdAt: '2026-07-23T15:00:00.000Z',
        voidedAt: null,
        voidedBy: null
      }
    ];

    document.querySelector('#reload-records').click();

    await waitFor(() => document.querySelector('#records-list').textContent.includes('350 GR'));
    expect(document.querySelector('#records-list').textContent).toContain('350 GR');
    expect(document.querySelector('#records-list').textContent).not.toContain('gramos');
    expect(document.querySelector('#records-list').textContent).not.toContain('tiros');
  });
});

describe('resumen por propietario', () => {
  it('muestra carga sin importes anteriores y publica solo la respuesta nueva', async () => {
    const button = document.querySelector('#owner-summary-button');
    const dialog = document.querySelector('#owner-summary-dialog');

    button.click();
    await waitFor(() => !document.querySelector('#owner-summary-details').hidden);
    expect(document.querySelector('#owner-summary-santi').textContent).toContain('2.000');
    document.querySelector('#owner-summary-close').click();

    ownerSummary = {
      santiArs: 5000,
      leandroArs: 7000,
      totalArs: 12000
    };
    ownerSummaryGate = createDeferred();
    button.click();

    expect(dialog.hidden).toBe(false);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('#owner-summary-state').textContent).toBe('Cargando resumen...');
    expect(document.querySelector('#owner-summary-details').hidden).toBe(true);
    expect(document.querySelector('#owner-summary-santi').textContent).toBe('');
    expect(document.querySelector('#owner-summary-leandro').textContent).toBe('');
    expect(document.querySelector('#owner-summary-total').textContent).toBe('');
    expect(dialog.textContent).not.toContain('2.000');

    ownerSummaryGate.resolve();
    await waitFor(() => !document.querySelector('#owner-summary-details').hidden);

    expect(document.querySelector('#owner-summary-santi').textContent).toContain('5.000');
    expect(document.querySelector('#owner-summary-leandro').textContent).toContain('7.000');
    expect(document.querySelector('#owner-summary-total').textContent).toContain('12.000');
    expect(dialog.hasAttribute('aria-busy')).toBe(false);
    expect(ownerSummaryCalls).toBe(2);
  });

  it('muestra importes argentinos, incluido cero, y metadatos accesibles', async () => {
    ownerSummary = {
      santiArs: 125000,
      leandroArs: 0,
      totalArs: 125000
    };

    document.querySelector('#owner-summary-button').click();

    const dialog = document.querySelector('#owner-summary-dialog');
    expect(dialog.hidden).toBe(false);
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('owner-summary-title');
    expect(document.querySelector('#owner-summary-title').textContent).toBe('Resumen');
    expect(document.activeElement).toBe(document.querySelector('#owner-summary-close'));

    await waitFor(() => !document.querySelector('#owner-summary-details').hidden);

    expect(document.querySelector('#owner-summary-santi').textContent).toContain('$');
    expect(document.querySelector('#owner-summary-santi').textContent).toContain('125.000');
    expect(document.querySelector('#owner-summary-leandro').textContent).toContain('$');
    expect(document.querySelector('#owner-summary-leandro').textContent).toContain('0');
    expect(document.querySelector('#owner-summary-total').textContent).toContain('125.000');
    expect(document.querySelector('#owner-summary-state').textContent).toBe('Importes actualizados.');
  });

  it('vuelve a consultar al reabrir y refleja datos persistidos mas recientes', async () => {
    ownerSummary = {
      santiArs: 100,
      leandroArs: 200,
      totalArs: 300
    };
    const button = document.querySelector('#owner-summary-button');

    button.click();
    await waitFor(() => !document.querySelector('#owner-summary-details').hidden);
    expect(document.querySelector('#owner-summary-santi').textContent).toContain('100');
    document.querySelector('#owner-summary-close').click();

    ownerSummary = {
      santiArs: 9000,
      leandroArs: 0,
      totalArs: 9000
    };
    button.click();
    await waitFor(() => document.querySelector('#owner-summary-santi').textContent.includes('9.000'));

    expect(ownerSummaryCalls).toBe(2);
    expect(document.querySelector('#owner-summary-santi').textContent).toContain('9.000');
    expect(document.querySelector('#owner-summary-santi').textContent).not.toContain('100');
    expect(document.querySelector('#owner-summary-leandro').textContent).toContain('0');
    expect(document.querySelector('#owner-summary-total').textContent).toContain('9.000');
  });

  it('un error oculta y limpia todos los importes anteriores', async () => {
    ownerSummary = {
      santiArs: 8888,
      leandroArs: 1111,
      totalArs: 9999
    };
    const button = document.querySelector('#owner-summary-button');

    button.click();
    await waitFor(() => !document.querySelector('#owner-summary-details').hidden);
    expect(document.querySelector('#owner-summary-santi').textContent).toContain('8.888');
    document.querySelector('#owner-summary-close').click();

    ownerSummaryShouldFail = true;
    button.click();

    expect(document.querySelector('#owner-summary-details').hidden).toBe(true);
    expect(document.querySelector('#owner-summary-santi').textContent).toBe('');
    expect(document.querySelector('#owner-summary-leandro').textContent).toBe('');
    expect(document.querySelector('#owner-summary-total').textContent).toBe('');

    await waitFor(() => document.querySelector('#owner-summary-state').classList.contains('is-error'));

    expect(document.querySelector('#owner-summary-state').textContent).toBe('No se pudo cargar el resumen.');
    expect(document.querySelector('#owner-summary-details').hidden).toBe(true);
    expect(document.querySelector('#owner-summary-dialog').textContent).not.toContain('8.888');
  });

  it.each([
    ['un importe nulo', { santiArs: null, leandroArs: 1000, totalArs: 1000 }],
    ['un campo ausente', { santiArs: 1000, totalArs: 1000 }],
    ['un importe textual', { santiArs: '1000', leandroArs: 0, totalArs: 1000 }],
    ['un total inconsistente', { santiArs: 1000, leandroArs: 2000, totalArs: 4000 }]
  ])('rechaza %s sin mostrar NaN ni undefined', async (_case, invalidSummary) => {
    ownerSummary = invalidSummary;
    document.querySelector('#owner-summary-button').click();

    await waitFor(() => document.querySelector('#owner-summary-state').classList.contains('is-error'));

    expect(document.querySelector('#owner-summary-state').textContent).toBe('El resumen recibido no es válido.');
    expect(document.querySelector('#owner-summary-details').hidden).toBe(true);
    expect(document.querySelector('#owner-summary-santi').textContent).toBe('');
    expect(document.querySelector('#owner-summary-leandro').textContent).toBe('');
    expect(document.querySelector('#owner-summary-total').textContent).toBe('');
    expect(document.querySelector('#owner-summary-dialog').textContent).not.toMatch(/NaN|undefined/);
  });

  it('cierra con boton, Escape y backdrop y devuelve el foco al disparador', async () => {
    const button = document.querySelector('#owner-summary-button');
    const dialog = document.querySelector('#owner-summary-dialog');
    const close = document.querySelector('#owner-summary-close');

    button.focus();
    button.click();
    expect(document.activeElement).toBe(close);
    close.click();
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(button);

    button.click();
    document.dispatchEvent(new windowRef.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(button);

    button.click();
    dialog.dispatchEvent(new windowRef.MouseEvent('click', { bubbles: true }));
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(button);

    await Promise.resolve();
    await Promise.resolve();
    expect(ownerSummaryCalls).toBe(3);
  });
});

describe('interfaz de eliminacion de registros', () => {
  it('tocar un registro abre el panel con etiquetas accesibles', async () => {
    const card = document.querySelector('[data-record-card]');
    card.click();

    const dialog = document.querySelector('#void-dialog');
    expect(dialog.hidden).toBe(false);
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('#void-title').textContent).toBe('Eliminar registro');
    expect(document.querySelector('#void-details').textContent).toContain('Importe');
    expect(document.querySelector('#void-details').textContent).toContain('Saldo inicial');
    expect(document.activeElement).toBe(document.querySelector('#void-confirmation'));
  });

  it('Cancelar cierra el panel sin llamar a la API', async () => {
    document.querySelector('[data-record-card]').click();
    document.querySelector('#void-cancel').click();

    expect(document.querySelector('#void-dialog').hidden).toBe(true);
    expect(deleteCalls).toHaveLength(0);
    expect(document.querySelectorAll('[data-record-card]')).toHaveLength(1);
  });

  it('Escape y toque fuera cierran el panel sin modificar datos', async () => {
    document.querySelector('[data-record-card]').click();
    document.dispatchEvent(new windowRef.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#void-dialog').hidden).toBe(true);

    document.querySelector('[data-record-card]').click();
    document.querySelector('#void-dialog').dispatchEvent(new windowRef.MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('#void-dialog').hidden).toBe(true);
    expect(deleteCalls).toHaveLength(0);
  });

  it('Eliminar llama a la API una sola vez, deshabilita el boton y actualiza resumen/lista', async () => {
    document.querySelector('[data-record-card]').click();
    document.querySelector('#void-confirmation').value = 'ELIMINAR';
    document.querySelector('#void-confirmation').dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    expect(document.querySelector('#void-submit').disabled).toBe(false);

    document.querySelector('#void-form').dispatchEvent(new windowRef.Event('submit', { bubbles: true, cancelable: true }));
    expect(document.querySelector('#void-submit').disabled).toBe(true);

    await waitFor(() => document.querySelector('#void-dialog').hidden);

    expect(deleteCalls).toEqual([{ id: 'saldo-inicial-ars-3000', confirmation: 'ELIMINAR' }]);
    expect(document.querySelectorAll('[data-record-card]')).toHaveLength(0);
    expect(document.querySelector('#records-state').textContent).toBe('No hay registros activos.');
    expect(document.querySelector('#summary-total').textContent).toContain('0');
  });

  it('un error conserva el panel y muestra mensaje', async () => {
    deleteShouldFail = true;
    document.querySelector('[data-record-card]').click();
    document.querySelector('#void-confirmation').value = 'ELIMINAR';
    document.querySelector('#void-confirmation').dispatchEvent(new windowRef.Event('input', { bubbles: true }));
    document.querySelector('#void-form').dispatchEvent(new windowRef.Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => document.querySelector('#void-error').textContent.length > 0);

    expect(document.querySelector('#void-dialog').hidden).toBe(false);
    expect(document.querySelector('#void-error').textContent).toBe('No se pudo eliminar.');
    expect(document.querySelectorAll('[data-record-card]')).toHaveLength(1);
  });
});

async function handleFetch(input, options = {}) {
  const url = new URL(String(input), 'https://budines.test');
  const method = options.method || 'GET';

  if (url.pathname === '/api/session') {
    return json({
      ok: true,
      authenticated: true,
      user: {
        id: 'santi',
        displayName: 'Santi',
        capabilities: {
          canAccessBudines: true
        }
      }
    });
  }

  if (url.pathname === '/api/summary') {
    return json({
      ok: true,
      summary
    });
  }

  if (url.pathname === '/api/owner-summary') {
    ownerSummaryCalls += 1;
    if (ownerSummaryGate) {
      await ownerSummaryGate.promise;
    }

    if (ownerSummaryShouldFail) {
      return json(
        {
          ok: false,
          error: {
            code: 'owner_summary_failed',
            message: 'No se pudo cargar el resumen.'
          }
        },
        500
      );
    }

    return json({
      ok: true,
      summary: ownerSummary
    });
  }

  if (url.pathname === '/api/records' && method === 'GET') {
    return json({
      ok: true,
      records,
      pagination: {
        limit: 30,
        offset: 0,
        hasMore: false,
        nextOffset: null
      }
    });
  }

  if (url.pathname === '/api/records' && method === 'POST') {
    const body = JSON.parse(options.body);
    createCalls.push(body);

    const record = {
      id: body.idempotencyKey,
      type: 'venta',
      status: 'activo',
      grams: Number(body.grams),
      quantityUnit: body.quantityUnit ?? 'GR',
      amountArs: Number(body.amountArs),
      user: {
        id: 'santi',
        displayName: 'Santi'
      },
      commercialDate: '2026-07-23',
      createdAt: '2026-07-23T15:00:00.000Z',
      voidedAt: null,
      voidedBy: null
    };
    records = [record, ...records];
    summary = {
      ...summary,
      totalArs: summary.totalArs + record.amountArs,
      missingArs: Math.max(0, summary.missingArs - record.amountArs)
    };

    return json(
      {
        ok: true,
        result: 'created',
        record
      },
      201
    );
  }

  if (url.pathname === '/api/records/saldo-inicial-ars-3000/void' && method === 'POST') {
    const body = JSON.parse(options.body);
    deleteCalls.push({
      id: 'saldo-inicial-ars-3000',
      confirmation: body.confirmation
    });

    if (deleteShouldFail) {
      return json(
        {
          ok: false,
          error: {
            code: 'delete_failed',
            message: 'No se pudo eliminar.'
          }
        },
        500
      );
    }

    records = [];
    summary = {
      ...summary,
      totalArs: 0,
      missingArs: 120000
    };

    return json({
      ok: true,
      result: 'deleted',
      record: {
        id: 'saldo-inicial-ars-3000',
        isDeleted: true
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

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
