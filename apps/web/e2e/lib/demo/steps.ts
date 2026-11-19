// The demo script: eight steps in the order of the public pages and demo plan, with the caption of each in both languages.
// The cue times come from the recording (the demo record command); this file holds the text and the planned length only.
// A caption names no person, address or host. A step that is not live shows state that the seed holds, and its caption names the day.

export interface DemoText {
  en: string;
  pl: string;
}

export interface DemoStep {
  id: string;
  /** The planned length of the step in the video. */
  seconds: number;
  /** One or two short lines; the lines are separated by a line feed. */
  caption: DemoText;
  /** true: the recording does the step. false: the step shows state from the seed (see `README.md`, the spike table). */
  live: boolean;
}

export const DEMO_STEPS: readonly DemoStep[] = [
  {
    id: "connect",
    seconds: 14,
    caption: {
      en: "Connect a mailbox.\nIt starts in shadow mode: it only watches.",
      pl: "Podłącz skrzynkę.\nZaczyna w trybie cienia: tylko obserwuje.",
    },
    live: true,
  },
  {
    id: "shadow",
    seconds: 12,
    caption: {
      en: "Day 3: three shadow days passed.\nNothing in the mailbox changed.",
      pl: "Dzień 3: minęły trzy dni cienia.\nNic w skrzynce się nie zmieniło.",
    },
    live: false,
  },
  {
    id: "report",
    seconds: 18,
    caption: {
      en: "Day 3: what I would have done.\nEvery move is a plan, with its evidence.",
      pl: "Dzień 3: co bym zrobił.\nKażdy ruch to plan, z dowodami.",
    },
    live: false,
  },
  {
    id: "recommended",
    seconds: 14,
    caption: {
      en: "Turn on recommended.\nOnly categories that passed the check switch on.",
      pl: "Włącz zalecane.\nWłączają się tylko kategorie, które przeszły sprawdzenie.",
    },
    live: true,
  },
  {
    id: "urgent",
    seconds: 16,
    caption: {
      en: "Day 5: an urgent mail arrives.\nThe notice reaches Telegram at once.",
      pl: "Dzień 5: przychodzi pilny mail.\nPowiadomienie od razu trafia do Telegrama.",
    },
    live: false,
  },
  {
    id: "approval",
    seconds: 16,
    caption: {
      en: "A reply waits for approval.\nEdit the text in the panel, then approve.",
      pl: "Odpowiedź czeka na zatwierdzenie.\nPopraw tekst w panelu i zatwierdź.",
    },
    live: true,
  },
  {
    id: "delegation",
    seconds: 14,
    caption: {
      en: "A task goes to a delegate.\nThe assistant sends the chaser.",
      pl: "Zadanie trafia do osoby delegowanej.\nAsystent wysyła ponaglenie.",
    },
    live: true,
  },
  {
    id: "undo",
    seconds: 12,
    caption: {
      en: "Undo an automatic move.\nThe mail returns to the inbox.",
      pl: "Cofnij automatyczne przeniesienie.\nMail wraca do skrzynki odbiorczej.",
    },
    live: true,
  },
];

export interface DemoCue {
  stepId: string;
  startMs: number;
  endMs: number;
}

// 12345 ms → 00:00:12.345
function vttTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(ms % 1000, 3)}`;
}

// The WebVTT file of one language. The cue order is the input order. A bad cue throws: a caption file that silently drops or
// reorders a cue would show the wrong text under a step.
export function toVtt(cues: readonly DemoCue[], lang: keyof DemoText): string {
  const blocks = cues.map((cue) => {
    const step = DEMO_STEPS.find((candidate) => candidate.id === cue.stepId);
    if (!step) throw new Error(`vtt_unknown_step ${cue.stepId}`);
    if (!Number.isInteger(cue.startMs) || !Number.isInteger(cue.endMs) || cue.startMs < 0 || cue.endMs < 0) {
      throw new Error(`vtt_bad_time ${cue.stepId}`);
    }
    if (cue.endMs <= cue.startMs) throw new Error(`vtt_empty_cue ${cue.stepId}`);
    return `${vttTime(cue.startMs)} --> ${vttTime(cue.endMs)}\n${step.caption[lang]}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}
