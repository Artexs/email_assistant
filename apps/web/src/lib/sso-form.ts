import type { TextKey } from "../i18n";

// The state of the company sign-in block (F119 stage 12). `focus` is a request for the component: it moves the focus once,
// then the component forgets it. `focusSeq` makes two equal requests in a row different.
export interface SsoFormState {
  open: boolean;
  email: string;
  pending: boolean;
  error: TextKey | null;
  focus: "email" | "button" | null;
  focusSeq: number;
}

export type SsoFormAction =
  | { type: "open" }
  | { type: "back" }
  | { type: "email"; value: string }
  | { type: "invalid"; key: TextKey }
  | { type: "start" }
  | { type: "failed"; key: TextKey }
  // The page came back from the browser cache (Back after the redirect): the request is over.
  | { type: "restored" };

export const ssoFormStart: SsoFormState = {
  open: false,
  email: "",
  pending: false,
  error: null,
  focus: null,
  focusSeq: 0,
};

export function ssoFormReducer(state: SsoFormState, action: SsoFormAction): SsoFormState {
  switch (action.type) {
    case "open":
      return { ...state, open: true, focus: "email", focusSeq: state.focusSeq + 1 };
    case "back":
      // The form goes away: the focus returns to the button that opened it, not to the page body.
      return { ...state, open: false, error: null, pending: false, focus: "button", focusSeq: state.focusSeq + 1 };
    case "email":
      return { ...state, email: action.value };
    case "invalid":
      return { ...state, error: action.key };
    case "start":
      return { ...state, error: null, pending: true };
    case "failed":
      return { ...state, error: action.key, pending: false };
    case "restored":
      return state.pending ? { ...state, pending: false } : state;
  }
}
