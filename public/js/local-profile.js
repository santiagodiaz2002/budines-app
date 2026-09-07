import { getStorage } from './local-storage.js?v=auth-20260723';

// Only a local-tools profile: never a session or a backend permission.
const LOCAL_PROFILE_KEY = 'budines.local.profile.v1';

export function rememberLocalProfile(user) {
  try {
    getStorage()?.setItem(LOCAL_PROFILE_KEY, JSON.stringify({ id: user.id, displayName: user.displayName }));
  } catch { /* Local tools also work when storage is unavailable. */ }
}

export function readLocalProfile() {
  try {
    const user = JSON.parse(getStorage()?.getItem(LOCAL_PROFILE_KEY));
    if (typeof user?.id === 'string' && typeof user.displayName === 'string') {
      return { id: user.id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80), displayName: user.displayName.slice(0, 30), capabilities: { canAccessBudines: false } };
    }
  } catch { /* Ignore invalid local metadata. */ }
  return { id: '', displayName: 'Herramientas locales', capabilities: { canAccessBudines: false } };
}

export function forgetLocalProfile() {
  try { getStorage()?.removeItem(LOCAL_PROFILE_KEY); } catch { /* Optional metadata. */ }
}
