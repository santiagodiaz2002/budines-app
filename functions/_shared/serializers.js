export function serializeUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    capabilities: {
      canAccessBudines: Boolean(user.canAccessBudines)
    }
  };
}
