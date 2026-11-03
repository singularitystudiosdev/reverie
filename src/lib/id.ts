/*
  Message ids. crypto.randomUUID() only exists in secure contexts, and a phone
  testing the dev server over the LAN (plain http) is not one, so fall back to
  a time + random id there.
*/
let counter = 0;

export function makeId(prefix = 'm'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' && window.isSecureContext) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
