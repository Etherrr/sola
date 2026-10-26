'use client';
import Link from 'next/link';
import { useNativeSession } from '../auth-v2/native-session';

/** Signed-in native users who open the legacy Track list are pointed at their real
 *  address book on /account (the Portfolio tab's destination) - the legacy list below
 *  is a separate, older store. Point them at the real book without reading it here.
 *  Renders nothing while checking, when native sign-in is off, or when signed out. */
export function AccountBookPointer() {
  const native = useNativeSession();
  if (native.kind !== 'ok') return null;
  return (
    <p className="notice">
      Signed in as {native.displayLabel} - manage your current account in{' '}
      <Link href="/account">Addresses &amp; Wallets</Link>.
    </p>
  );
}
