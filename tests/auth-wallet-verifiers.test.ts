import { describe, it, expect } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  buildSiweMessage, parseSiweMessage, verifySiweMessage, toEip55, isValidEvmAddress, personalSignDigest,
} from '../server/auth/siwe';
import {
  buildSiwsMessage, verifySiwsMessage, isValidSolanaAddress, base58Decode,
} from '../server/auth/siws';

const NOW = new Date('2026-10-25T15:00:00.000Z');
const EXP = '2026-10-25T15:10:00.000Z';
const IAT = '2026-10-25T15:00:00.000Z';

// Deterministic test keys (never used anywhere else).
const evmPriv = secp256k1.utils.randomPrivateKey();
const evmAddress = (() => {
  const pub = secp256k1.getPublicKey(evmPriv, false).slice(1);
  return toEip55('0x' + [...keccak_256(pub)].slice(-20).map((b) => b.toString(16).padStart(2, '0')).join(''));
})();
const solPriv = ed25519.utils.randomPrivateKey();
const solPub = ed25519.getPublicKey(solPriv);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58Encode = (bytes: Uint8Array): string => {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
};
const solAddress = base58Encode(solPub);

const signSiwe = (message: string, priv: Uint8Array): string => {
  const sig = secp256k1.sign(personalSignDigest(message), priv);
  const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return '0x' + hex(sig.toCompactRawBytes()) + (sig.recovery! + 27).toString(16).padStart(2, '0');
};

const siweExpected = { domain: 'preview.solacapitalpartners.com', uri: 'https://preview.solacapitalpartners.com/signin', nonce: 'NONCE123', chainId: 1, address: evmAddress };
const siweMsg = () => buildSiweMessage({ domain: siweExpected.domain, address: evmAddress, uri: siweExpected.uri, chainId: 1, nonce: 'NONCE123', issuedAt: IAT, expirationTime: EXP });

describe('SIWE verifier (EIP-4361 + EIP-191, EOA only)', () => {
  it('accepts a genuinely signed bound message', () => {
    const msg = siweMsg();
    expect(verifySiweMessage(msg, signSiwe(msg, evmPriv), siweExpected, NOW)).toEqual({ ok: true, fields: parseSiweMessage(msg) });
  });
  it('round-trips build/parse and EIP-55 checksums', () => {
    const msg = siweMsg();
    expect(parseSiweMessage(msg)?.address).toBe(evmAddress);
    expect(isValidEvmAddress(evmAddress)).toBe(true);
    expect(isValidEvmAddress(evmAddress.toLowerCase())).toBe(true); // all-lower permitted
    // wrong checksum rejected: known EIP-55 vector with one letter's case flipped
    expect(isValidEvmAddress('0x5AEDA56215b167893e80B4fE645BA6d5Bab767DE')).toBe(true);
    expect(isValidEvmAddress('0x5aEDA56215b167893e80B4fE645BA6d5Bab767DE')).toBe(false);
    expect(isValidEvmAddress('0x123')).toBe(false);
  });
  it('rejects wrong signer, tampered fields, expiry, and format drift', () => {
    const msg = siweMsg();
    const otherPriv = secp256k1.utils.randomPrivateKey();
    expect(verifySiweMessage(msg, signSiwe(msg, otherPriv), siweExpected, NOW)).toEqual({ ok: false, error: 'bad_signature' });
    expect(verifySiweMessage(msg.replace('Chain ID: 1', 'Chain ID: 2'), signSiwe(msg, evmPriv), siweExpected, NOW).ok).toBe(false);
    expect(verifySiweMessage(msg, signSiwe(msg, evmPriv), { ...siweExpected, nonce: 'OTHER' }, NOW)).toEqual({ ok: false, error: 'nonce_mismatch' });
    expect(verifySiweMessage(msg, signSiwe(msg, evmPriv), { ...siweExpected, domain: 'evil.com' }, NOW)).toEqual({ ok: false, error: 'domain_mismatch' });
    expect(verifySiweMessage(msg, signSiwe(msg, evmPriv), { ...siweExpected, chainId: 137 }, NOW)).toEqual({ ok: false, error: 'chain_mismatch' });
    expect(verifySiweMessage(msg, signSiwe(msg, evmPriv), siweExpected, new Date('2026-10-25T15:11:00.000Z'))).toEqual({ ok: false, error: 'expired' });
    expect(verifySiweMessage(msg + '\nExtra: 1', signSiwe(msg, evmPriv), siweExpected, NOW)).toEqual({ ok: false, error: 'bad_message' });
    expect(verifySiweMessage(msg, '0x00', siweExpected, NOW)).toEqual({ ok: false, error: 'bad_signature' });
  });
});

const siwsExpected = { domain: 'preview.solacapitalpartners.com', uri: 'https://preview.solacapitalpartners.com/signin', nonce: 'NONCE456', address: solAddress };
const siwsMsg = () => buildSiwsMessage({ domain: siwsExpected.domain, address: solAddress, uri: siwsExpected.uri, nonce: 'NONCE456', issuedAt: IAT, expirationTime: EXP });

describe('SIWS verifier (single bound format, ed25519, case-sensitive address)', () => {
  it('accepts a genuinely signed bound message', () => {
    const msg = siwsMsg();
    const sig = ed25519.sign(new TextEncoder().encode(msg), solPriv);
    expect(verifySiwsMessage(msg, sig, siwsExpected, NOW)).toEqual({ ok: true, fields: { domain: siwsExpected.domain, address: solAddress, uri: siwsExpected.uri, nonce: 'NONCE456', issuedAt: IAT, expirationTime: EXP } });
  });
  it('base58 round-trip and address validation', () => {
    expect(base58Decode(solAddress)).toEqual(solPub);
    expect(isValidSolanaAddress(solAddress)).toBe(true);
    expect(isValidSolanaAddress('0OIl')).toBe(false); // invalid base58 alphabet
    expect(isValidSolanaAddress('11')).toBe(false);
  });
  it('rejects case-flipped Solana address (base58 is case-sensitive)', () => {
    const msg = siwsMsg();
    const sig = ed25519.sign(new TextEncoder().encode(msg), solPriv);
    const flipped = solAddress.split('').map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
    expect(verifySiwsMessage(msg, sig, { ...siwsExpected, address: flipped }, NOW)).toEqual({ ok: false, error: 'address_mismatch' });
  });
  it('rejects wrong signer, tampered message, expiry, and format drift', () => {
    const msg = siwsMsg();
    const sig = ed25519.sign(new TextEncoder().encode(msg), solPriv);
    expect(verifySiwsMessage(msg, ed25519.sign(new TextEncoder().encode(msg), ed25519.utils.randomPrivateKey()), siwsExpected, NOW)).toEqual({ ok: false, error: 'bad_signature' });
    expect(verifySiwsMessage(msg.replace('Nonce: NONCE456', 'Nonce: NONCE999'), sig, siwsExpected, NOW).ok).toBe(false);
    expect(verifySiwsMessage(msg, sig, { ...siwsExpected, nonce: 'OTHER' }, NOW)).toEqual({ ok: false, error: 'nonce_mismatch' });
    expect(verifySiwsMessage(msg, sig, { ...siwsExpected, domain: 'evil.com' }, NOW)).toEqual({ ok: false, error: 'domain_mismatch' });
    expect(verifySiwsMessage(msg, sig, siwsExpected, new Date('2026-10-25T15:11:00.000Z'))).toEqual({ ok: false, error: 'expired' });
    expect(verifySiwsMessage('{"offchain":"envelope"}', sig, siwsExpected, NOW)).toEqual({ ok: false, error: 'bad_message' }); // format binding
    expect(verifySiwsMessage(msg, new Uint8Array(63), siwsExpected, NOW)).toEqual({ ok: false, error: 'bad_signature' });
  });
});
