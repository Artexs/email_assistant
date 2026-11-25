import { useEffect, useId, useRef, useState } from "react";

import { t } from "../../i18n";
import { errorText } from "../../lib/errors";
import {
  askSamples,
  sampleFailureKey,
  sampleInProgress,
  messageTone,
  samplesButtonOff,
  followSamples,
  showSamples,
  type SamplesState,
} from "../../lib/reply-samples";
import { FactBox } from "../patterns/FactBox";
import { Button } from "../ui/button";

// Sample drafts on the newest mails that need a reply (the owner, the flag `reply_drafts` on, a password mailbox). One run a day for
// each mailbox. The texts come from a model and show as plain text, never as markup. A sample is not saved in Drafts and cannot be sent.
export function ReplySamples({ mailboxId, blocked }: { mailboxId: string; blocked: boolean }) {
  const ids = useId();
  const [state, setState] = useState<SamplesState>({ kind: "loading" });

  // The card going away ends every wait: the object of this mount is the signal of the polls.
  const signal = useRef({ aborted: false });

  // The run of today stays on the server: a page that loads later shows it (and keeps waiting for a run that is not over).
  useEffect(() => {
    const mine = { aborted: false };
    signal.current = mine;
    if (!blocked) {
      void showSamples(mailboxId, mine, setState).then((found) => {
        if (!found && !mine.aborted) setState({ kind: "idle" });
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
        // The day's run exists already (this tab, another tab or an earlier visit): show it instead of the refusal.
        if (answer.key === "rs_samples_limit" && (await showSamples(mailboxId, signal.current, setState))) return;
        if (!signal.current.aborted) setState({ kind: "message", key: answer.key });
        return;
      }
      if (answer.count === 0) {
        setState({ kind: "message", key: "rs_samples_none" });
        return;
      }
      await followSamples(mailboxId, signal.current, setState);
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
          variant="soft"
          disabled={samplesButtonOff(state)}
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
        {state.kind === "slow" && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("rs_samples_slow")}
          </p>
        )}
        {state.kind === "message" &&
          (messageTone(state.key) === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {t(state.key)}
            </p>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t(state.key)}
            </p>
          ))}
        {state.kind === "shown" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{t("rs_samples_title")}</p>
            {state.items.map((item) => (
              <FactBox key={item.requestId}>
                <div data-sample="" className="flex flex-col gap-1.5">
                  <p className="text-sm font-bold">
                    {t("rs_samples_mail", { subject: item.subject ?? t("rs_samples_no_subject") })}
                  </p>
                  {item.body !== null && !sampleInProgress(item) ? (
                    <p data-sample-body="" className="text-base whitespace-pre-wrap">
                      {item.body}
                    </p>
                  ) : (
                    <p className="text-sm">{t(sampleFailureKey(item))}</p>
                  )}
                </div>
              </FactBox>
            ))}
            <p className="text-sm text-muted-foreground">{t("rs_samples_note")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
