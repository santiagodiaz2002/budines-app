export function serializeUser(user) {
  return {
    id: user.id,
    displayName: user.displayName
  };
}

export function serializeRecord(record) {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    grams: record.grams,
    amountArs: record.amountArs,
    user: record.userId
      ? {
          id: record.userId,
          displayName: record.userDisplayName
        }
      : null,
    commercialDate: record.commercialDate,
    createdAt: record.createdAt,
    voidedAt: record.voidedAt,
    voidedBy: record.voidedByUserId
      ? {
          id: record.voidedByUserId,
          displayName: record.voidedByDisplayName
        }
      : null,
    deletedAt: record.deletedAt || record.voidedAt || null,
    deletedBy: record.deletedByUserId
      ? {
          id: record.deletedByUserId,
          displayName: record.deletedByDisplayName
        }
      : record.voidedByUserId
        ? {
            id: record.voidedByUserId,
            displayName: record.voidedByDisplayName
          }
        : null,
    isDeleted: Boolean(record.isDeleted)
  };
}
