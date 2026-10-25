import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { onRequest as registerOptions } from '../functions/api/v1/auth/passkey/register/options';
import { onRequest as registerVerify } from '../functions/api/v1/auth/passkey/register/verify';
import { onRequest as loginOptions } from '../functions/api/v1/auth/passkey/login/options';
import { onRequest as loginVerify } from '../functions/api/v1/auth/passkey/login/verify';

/** Wiring proof: the four passkey Pages routes exist, export onRequest, and
 * forward to the REAL reviewed handlers in server/auth/webauthn (never a
 * reimplementation). Handler behavior itself is covered by
 * auth-webauthn-handlers.test.ts and the virtual-authenticator e2e. */
describe('passkey route wiring', () => {
  it('exposes the four routes as live functions', () => {
    for (const r of [registerOptions, registerVerify, loginOptions, loginVerify])
      expect(typeof r).toBe('function');
  });

  it('each route file delegates to the matching reviewed handler', () => {
    const expectDelegation = (rel: string, handler: string) => {
      const src = readFileSync(join('functions', 'api', 'v1', 'auth', 'passkey', rel), 'utf8');
      expect(src).toContain(`import { ${handler} } from '../../../../../../server/auth/webauthn'`);
      expect(src).toContain(`${handler}(request, env)`);
    };
    expectDelegation(join('register', 'options.ts'), 'handlePasskeyRegisterOptions');
    expectDelegation(join('register', 'verify.ts'), 'handlePasskeyRegisterVerify');
    expectDelegation(join('login', 'options.ts'), 'handlePasskeyLoginOptions');
    expectDelegation(join('login', 'verify.ts'), 'handlePasskeyLoginVerify');
  });
});
