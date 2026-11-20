import { useId, useState } from "react";

import { t, tp, type TextKey } from "../../i18n";
import { errorText } from "../../lib/errors";
import { suggestStyle, type SuggestAnswer, type SuggestButton } from "../../lib/style-suggest";
import { Button } from "../ui/button";

// `running`: the call is open. `shown`: the answer, a suggestion or a note. `failed`: the call itself failed (a text key).
export type SuggestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "shown"; answer: SuggestAnswer }
  | { kind: "failed"; key: TextKey };

interface ViewProps {
  button: Exclude<SuggestButton, { kind: "hidden" }>;
  state: SuggestState;
  onAsk(): void;
  onUse(text: string): void;
  onDiscard(): void;
}

// The button, its note and the answer. A suggestion is text from a model: it shows as plain text, never as markup.
export function StyleSuggestView({ button, state, onAsk, onUse, onDiscard }: ViewProps) {
  const ids = useId();
  const answer = state.kind === "shown" ? state.answer : null;
  return (
    <div className="flex flex-col gap-2" data-card-part="style-suggest">
      {button.kind === "off" ? (
        <p className="text-sm text-muted-foreground">{t(button.key)}</p>
      ) : (
        <div className="flex flex-col items-start gap-1.5">
          <Button
            type="button"
            variant="outline"
            disabled={state.kind === "running"}
            aria-describedby={`${ids}-help`}
            onClick={onAsk}
          >
            {t("rs_suggest_button")}
          </Button>
          <p id={`${ids}-help`} className="text-sm text-muted-foreground">
            {t("rs_suggest_note")}
          </p>
        </div>
      )}
      <div aria-live="polite" data-suggest={state.kind}>
        {state.kind === "running" && <p className="text-sm text-muted-foreground">{t("rs_suggest_running")}</p>}
        {state.kind === "failed" && (
          <p role="alert" className="text-sm text-destructive">
            {t(state.key)}
          </p>
        )}
        {answer?.kind === "note" && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(answer.key, { count: answer.count ?? 0 })}
          </p>
        )}
        {answer?.kind === "suggestion" && (
          <div className="flex flex-col gap-1.5 rounded-md border p-3">
            <p className="text-sm font-medium">{tp("rs_suggest_result", answer.count)}</p>
            <p data-suggest-text="" className="whitespace-pre-wrap text-sm">
              {answer.text}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => onUse(answer.text)}>
                {t("rs_suggest_use")}
              </Button>
              <Button type="button" variant="outline" onClick={onDiscard}>
                {t("rs_suggest_discard")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  mailboxId: string;
  button: Exclude<SuggestButton, { kind: "hidden" }>;
  // "Use this text": the card puts the text in the writing style field. Nothing is saved until Save.
  onUse(text: string): void;
}

// One call at a time; "Use this text" and "Discard" close the box. The suggestion is never kept.
export function StyleSuggest({ mailboxId, button, onUse }: Props) {
  const [state, setState] = useState<SuggestState>({ kind: "idle" });

  const ask = async () => {
    setState({ kind: "running" });
    try {
      setState({ kind: "shown", answer: await suggestStyle(mailboxId) });
    } catch (failure) {
      setState({ kind: "failed", key: errorText(failure) });
    }
  };

  return (
    <StyleSuggestView
      button={button}
      state={state}
      onAsk={() => void ask()}
      onUse={(text) => {
        setState({ kind: "idle" });
        onUse(text);
      }}
      onDiscard={() => setState({ kind: "idle" })}
    />
  );
}
