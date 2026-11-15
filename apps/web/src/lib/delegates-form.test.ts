import { DELEGATE_NAME_MAX, DELEGATE_TAG_MAX, DELEGATE_TAGS_MAX } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";

import { setLocaleForTest, t } from "../i18n";
import { ApiError } from "./api";
import {
  addOutcome,
  checkAdd,
  checkEdit,
  editChange,
  editStart,
  FIELD_LIMITS,
  patchOutcome,
  splitTags,
  tagsText,
} from "./delegates-form";

afterEach(() => setLocaleForTest("en"));

const delegate = { name: "Anna Nowak", tags: ["finance", "it"] };

describe("splitTags", () => {
  test("splits at commas, trims, writes lower case and drops empty parts", () => {
    expect(splitTags("finance, Budget ,, it")).toEqual(["finance", "budget", "it"]);
  });

  test("an empty or blank field gives no tag", () => {
    expect(splitTags("")).toEqual([]);
    expect(splitTags("  , ,  ")).toEqual([]);
  });

  test("keeps the first of two equal tags, also when only the case differs", () => {
    expect(splitTags("it, IT, finance, it ")).toEqual(["it", "finance"]);
  });

  test("tagsText and splitTags are inverse for a stored list", () => {
    expect(tagsText(["finance", "it"])).toBe("finance, it");
    expect(splitTags(tagsText(["finance", "it"]))).toEqual(["finance", "it"]);
    expect(tagsText([])).toBe("");
  });
});

describe("checkAdd", () => {
  const ok = { name: " Piotr Lis ", email: " piotr@example.com ", tags: "IT" };

  test("a good form gives the trimmed body with the split tags", () => {
    expect(checkAdd(ok)).toEqual({ ok: true, body: { name: "Piotr Lis", email: "piotr@example.com", tags: ["it"] } });
  });

  test("a blank name, a bad address and too many tags name their field, in field order", () => {
    expect(checkAdd({ ...ok, name: "   " })).toEqual({ ok: false, field: "name", key: "dlg_name_error" });
    expect(checkAdd({ ...ok, email: "piotr" })).toEqual({ ok: false, field: "email", key: "dlg_email_error" });
    expect(checkAdd({ ...ok, email: "" })).toEqual({ ok: false, field: "email", key: "dlg_email_error" });
    const many = Array.from({ length: DELEGATE_TAGS_MAX + 1 }, (_, i) => `t${i}`).join(",");
    expect(checkAdd({ ...ok, tags: many })).toEqual({ ok: false, field: "tags", key: "dlg_tags_error" });
    expect(checkAdd({ name: "", email: "x", tags: many })).toEqual({ ok: false, field: "name", key: "dlg_name_error" });
  });

  test("the limits count characters, not code units", () => {
    expect(checkAdd({ ...ok, name: "😀".repeat(DELEGATE_NAME_MAX) }).ok).toBe(true);
    expect(checkAdd({ ...ok, name: "😀".repeat(DELEGATE_NAME_MAX + 1) }).ok).toBe(false);
    expect(checkAdd({ ...ok, tags: "ł".repeat(DELEGATE_TAG_MAX) }).ok).toBe(true);
    expect(checkAdd({ ...ok, tags: "ł".repeat(DELEGATE_TAG_MAX + 1) }).ok).toBe(false);
  });

  test("ten tags pass, equal tags count once", () => {
    const ten = Array.from({ length: DELEGATE_TAGS_MAX }, (_, i) => `t${i}`).join(",");
    expect(checkAdd({ ...ok, tags: ten }).ok).toBe(true);
    expect(checkAdd({ ...ok, tags: `${ten},T0,t1` }).ok).toBe(true);
  });
});

describe("editChange and checkEdit", () => {
  test("the start values are the delegate: nothing changed", () => {
    expect(editChange(delegate, editStart(delegate))).toBeNull();
    expect(checkEdit(delegate, editStart(delegate))).toEqual({ ok: false, unchanged: true });
  });

  test("a change of the name alone, or of the tags alone, sends that field only", () => {
    expect(editChange(delegate, { name: "Anna Nowak-Lis", tags: "finance, it" })).toEqual({ name: "Anna Nowak-Lis" });
    expect(editChange(delegate, { name: " Anna Nowak ", tags: "IT, finance" })).toEqual({ tags: ["it", "finance"] });
    expect(editChange(delegate, { name: "Anna Nowak", tags: "" })).toEqual({ tags: [] });
  });

  test("spaces and case that the service removes are no change", () => {
    expect(editChange(delegate, { name: "  Anna Nowak  ", tags: " finance ,IT" })).toBeNull();
  });

  test("a delegate with no tags and an empty field is no change", () => {
    expect(editChange({ name: "Anna", tags: [] }, { name: "Anna", tags: " , " })).toBeNull();
    expect(editChange({ name: "Anna", tags: [] }, { name: "Anna", tags: "it" })).toEqual({ tags: ["it"] });
  });

  test("a blank name or too many tags name their field before any change check", () => {
    expect(checkEdit(delegate, { name: " ", tags: "finance, it" })).toEqual({
      ok: false,
      unchanged: false,
      field: "name",
      key: "dlg_name_error",
    });
    const many = Array.from({ length: DELEGATE_TAGS_MAX + 1 }, (_, i) => `t${i}`).join(",");
    expect(checkEdit(delegate, { name: "Anna Nowak", tags: many })).toEqual({
      ok: false,
      unchanged: false,
      field: "tags",
      key: "dlg_tags_error",
    });
  });

  test("a good change gives the patch", () => {
    expect(checkEdit(delegate, { name: "Anna Nowak-Lis", tags: "finance, it" })).toEqual({
      ok: true,
      patch: { name: "Anna Nowak-Lis" },
    });
  });
});

const apiError = (status: number, code: string, path?: string) =>
  new ApiError(
    status,
    code,
    undefined,
    path === undefined ? undefined : [{ path, code: "invalid_value", message: "x" }]
  );

describe("addOutcome", () => {
  test("409 exists and 400 mailbox_address show under the address field", () => {
    expect(addOutcome(apiError(409, "exists"))).toEqual({ kind: "field", field: "email", key: "dlg_exists" });
    expect(addOutcome(apiError(400, "mailbox_address"))).toEqual({
      kind: "field",
      field: "email",
      key: "dlg_mailbox_address",
    });
  });

  test("the two answers have their texts in both languages", () => {
    expect(t("dlg_exists")).toBe("This address is already a delegate.");
    expect(t("dlg_mailbox_address")).toBe("This is the address of one of your mailboxes.");
    setLocaleForTest("pl");
    expect(t("dlg_exists")).toBe("Ten adres jest już na liście wykonawców.");
    expect(t("dlg_mailbox_address")).toBe("To jest adres jednej z Twoich skrzynek.");
  });

  test("400 validation shows under the field that the answer names", () => {
    expect(addOutcome(apiError(400, "validation", "name"))).toEqual({
      kind: "field",
      field: "name",
      key: "dlg_name_error",
    });
    expect(addOutcome(apiError(400, "validation", "email"))).toEqual({
      kind: "field",
      field: "email",
      key: "dlg_email_error",
    });
    expect(addOutcome(apiError(400, "validation", "tags"))).toEqual({
      kind: "field",
      field: "tags",
      key: "dlg_tags_error",
    });
  });

  test("a validation answer with no known field, a 403 and a non-API error give the general text", () => {
    expect(addOutcome(apiError(400, "validation"))).toEqual({ kind: "error", key: "error_generic" });
    expect(addOutcome(apiError(400, "validation", "other"))).toEqual({ kind: "error", key: "error_generic" });
    expect(addOutcome(apiError(403, "owner_only"))).toEqual({ kind: "error", key: "owner_only" });
    expect(addOutcome(apiError(403, "org_suspended"))).toEqual({ kind: "error", key: "err_org_suspended" });
    expect(addOutcome(new TypeError("network"))).toEqual({ kind: "error", key: "error_generic" });
  });

  test("the same code on another status is not an `exists` answer", () => {
    expect(addOutcome(apiError(400, "exists"))).toEqual({ kind: "error", key: "error_generic" });
    expect(addOutcome(apiError(409, "mailbox_address"))).toEqual({ kind: "error", key: "error_generic" });
  });
});

describe("patchOutcome", () => {
  test("a 404 says the delegate is gone; validation names name or tags only", () => {
    expect(patchOutcome(apiError(404, "not_found"))).toEqual({ kind: "gone" });
    expect(patchOutcome(apiError(400, "validation", "name"))).toEqual({
      kind: "field",
      field: "name",
      key: "dlg_name_error",
    });
    expect(patchOutcome(apiError(400, "validation", "tags"))).toEqual({
      kind: "field",
      field: "tags",
      key: "dlg_tags_error",
    });
    expect(patchOutcome(apiError(400, "validation", "email"))).toEqual({ kind: "error", key: "error_generic" });
    expect(patchOutcome(apiError(403, "owner_only"))).toEqual({ kind: "error", key: "owner_only" });
  });
});

describe("the texts of the limits", () => {
  test("the limits that the form names are the limits of the service", () => {
    expect(FIELD_LIMITS).toEqual({ max: 100, tags: 10, len: 30 });
  });

  test("the Polish texts use a number form that fits the limits (10 tagów, 30 znaków, od 1 do 100 znaków)", () => {
    setLocaleForTest("pl");
    expect(t("dlg_tags_error", FIELD_LIMITS)).toBe("Użyj najwyżej 10 tagów. Każdy tag ma najwyżej 30 znaków.");
    expect(t("dlg_name_error", FIELD_LIMITS)).toBe("Nazwa musi mieć od 1 do 100 znaków.");
    setLocaleForTest("en");
    expect(t("dlg_tags_error", FIELD_LIMITS)).toBe("Use up to 10 tags. Each tag has up to 30 characters.");
    expect(t("dlg_name_error", FIELD_LIMITS)).toBe("The name needs 1 to 100 characters.");
  });
});
