import { HOUR_MS, MINUTE_MS } from "@ea/core";
// The demo script: eight steps in the order of the public pages and demo plan, with the caption of each in both languages.
// The cue times come from the recording (the demo record command); this file holds the text and the planned length only.
// A caption names no person, address or host. Each step has a live flag and a caption for each source. On the e2e source a step that is
// not live shows state that the seed holds, and its caption names the day. On the demo source every step is live and no caption names a day.

export interface DemoText {
  en: string;
  pl: string;
}

/** Where the recording takes its data from (`ShotSource.kind` in `shot-source.ts`). */
export type DemoSource = "e2e" | "demo";

export interface DemoStep {
  id: string;
  /** The planned length of the step in the video. */
  seconds: number;
  /** One or two short lines; the lines are separated by a line feed. */
  caption: Record<DemoSource, DemoText>;
  /** true: the recording does the step. false: the step shows state from the seed (see `README.md`, the spike table). */
  live: Record<DemoSource, boolean>;
}

export const DEMO_STEPS: readonly DemoStep[] = [
  {
    id: "connect",
    seconds: 14,
    caption: {
      e2e: {
        en: "Connect a mailbox.\nIt starts in shadow mode: it only watches.",
        pl: "Podłącz skrzynkę.\nZaczyna w trybie cienia: tylko obserwuje.",
      },
      demo: {
        en: "Connect a mailbox.\nIt starts in shadow mode: it only watches.",
        pl: "Podłącz skrzynkę.\nZaczyna w trybie cienia: tylko obserwuje.",
      },
    },
    live: { e2e: true, demo: true },
  },
  {
    id: "shadow",
    seconds: 12,
    caption: {
      e2e: {
        en: "Day 3: three shadow days passed.\nNothing in the mailbox changed.",
        pl: "Dzień 3: minęły trzy dni cienia.\nNic w skrzynce się nie zmieniło.",
      },
      demo: {
        en: "In shadow mode it sorts new mail.\nIt only shows what it would do.",
        pl: "W trybie cienia sortuje nową pocztę.\nTylko pokazuje, co by zrobił.",
      },
    },
    live: { e2e: false, demo: true },
  },
  {
    id: "report",
    seconds: 18,
    caption: {
      e2e: {
        en: "Day 3: what it would have done.\nEvery move is a plan, with its evidence.",
        pl: "Dzień 3: co zrobiłby asystent.\nKażdy ruch to plan, z dowodami.",
      },
      demo: {
        en: "The history check shows what it would have done.\nIt uses your recent mail.",
        pl: "Sprawdzenie historii pokazuje, co by zrobił.\nUżywa Twojej niedawnej poczty.",
      },
    },
    live: { e2e: false, demo: true },
  },
  {
    id: "recommended",
    seconds: 14,
    caption: {
      e2e: {
        en: "Turn on recommended.\nOnly categories that passed the check switch on.",
        pl: "Włącz zalecane.\nWłączają się tylko kategorie, które przeszły sprawdzenie.",
      },
      demo: {
        en: "Turn on recommended with one tap.\nOnly categories that passed the check switch on.",
        pl: "Włącz zalecane jednym dotknięciem.\nWłączają się tylko kategorie, które przeszły sprawdzenie.",
      },
    },
    live: { e2e: true, demo: true },
  },
  {
    id: "urgent",
    seconds: 16,
    caption: {
      e2e: {
        en: "Day 5: an urgent mail arrives.\nThe notice reaches Telegram at once.",
        pl: "Dzień 5: przychodzi pilny mail.\nPowiadomienie od razu trafia do Telegrama.",
      },
      demo: {
        en: "An urgent mail arrives.\nA short notice goes to Telegram.",
        pl: "Przychodzi pilny mail.\nKrótkie powiadomienie trafia do Telegrama.",
      },
    },
    live: { e2e: false, demo: true },
  },
  {
    id: "approval",
    seconds: 16,
    caption: {
      e2e: {
        en: "A reply waits for approval.\nEdit the text in the panel, then approve.",
        pl: "Odpowiedź czeka na zatwierdzenie.\nPopraw tekst w panelu i zatwierdź.",
      },
      demo: {
        en: "Nothing is sent without you.\nEdit the text in the panel, then approve.",
        pl: "Nic nie wychodzi bez Ciebie.\nPopraw tekst w panelu i zatwierdź.",
      },
    },
    live: { e2e: true, demo: true },
  },
  {
    id: "delegation",
    seconds: 14,
    caption: {
      e2e: {
        en: "A task goes to a delegate.\nThe assistant sends the chaser.",
        pl: "Zadanie trafia do osoby delegowanej.\nAsystent wysyła ponaglenie.",
      },
      demo: {
        en: "A task goes to a delegate.\nThe assistant reminds that person.",
        pl: "Zadanie trafia do osoby delegowanej.\nAsystent przypomina tej osobie.",
      },
    },
    live: { e2e: true, demo: true },
  },
  {
    id: "undo",
    seconds: 12,
    caption: {
      e2e: {
        en: "Undo an automatic move.\nThe mail returns to the inbox.",
        pl: "Cofnij automatyczne przeniesienie.\nMail wraca do skrzynki odbiorczej.",
      },
      demo: {
        en: "Every change has Undo.\nThe mail returns to the inbox.",
        pl: "Każda zmiana ma Cofnij.\nMail wraca do skrzynki odbiorczej.",
      },
    },
    live: { e2e: true, demo: true },
  },
];

/** One step as one source shows it: its own flag and caption. */
export function stepView(
  step: DemoStep,
  source: DemoSource
): { id: string; seconds: number; live: boolean; caption: DemoText } {
  return { id: step.id, seconds: step.seconds, live: step.live[source], caption: step.caption[source] };
}

export interface DemoCue {
  stepId: string;
  startMs: number;
  endMs: number;
}

// 12345 ms → 00:00:12.345
function vttTime(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((ms % MINUTE_MS) / 1000);
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(ms % 1000, 3)}`;
}

// The WebVTT file of one language and one source. The cue order is the input order. A bad cue throws: a caption file that silently drops or
// reorders a cue would show the wrong text under a step.
export function toVtt(cues: readonly DemoCue[], lang: keyof DemoText, source: DemoSource): string {
  const blocks = cues.map((cue) => {
    const step = DEMO_STEPS.find((candidate) => candidate.id === cue.stepId);
    if (!step) throw new Error(`vtt_unknown_step ${cue.stepId}`);
    if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs) || cue.startMs < 0 || cue.endMs < 0) {
      throw new Error(`vtt_bad_time ${cue.stepId}`);
    }
    if (cue.endMs <= cue.startMs) throw new Error(`vtt_empty_cue ${cue.stepId}`);
    return `${vttTime(cue.startMs)} --> ${vttTime(cue.endMs)}\n${stepView(step, source).caption[lang]}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}
