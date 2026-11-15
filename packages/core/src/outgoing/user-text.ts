// Text that a user types for an outgoing mail (a panel edit of a draft). It is the user's own text:
// it gets no untrusted marker. It loses control and bidi characters, so it cannot hide a header or a reversed line.

export const EDIT_SUBJECT_MAX = 200;
export const EDIT_BODY_MAX = 3000;

// C0 controls except \n and \t, DEL, C1 controls.
// eslint-disable-next-line no-control-regex -- the point is to remove them
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const BIDI = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;

export function cleanUserText(text: string, opts: { oneLine: boolean }): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(BIDI, "")
    .split("\n")
    .map((line) => line.trimEnd());
  const clean = lines.join("\n").trim();
  return opts.oneLine ? clean.replace(/\s+/g, " ") : clean;
}
