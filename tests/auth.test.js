import { describe, expect, it } from 'vitest';
import { getCurrentSession, requireSession, verifyActivationCode } from '../functions/_shared/auth.js';
import { sha256Hex } from '../functions/_shared/crypto.js';
import { onRequest as summaryEndpoint } from '../functions/api/summary.js';

describe('autenticación', () => {
  it('acepta credencial válida y rechaza credencial inválida', async () => {
    const env = {
      SANTI_ACTIVATION_CODE: 'codigo-local-santi',
      LEANDRO_ACTIVATION_CODE: 'codigo-local-leandro'
    };

    await expect(verifyActivationCode(env, 'santi', 'codigo-local-santi')).resolves.toBeUndefined();
    await expect(verifyActivationCode(env, 'santi', 'otro-codigo')).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials'
    });
  });

  it('rechaza token expirado y token revocado', async () => {
    const token = 'token-local-privado';
    const hash = await sha256Hex(token);

    const expired = await getCurrentSession(fakeContext(token, {
      tokenHash: hash,
      expiresAt: '2000-01-01T00:00:00.000Z',
      revokedAt: null
    }));

    const revoked = await getCurrentSession(fakeContext(token, {
      tokenHash: hash,
      expiresAt: '2999-01-01T00:00:00.000Z',
      revokedAt: '2026-07-11T00:00:00.000Z'
    }));

    expect(expired).toBeNull();
    expect(revoked).toBeNull();
  });

  it('acepta token vigente y actualiza último uso', async () => {
    const token = 'token-local-vigente';
    const hash = await sha256Hex(token);
    const context = fakeContext(token, {
      tokenHash: hash,
      expiresAt: '2999-01-01T00:00:00.000Z',
      revokedAt: null
    });

    const session = await getCurrentSession(context);

    expect(session.user).toEqual({
      id: 'santi',
      displayName: 'Santi'
    });
    expect(context.env.DB.lastUsedUpdated).toBe(true);
  });

  it('endpoint protegido sin sesión devuelve 401', async () => {
    const response = await summaryEndpoint({
      request: new Request('https://budines.test/api/summary', {
        method: 'GET'
      }),
      env: {}
    });

    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
    await expect(requireSession({
      request: new Request('https://budines.test/api/summary'),
      env: {}
    })).rejects.toMatchObject({
      status: 401
    });
  });
});

function fakeContext(token, sessionRow) {
  const db = {
    lastUsedUpdated: false,
    prepare(sql) {
      return {
        bind: (...bindings) => ({
          first: async () => {
            if (!sql.includes('FROM sessions')) {
              return null;
            }

            const [tokenHash, now] = bindings;
            if (
              tokenHash !== sessionRow.tokenHash ||
              sessionRow.revokedAt !== null ||
              sessionRow.expiresAt <= now
            ) {
              return null;
            }

            return {
              session_id: 'session-1',
              user_id: 'santi',
              display_name: 'Santi',
              expires_at: sessionRow.expiresAt
            };
          },
          run: async () => {
            db.lastUsedUpdated = true;
            return {};
          }
        })
      };
    }
  };

  return {
    request: new Request('https://budines.test/api/session', {
      headers: {
        Cookie: `budines_session=${token}`
      }
    }),
    env: {
      DB: db
    }
  };
}
