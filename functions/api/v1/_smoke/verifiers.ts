/**
 * TEMPORARY preview-only Workers runtime smoke probe (reviewer-cleared pattern
 * 2026-10-25). NO request input is read; runs embedded cross-implementation
 * fixtures plus fresh noble sign/verify and a simplewebauthn options build;
 * returns pass/fail booleans ONLY - no DB, no challenge, no session, no cookie,
 * no caller bytes. Gated by NATIVE_AUTH_SMOKE (preview env only) behind the
 * Access perimeter. REMOVE this route and the flag after the probe and verify
 * the route 404s. Never deploy to production with the flag set.
 */
import { verifySiweMessage, personalSignDigest } from '../../../../server/auth/siwe';
import { verifySiwsMessage } from '../../../../server/auth/siws';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { generateAuthenticationOptions } from '@simplewebauthn/server';

const SIWE_MSG = atob('cHJldmlldy50ZXN0IHdhbnRzIHlvdSB0byBzaWduIGluIHdpdGggeW91ciBFdGhlcmV1bSBhY2NvdW50OgoweDcwOTk3OTcwQzUxODEyZGMzQTAxMEM3ZDAxYjUwZTBkMTdkYzc5QzgKClNpZ24gaW4gdG8gU29sYS4KClVSSTogaHR0cHM6Ly9wcmV2aWV3LnRlc3Qvc2lnbmluClZlcnNpb246IDEKQ2hhaW4gSUQ6IDEKTm9uY2U6IEVUSEVSU0ZJWFRVUkUxCklzc3VlZCBBdDogMjAyNi0xMC0yNVQxNTowMDowMC4wMDBaCkV4cGlyYXRpb24gVGltZTogMjAyNi0xMC0yNVQxNToxMDowMC4wMDBa');
const SIWE_SIG = '0xce0c74dd64571475371c7b44c89aa77cba457e289211e1d3348467af8d06ad57653ef387206b524eb442bcef940092f9e4b4f6526c17679b6d41cc08eb9bb0be1c';
const SIWS_MSG = atob('cHJldmlldy50ZXN0IHdhbnRzIHlvdSB0byBzaWduIGluIHdpdGggeW91ciBTb2xhbmEgYWNjb3VudDoKR21hRHJwcEJDN1A1QVJLVjhnM2RqaXdQODl2ejFqTEsyM1YyR0JqdUFFR0IKClNpZ24gaW4gdG8gU29sYS4KClVSSTogaHR0cHM6Ly9wcmV2aWV3LnRlc3Qvc2lnbmluCk5vbmNlOiBOQUNMRklYVFVSRTEKSXNzdWVkIEF0OiAyMDI2LTEwLTI1VDE1OjAwOjAwLjAwMFoKRXhwaXJhdGlvbiBUaW1lOiAyMDI2LTEwLTI1VDE1OjEwOjAwLjAwMFo=');

const b64bytes = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const FIXED_NOW = new Date('2026-10-25T15:05:00.000Z');

export const onRequest = async ({ env }: { env: { NATIVE_AUTH_SMOKE?: string } }): Promise<Response> => {
  if (env.NATIVE_AUTH_SMOKE !== 'true')
    return new Response('Not found', { status: 404 });
  const checks: Record<string, boolean> = {};
  try {
    checks.siwe_ethers_fixture = verifySiweMessage(SIWE_MSG, SIWE_SIG, {
      domain: 'preview.test', uri: 'https://preview.test/signin', nonce: 'ETHERSFIXTURE1',
      chainId: 1, address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    }, FIXED_NOW).ok;
    checks.siws_tweetnacl_fixture = verifySiwsMessage(SIWS_MSG, b64bytes('+R1U/kfUOwlN3RrLoMVrTU3L9JYssk9jN5odXtS0O8TnXJtJPzD/Cm7slKtZlGg43jxSv+w/VUh84Vk4Ep0zBg=='), {
      domain: 'preview.test', uri: 'https://preview.test/signin', nonce: 'NACLFIXTURE1',
      address: 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB',
    }, FIXED_NOW).ok;
    const evmPriv = secp256k1.utils.randomPrivateKey();
    const digest = personalSignDigest('runtime smoke');
    const sig = secp256k1.sign(digest, evmPriv);
    checks.ecrecover_fresh = secp256k1.verify(sig, digest, secp256k1.getPublicKey(evmPriv));
    const solPriv = ed25519.utils.randomPrivateKey();
    const msg = new TextEncoder().encode('runtime smoke');
    checks.ed25519_fresh = ed25519.verify(ed25519.sign(msg, solPriv), msg, ed25519.getPublicKey(solPriv));
    const opts = await generateAuthenticationOptions({ rpID: 'preview.test', challenge: 'smoke' });
    checks.webauthn_options_build = typeof opts.challenge === 'string' && opts.challenge.length > 0;
  } catch {
    return new Response(JSON.stringify({ pass: false, checks }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  const pass = Object.values(checks).every(Boolean);
  return new Response(JSON.stringify({ pass, checks }), {
    status: pass ? 200 : 500, headers: { 'content-type': 'application/json' },
  });
};
