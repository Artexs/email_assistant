import { useEffect, useId, useRef, useState } from "react";

import { t, type TextKey } from "../../i18n";
import { errorText } from "../../lib/errors";
import {
  askSamples,
  loadSamples,
  sampleFailureKey,
  sampleInProgress,
  samplesInProgress,
  waitForSamples,
  type SampleItem,
} from "../../lib/reply-samples";
import { Button } from "../ui/button";

// Sample drafts on the newest mails that need a reply (the owner, the flag `reply_drafts` on, a password mailbox). One run a day for
// each mailbox. The texts come from a model and show as plain text, never as markup. A sample is not saved in Drafts and cannot be sent.
type State =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "shown"; items: SampleItem[] }
  | { kind: "message"; key: TextKey };

export function ReplySamples({ mailboxId, blocked }: { mailboxId: string; blocked: boolean }) {
  const ids = useId();
  const [state, setState] = useState<State>({ kind: "loading" });

  // The card going away ends every wait: the object of this mount is the signal of the polls.
  const signal = useRef({ aborted: false });

  // The run of today stays on the server: a page that loads later shows it (and keeps waiting for a run that is not over).
  useEffect(() => {
    const mine = { aborted: false };
    signal.current = mine;
    const finish = async () => {
      const outcome = await waitForSamples(mailboxId, { signal: mine });
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "timeout") {
        setState({ kind: "message", key: "rs_samples_slow" });
        return;
      }
      setState({ kind: "shown", items: outcome.items });
    };
    if (!blocked) {
      void loadSamples(mailboxId)
        .then((found) => {
          if (mine.aborted) return;
          if (found.length === 0) setState({ kind: "idle" });
          else if (samplesInProgress(found)) {
            setState({ kind: "running" });
            void finish();
          } else {
            setState({ kind: "shown", items: found });
          }
        })
        .catch(() => {
          if (!mine.aborted) setState({ kind: "idle" });
        });
    }
    return () => {
      mine.aborted = true;
    };
  }, [mailboxId, blocked]);

  const ask = async () => {
    setState({ kind: "running" });
    try {
      const answer = await askSamples(mailboxId);
      if (answer.kind === "refused") {
        setState({ kind: "message", key: answer.key });
        return;
      }
      if (answer.count === 0) {
        setState({ kind: "message", key: "rs_samples_none" });
        return;
      }
      const outcome = await waitForSamples(mailboxId, { signal: signal.current });
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "timeout") {
        setState({ kind: "message", key: "rs_samples_slow" });
        return;
      }
      setState({ kind: "shown", items: outcome.items });
    } catch (failure) {
      setState({ kind: "message", key: errorText(failure) });
    }
  };

  if (blocked) {
    return <p className="text-sm text-muted-foreground">{t("rs_samples_oauth")}</p>;
  }

  return (
    <div className="flex flex-col gap-2" data-card-part="reply-samples">
      <div className="flex flex-col items-start gap-1.5">
        <Button
          type="button"
          variant="outline"
          disabled={state.kind === "loading" || state.kind === "running" || state.kind === "shown"}
          aria-describedby={`${ids}-help`}
          onClick={() => void ask()}
        >
          {t("rs_samples")}
        </Button>
        <p id={`${ids}-help`} className="text-sm text-muted-foreground">
          {t("rs_samples_help")} {t("rs_samples_note")}
        </p>
      </div>
      <div aria-live="polite" data-samples={state.kind}>
        {state.kind === "running" && <p className="text-sm text-muted-foreground">{t("rs_samples_waiting")}</p>}
        {state.kind === "message" && (
          <p role="alert" className="text-sm text-destructive">
            {t(state.key)}
          </p>
        )}
        {state.kind === "shown" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{t("rs_samples_title")}</p>
            {state.items.map((item) => (
              <div key={item.requestId} data-sample="" className="flex flex-col gap-1.5 rounded-md border p-3">
                <p className="text-sm text-muted-foreground">
                  {t("rs_samples_mail", { subject: item.subject ?? t("rs_samples_no_subject") })}
                </p>
                {item.body !== null && !sampleInProgress(item) ? (
                  <p data-sample-body="" className="whitespace-pre-wrap text-sm">
                    {item.body}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">{t(sampleFailureKey(item))}</p>
                )}
              </div>
            ))}
            <p className="text-sm text-muted-foreground">{t("rs_samples_note")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
