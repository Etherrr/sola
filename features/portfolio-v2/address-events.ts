/** Invalidate mounted readers after confirmed address mutations or reconciliation. */
export const ADDRESSES_CHANGED_EVENT = 'sola:addresses-changed';
export const announceAddressesChanged = () =>
  window.dispatchEvent(new CustomEvent(ADDRESSES_CHANGED_EVENT));
