'use client';
import Link from 'next/link';
import { useNativeSession } from '../auth-v2/native-session';

/** Signed-in native users land here from the door or the Overview nav, but their
 *  address book is the native one on /account - the legacy Track list below is a
 *  separate, older store. Point them at the real book without reading it here.
 *  Renders nothing while checking, when native sign-in is off, or when signed out. */
export function AccountBookPointer() {
  const native = useNativeSession();
  if (native.kind !== 'ok') return null;
  return (
    <p className="notice">
      Signed in as {native.email} - your address book and its combined view live on{' '}
      <Link href="/account">Account</Link>. The list below is the separate legacy Track
      list, not your account book.
    </p>
  );
}
