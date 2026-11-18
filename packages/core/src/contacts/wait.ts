// Per-contact follow-up wait (F120 D12). Pure: the caller passes the stored median and the sample count.
const MIN_SAMPLES = 5;
const WAIT_FACTOR = 1.5;
const MIN_WAIT_DAYS = 1;
const MAX_WAIT_DAYS = 7;
const MIN_USUAL_DAYS = 1;
const MAX_USUAL_DAYS = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 1.5 times the contact's median reply time, rounded up to whole days, 1 to 7. Null below 5 samples or without a median.
export function contactWaitDays(medianTheirReplyHours: number | null, samples: number): number | null {
  if (medianTheirReplyHours === null || samples < MIN_SAMPLES) return null;
  return clamp(Math.ceil((WAIT_FACTOR * medianTheirReplyHours) / 24), MIN_WAIT_DAYS, MAX_WAIT_DAYS);
}

// The "usual reply time" the loop line shows: the median in whole days (half rounds up), 1 to 60.
export function usualReplyDays(medianHours: number): number {
  return clamp(Math.round(medianHours / 24), MIN_USUAL_DAYS, MAX_USUAL_DAYS);
}
