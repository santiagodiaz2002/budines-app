import { ApiError } from './http.js';

export function calculateRecoverySummary(incomeArs, investmentArs, withdrawalsArs = 0) {
  assertNonNegativeMoneyInteger(incomeArs, 'total de entradas');
  assertNonNegativeMoneyInteger(investmentArs, 'inversión');
  assertNonNegativeMoneyInteger(withdrawalsArs, 'total de retiros');

  const totalArs = incomeArs - withdrawalsArs;
  assertSignedMoneyInteger(totalArs, 'total');

  if (incomeArs < investmentArs) {
    return {
      totalArs,
      recoveryTotalArs: incomeArs,
      investmentArs,
      state: 'recuperando',
      investmentRecovered: false,
      missingArs: investmentArs - incomeArs,
      profitArs: withdrawalsArs === 0 ? 0 : -withdrawalsArs
    };
  }

  return {
    totalArs,
    recoveryTotalArs: incomeArs,
    investmentArs,
    state: incomeArs === investmentArs && withdrawalsArs === 0 ? 'recuperada' : 'ganancia',
    investmentRecovered: true,
    missingArs: 0,
    profitArs: incomeArs - investmentArs - withdrawalsArs
  };
}

export async function getSummary(repo) {
  const [investmentArs, incomeArs, withdrawalsArs] = await Promise.all([
    repo.getInitialInvestmentArs(),
    repo.getActiveTotalArs(),
    repo.getActiveWithdrawalTotalArs?.() ?? 0
  ]);

  return calculateRecoverySummary(incomeArs, investmentArs, withdrawalsArs);
}

export function calculateOwnerSummary(santiArs, leandroArs) {
  assertSignedMoneyInteger(santiArs, 'total de Santi');
  assertSignedMoneyInteger(leandroArs, 'total de Leandro');

  const totalArs = santiArs + leandroArs;
  assertSignedMoneyInteger(totalArs, 'total general');

  return {
    santiArs,
    leandroArs,
    totalArs
  };
}

export async function getOwnerSummary(repo) {
  const totals = await repo.getActiveOwnerTotalsArs();
  return calculateOwnerSummary(totals?.santiArs, totals?.leandroArs);
}

function assertNonNegativeMoneyInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(500, 'invalid_summary_value', `El valor de ${label} no es válido.`);
  }
}

function assertSignedMoneyInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new ApiError(500, 'invalid_summary_value', `El valor de ${label} no es válido.`);
  }
}
