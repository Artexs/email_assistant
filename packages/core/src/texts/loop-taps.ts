import type { UserLocale } from "../tenancy";

// The buttons, the answers and the status marks of the taps on loop lines and of the Delegate button (open loops, F116 stage 19).
// An answer is a toast: it must fit the Telegram answer limit (200 characters). The fixed texts never hold a loop text.
export interface LoopTapTexts {
  buttons: {
    draft: string;
    later: string;
    done: string;
    drop: string;
    reopen: string;
    // The button of a mail row of the digest: the row number. The urgent notice has one mail and uses the word.
    delegateRow: (n: number) => string;
    delegate: string;
  };
  // The mark that replaces the buttons of a tapped line.
  marks: { done: string; later: string; drop: string; reopen: string };
  ownerOnly: string;
  notFound: string;
  draft: {
    planned: string;
    wouldDraft: string;
    waiting: string;
    limitReached: string;
    tooSoon: string;
    closed: string;
    suspicious: string;
    draftsOff: string;
    featureOff: string;
  };
  later: { ok: (date: string) => string; limitReached: string; closed: string; notAllowed: string };
  done: { ok: string; already: string };
  drop: { ok: string; already: string };
  reopen: { ok: string; already: string; notAllowed: string };
  featureOff: string;
  delegate: {
    pickerTitle: string;
    // The line under the delegates of the picker when more exist. `url` is the panel page of the delegates, or null.
    more: (url: string | null) => string;
    noDelegates: string;
    planned: string;
    exists: string;
    delegateInactive: string;
    notDelegable: string;
    draftsOff: string;
    featureOff: string;
  };
}

export const loopTapTexts = {
  en: {
    buttons: {
      draft: "📝 Draft follow-up",
      later: "⏰ Later",
      done: "✓ Done",
      drop: "✖️ Drop",
      reopen: "↩️ Reopen",
      delegateRow: (n) => `👥 ${n}`,
      delegate: "👥 Delegate",
    },
    marks: { done: "✓", later: "⏰", drop: "✖️", reopen: "↩️" },
    ownerOnly: "Only an owner can do this.",
    notFound: "This item is not in your account.",
    draft: {
      planned: "Follow-up drafted. Check the card.",
      wouldDraft: "Shadow mode: no draft.",
      waiting: "A follow-up already waits for your approval.",
      limitReached: "Two follow-ups were drafted already: no more.",
      tooSoon: "It is too early for a follow-up.",
      closed: "This loop is closed.",
      suspicious: "This thread looks suspicious: no follow-up.",
      draftsOff: "Drafts are off for this mailbox.",
      featureOff: "Open loops are off.",
    },
    later: {
      ok: (date) => `Moved to ${date}.`,
      limitReached: "This loop was moved 3 times already.",
      closed: "This loop is closed.",
      notAllowed: "A promise cannot be moved.",
    },
    done: { ok: "Done.", already: "This loop is closed already." },
    drop: { ok: "Dropped.", already: "This loop is closed already." },
    reopen: { ok: "Reopened.", already: "This loop is open already.", notAllowed: "This loop cannot be reopened." },
    featureOff: "Open loops are off.",
    delegate: {
      pickerTitle: "Delegate to:",
      more: (url) => (url === null ? "More delegates in the panel" : `More delegates in the panel: ${url}`),
      noDelegates: "No active delegate.",
      planned: "Delegation drafted. Check the card.",
      exists: "This mail already has a delegation.",
      delegateInactive: "This delegate is not active any more.",
      notDelegable: "This mail cannot be delegated.",
      draftsOff: "Drafts are off for this mailbox.",
      featureOff: "The Delegate button is off.",
    },
  },
  pl: {
    buttons: {
      draft: "📝 Przypomnienie",
      later: "⏰ Później",
      done: "✓ Gotowe",
      drop: "✖️ Porzuć",
      reopen: "↩️ Otwórz ponownie",
      delegateRow: (n) => `👥 ${n}`,
      delegate: "👥 Zleć",
    },
    marks: { done: "✓", later: "⏰", drop: "✖️", reopen: "↩️" },
    ownerOnly: "Tylko właściciel może to zrobić.",
    notFound: "Tej pozycji nie ma na Twoim koncie.",
    draft: {
      planned: "Przypomnienie gotowe. Sprawdź kartę.",
      wouldDraft: "Tryb cieniowy: bez szkicu.",
      waiting: "Przypomnienie już czeka na Twoje zatwierdzenie.",
      limitReached: "Dwa przypomnienia już przygotowano: więcej nie będzie.",
      tooSoon: "Na przypomnienie jest jeszcze za wcześnie.",
      closed: "Ta sprawa jest zamknięta.",
      suspicious: "Ten wątek wygląda podejrzanie: bez przypomnienia.",
      draftsOff: "Szkice są wyłączone dla tej skrzynki.",
      featureOff: "Otwarte sprawy są wyłączone.",
    },
    later: {
      ok: (date) => `Przesunięto na ${date}.`,
      limitReached: "Tę sprawę przesunięto już 3 razy.",
      closed: "Ta sprawa jest zamknięta.",
      notAllowed: "Obietnicy nie można przesunąć.",
    },
    done: { ok: "Gotowe.", already: "Ta sprawa jest już zamknięta." },
    drop: { ok: "Porzucono.", already: "Ta sprawa jest już zamknięta." },
    reopen: {
      ok: "Otwarto ponownie.",
      already: "Ta sprawa jest już otwarta.",
      notAllowed: "Tej sprawy nie można otworzyć ponownie.",
    },
    featureOff: "Otwarte sprawy są wyłączone.",
    delegate: {
      pickerTitle: "Zleć osobie:",
      more: (url) => (url === null ? "Więcej osób w panelu" : `Więcej osób w panelu: ${url}`),
      noDelegates: "Brak aktywnej osoby do zleceń.",
      planned: "Zlecenie gotowe. Sprawdź kartę.",
      exists: "Ta wiadomość ma już zlecenie.",
      delegateInactive: "Ta osoba nie jest już aktywna.",
      notDelegable: "Tej wiadomości nie można zlecić.",
      draftsOff: "Szkice są wyłączone dla tej skrzynki.",
      featureOff: "Przycisk zlecania jest wyłączony.",
    },
  },
} satisfies Record<UserLocale, LoopTapTexts>;
