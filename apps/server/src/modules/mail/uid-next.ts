/**
 * D4: the UIDNEXT of a folder. Interia gives a wrong STATUS value (1) and no SELECT value, so the highest UID + 1 counts too.
 * The largest of the finite inputs; at least 1.
 */
export function resolveUidNext(input: {
  statusUidNext: number | undefined;
  selectUidNext: number | undefined;
  highestUid: number;
}): number {
  const values = [input.statusUidNext, input.selectUidNext, input.highestUid + 1].filter(
    (value): value is number => value !== undefined && Number.isFinite(value)
  );
  return Math.max(1, ...values);
}
