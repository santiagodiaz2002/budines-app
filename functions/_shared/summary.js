import { ApiError } from './http.js';

export function calculateRecoverySummary(totalArs, investmentArs) {
  assertMoneyInteger(totalArs, 'total');
  assertMoneyInteger(investmentArs, 'inversión');

  if (totalArs < investmentArs) {
    return {
      totalArs,
      investmentArs,
      state: 'recuperando',
      investmentRecovered: false,
      missingArs: investmentArs - totalArs,
      profitArs: 0
    };
  }

  return {
    totalArs,
    investmentArs,
    state: totalArs === investmentArs ? 'recuperada' : 'ganancia',
    investmentRecovered: true,
    missingArs: 0,
    profitArs: totalArs - investmentArs
  };
}

export async function getSummary(repo) {
  const [investmentArs, totalArs] = await Promise.all([
    repo.getInitialInvestmentArs(),
    repo.getActiveTotalArs()
  ]);

  return calculateRecoverySummary(totalArs, investmentArs);
}

function assertMoneyInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(500, 'invalid_summary_value', `El valor de ${label} no es válido.`);
  }
}
