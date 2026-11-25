import { STYLE_FORM_LINE_MAX, styleAddressForms, styleLengths, type StyleForm } from "@ea/core/web";
import { useState } from "react";

import { t, type TextKey } from "../../i18n";
import { Row } from "../patterns/Row";
import { RowList } from "../patterns/RowList";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

// The same box as `Input` (48 px, a 2 px edge), with the native list: a phone opens its own picker.
const selectClass =
  "h-12 w-36 rounded-md border-2 border-input bg-card px-4 text-base outline-none focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 sm:w-56";
const inputClass = "w-36 sm:w-56";

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
    <fieldset className="flex flex-col gap-3 rounded-md border-2 border-input px-4 pt-1 pb-4">
      <legend className="px-1 text-base font-bold">{t("rs_form_title")}</legend>
      <RowList>
        <Row title={t("rs_form_address")} htmlFor={`${idPrefix}-address`}>
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
        </Row>
        <Row title={t("rs_form_greeting")} htmlFor={`${idPrefix}-greeting`}>
          <Input
            id={`${idPrefix}-greeting`}
            className={inputClass}
            value={form.greeting}
            maxLength={STYLE_FORM_LINE_MAX}
            disabled={pending}
            onChange={(event) => setForm({ ...form, greeting: event.target.value })}
          />
        </Row>
        <Row title={t("rs_form_sign_off")} htmlFor={`${idPrefix}-sign-off`}>
          <Input
            id={`${idPrefix}-sign-off`}
            className={inputClass}
            value={form.signOff}
            maxLength={STYLE_FORM_LINE_MAX}
            disabled={pending}
            onChange={(event) => setForm({ ...form, signOff: event.target.value })}
          />
        </Row>
        <Row title={t("rs_form_length")} htmlFor={`${idPrefix}-length`}>
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
        </Row>
      </RowList>
      <div className="flex flex-col items-start gap-1.5">
        <Button
          type="button"
          variant="soft"
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
