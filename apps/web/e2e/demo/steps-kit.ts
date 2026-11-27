import type { Page } from "@playwright/test";

/** What the step sets of the recording share: the recorded page, the sign-in switch and the runner of one step. */
export interface StepKit {
  page: Page;
  /** Switches the page to the session of one owner of the sign-ins done before the recording. */
  become(name: "main" | "trust" | "approvals" | "delegations"): Promise<void>;
  /** Runs one step: `act` does the visible work; the step lasts at least its planned seconds and passes the public-content check. */
  step(id: string, act: () => Promise<void>): Promise<void>;
}
