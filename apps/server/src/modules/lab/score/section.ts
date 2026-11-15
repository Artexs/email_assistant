import type { LabCorpus } from "../corpus";
import type { LabEvent, LabRun } from "../state";

// What every section of the second half of the report reads besides the DB: the run, its events, the corpus, the run
// mailbox, the scoring time and the run window. A section holds counts and ids, never text.
export interface SectionScope {
  run: LabRun;
  events: readonly LabEvent[];
  corpus: LabCorpus;
  mailboxId: string;
  now: Date;
  // [plan start 00:00 Warsaw, `tailEndsAt`): the window of every reader of the sections.
  window: { start: Date; end: Date };
}
