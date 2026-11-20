import { STYLE_FORM_LINE_MAX, styleAddressForms, styleLengths, type StyleForm } from "@ea/core/web";
import { useState } from "react";

import { t, type TextKey } from "../../i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const selectClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

const addressTexts: Record<StyleForm["address"], TextKey> = {
  formal: "rs_address_formal",
  first_name: "rs_address_first_name",
  mirror: "rs_address_mirror",
};
const lengthTexts: Record<StyleForm["length"], TextKey> = {
  short: "rs_length_short",
  normal: "rs_length_normal",
};

const START_FORM: StyleForm = { address: "formal", greeting: "", signOff: "", length: "normal" };

interface Props {
  // The id prefix of the card: the field ids stay as they were when the form was part of the card.
  idPrefix: string;
  pending: boolean;
  // "Apply": the card puts the sentences of the form into the writing-style field. The form keeps no other state and saves nothing.
  onApply(form: StyleForm): void;
}

// The guided form of the owner: form of address, greeting, sign-off and length.
export function StyleGuide({ idPrefix, pending, onApply }: Props) {
  const [form, setForm] = useState<StyleForm>(START_FORM);
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t("rs_form_title")}</legend>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-address`}>{t("rs_form_address")}</Label>
        <select
          id={`${idPrefix}-address`}
          value={form.address}
          disabled={pending}
          className={selectClass}
          onChange={(event) => {
            const picked = styleAddressForms.find((item) => item === event.target.value);
            if (picked !== undefined) setForm({ ...form, address: picked });
          }}
        >
          {styleAddressForms.map((item) => (
            <option key={item} value={item}>
              {t(addressTexts[item])}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-greeting`}>{t("rs_form_greeting")}</Label>
        <Input
          id={`${idPrefix}-greeting`}
          value={form.greeting}
          maxLength={STYLE_FORM_LINE_MAX}
          disabled={pending}
          onChange={(event) => setForm({ ...form, greeting: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-sign-off`}>{t("rs_form_sign_off")}</Label>
        <Input
          id={`${idPrefix}-sign-off`}
          value={form.signOff}
          maxLength={STYLE_FORM_LINE_MAX}
          disabled={pending}
          onChange={(event) => setForm({ ...form, signOff: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-length`}>{t("rs_form_length")}</Label>
        <select
          id={`${idPrefix}-length`}
          value={form.length}
          disabled={pending}
          className={selectClass}
          onChange={(event) => {
            const picked = styleLengths.find((item) => item === event.target.value);
            if (picked !== undefined) setForm({ ...form, length: picked });
          }}
        >
          {styleLengths.map((item) => (
            <option key={item} value={item}>
              {t(lengthTexts[item])}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          aria-describedby={`${idPrefix}-apply-help`}
          onClick={() => onApply(form)}
        >
          {t("rs_apply")}
        </Button>
        <p id={`${idPrefix}-apply-help`} className="text-sm text-muted-foreground">
          {t("rs_apply_help")}
        </p>
      </div>
    </fieldset>
  );
}
