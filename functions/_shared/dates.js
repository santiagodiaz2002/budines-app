export function nowIso(date = new Date()) {
  return date.toISOString();
}

export function addDaysIso(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}
