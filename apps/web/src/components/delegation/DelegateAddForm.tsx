import type { Delegate } from "@ea/core/web";
import { useRef, useState, type FormEvent, type RefObject } from "react";

import { UserPlus } from "lucide-react";

import { t, type TextKey } from "../../i18n";
import { postDelegate } from "../../lib/delegates-api";
import { addOutcome, checkAdd, FIELD_LIMITS, type DelegateField } from "../../lib/delegates-form";
import { singleFlight } from "../../lib/single-flight";
import { SectionCard } from "../patterns/SectionCard";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { TextField } from "./TextField";

export interface DelegateAddFormProps {
  // The server made the delegate: the page shows the new list and says so.
  onAdded(delegate: Delegate): void;
}

interface Problem {
  field: DelegateField;
  key: TextKey;
}

// The owner adds a delegate (name, address, tags). The form checks the limits of the service first; the answers 409 `exists` and 400
// `mailbox_address` show under the address field. After an error the cursor goes to the field that the text names; after an add it goes
// to Name, ready for the next one. The button stays on while the request runs (a disabled button loses the focus); one request at a time.
export function DelegateAddForm({ onAdded }: DelegateAddFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [failure, setFailure] = useState<TextKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [flight] = useState(singleFlight);
  const refs: Record<DelegateField, RefObject<HTMLInputElement | null>> = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    tags: useRef<HTMLInputElement>(null),
  };

  const show = (next: Problem) => {
    setProblem(next);
    refs[next.field].current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void flight(async () => {
      setFailure(null);
      const check = checkAdd({ name, email, tags });
      if (!check.ok) {
        show({ field: check.field, key: check.key });
        return;
      }
      setProblem(null);
      setBusy(true);
      try {
        const delegate = await postDelegate(check.body);
        setName("");
        setEmail("");
        setTags("");
        refs.name.current?.focus();
        onAdded(delegate);
      } catch (error) {
        const outcome = addOutcome(error);
        if (outcome.kind === "field") show({ field: outcome.field, key: outcome.key });
        else if (outcome.kind === "error") setFailure(outcome.key);
      } finally {
        setBusy(false);
      }
    });
  };

  const errorOf = (field: DelegateField): string | null =>
    problem?.field === field ? t(problem.key, FIELD_LIMITS) : null;

  return (
    <SectionCard icon={UserPlus} title={t("dlg_add_title")} data-card="add-delegate" className="max-w-3xl">
      <form className="flex flex-col gap-4" noValidate aria-busy={busy} onSubmit={submit}>
        <TextField
          id="delegate-name"
          label={t("dlg_name")}
          value={name}
          error={errorOf("name")}
          inputRef={refs.name}
          onChange={(value) => {
            setName(value);
            if (problem?.field === "name") setProblem(null);
          }}
        />
        <TextField
          id="delegate-email"
          label={t("dlg_email")}
          type="email"
          value={email}
          error={errorOf("email")}
          inputRef={refs.email}
          onChange={(value) => {
            setEmail(value);
            if (problem?.field === "email") setProblem(null);
          }}
        />
        <TextField
          id="delegate-tags"
          label={t("dlg_tags")}
          help={t("dlg_tags_help")}
          value={tags}
          error={errorOf("tags")}
          inputRef={refs.tags}
          onChange={(value) => {
            setTags(value);
            if (problem?.field === "tags") setProblem(null);
          }}
        />
        {failure !== null && (
          <Alert variant="destructive">
            <AlertDescription>{t(failure)}</AlertDescription>
          </Alert>
        )}
        <div>
          <Button type="submit">{t("dlg_add")}</Button>
        </div>
      </form>
    </SectionCard>
  );
}
