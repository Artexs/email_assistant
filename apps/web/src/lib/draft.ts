// A form draft under polling: the server value moves in only while the user has not typed.
export interface Draft<T> {
  server: T;
  value: T;
}

// The values are strings, string arrays or null, so JSON text is a fair equality.
function same<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function startDraft<T>(server: T): Draft<T> {
  return { server, value: server };
}

export function nextDraft<T>(draft: Draft<T>, server: T): Draft<T> {
  if (same(draft.value, draft.server)) return { server, value: server };
  return { server, value: draft.value };
}

export function isDirty<T>(draft: Draft<T>): boolean {
  return !same(draft.value, draft.server);
}
