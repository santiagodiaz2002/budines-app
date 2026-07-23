const LEGACY_OWNER_CLAIM_KEY = 'budines.local.legacy-owner-claim.v1';
const MIGRATION_PREFIX = 'budines.local.migrated.v1';
const LEGACY_KEYS = [
  'budines.truco.v1',
  'budines.truco.visual.v1',
  'budines.metronome.v1',
  'budines.metronome.songs.v1',
  'budines.metronome.songs.v2'
];

let activeUserId = '';

export function setLocalStorageUser(user) {
  activeUserId = sanitizeUserId(user?.id);
  if (!activeUserId || !user?.capabilities?.canAccessBudines) {
    return;
  }

  migrateLegacyKeysForOwner(activeUserId);
}

export function clearLocalStorageUser() {
  activeUserId = '';
}

export function scopedStorageKey(baseKey) {
  if (!activeUserId) {
    return baseKey;
  }
  return `${baseKey}.user.${activeUserId}`;
}

export function getStorage() {
  return globalThis.localStorage || globalThis.window?.localStorage || null;
}

function migrateLegacyKeysForOwner(userId) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const claimedBy = storage.getItem(LEGACY_OWNER_CLAIM_KEY);
  if (claimedBy && claimedBy !== userId) {
    return;
  }

  if (!claimedBy) {
    storage.setItem(LEGACY_OWNER_CLAIM_KEY, userId);
  }

  for (const legacyKey of LEGACY_KEYS) {
    const markerKey = `${MIGRATION_PREFIX}.${userId}.${legacyKey}`;
    if (storage.getItem(markerKey)) {
      continue;
    }

    const legacyValue = storage.getItem(legacyKey);
    const scopedKey = scopedStorageKey(legacyKey);
    if (legacyValue !== null && storage.getItem(scopedKey) === null) {
      storage.setItem(scopedKey, legacyValue);
    }
    storage.setItem(markerKey, new Date().toISOString());
  }
}

function sanitizeUserId(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}
