/// <reference types="bun" />
import { DELEGATE_LIST_MAX, type Delegate, type Me } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DelegateAddForm } from "../components/delegation/DelegateAddForm";
import { DelegateList } from "../components/delegation/DelegateList";
import { DelegationSwitch, DelegationTabs } from "../components/delegation/DelegationTabs";
import { TextField } from "../components/delegation/TextField";
import { MeContext } from "../components/shell/MeProvider";
import { setLocaleForTest } from "../i18n";

afterEach(() => setLocaleForTest("en"));

const delegate = (patch: Partial<Delegate> = {}): Delegate => ({
  id: "0190f5a0-0000-7000-8000-0000000000d1",
  name: "Anna Nowak",
  email: "anna@example.com",
  tags: ["finance"],
  active: true,
  createdAt: "2026-11-15T10:00:00.000Z",
  ...patch,
});

// The attribute, not the class names `disabled:` of the styles.
const DISABLED = / disabled=""/;
const noop = () => undefined;
const list = (delegates: Delegate[], canChange: boolean) =>
  renderToStaticMarkup(<DelegateList delegates={delegates} canChange={canChange} onEdit={noop} onToggle={noop} />);

describe("DelegateList", () => {
  test("an owner gets a named Edit button and a named switch per row, with the state as text", () => {
    const html = list(
      [delegate(), delegate({ id: "b", name: "Piotr Lis", email: "piotr@example.com", active: false })],
      true
    );
    expect(html).toContain('aria-label="Edit Anna Nowak"');
    expect(html).toContain('aria-label="Edit Piotr Lis"');
    expect(html).toContain('aria-label="Active: Anna Nowak"');
    expect(html).toContain('aria-label="Active: Piotr Lis"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    // The state is text, not only a colour or a switch position.
    expect(html).toContain(">Active<");
    expect(html).toContain(">Off<");
    expect(html).not.toMatch(DISABLED);
  });

  test("a member sees a card with the initials, the address and the tags, a disabled switch and no Edit button", () => {
    const html = list(
      [delegate({ name: "Tomasz Nowak", email: "tomasz@example.com", tags: ["finance", "it"] })],
      false
    );
    expect(html).toContain(">TN</span>");
    expect(html).toContain("tomasz@example.com");
    const tags = /<ul aria-label="Tags"[^>]*>(.*?)<\/ul>/.exec(html)?.[1] ?? "";
    expect(tags.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Active: Tomasz Nowak"');
    expect(html).toMatch(DISABLED);
    expect(html).not.toContain("Edit");
  });

  test("tags show as a labelled list of badges; no tag shows a word, not an empty list", () => {
    const withTags = list([delegate({ tags: ["finance", "it"] })], true);
    expect(withTags).toContain('<ul aria-label="Tags"');
    expect(withTags).toContain(">finance<");
    expect(withTags).toContain(">it<");
    const none = list([delegate({ tags: [] })], true);
    expect(none).toContain("No tags");
    expect(none).not.toContain('aria-label="Tags"');
  });

  test("an empty list is a heading; an owner who can write also gets the line that points at the form", () => {
    const owner = list([], true);
    expect(owner).toMatch(/<h2[^>]*>There are no delegates yet\.<\/h2>/);
    expect(owner).toContain("Add a delegate with the form above.");
    const member = list([], false);
    expect(member).toMatch(/<h2[^>]*>There are no delegates yet\.<\/h2>/);
    expect(member).not.toContain("Add a delegate with the form above.");
    setLocaleForTest("pl");
    expect(list([], true)).toContain("Nie ma jeszcze wykonawców.");
    expect(list([], true)).toContain("Dodaj osobę formularzem powyżej.");
  });

  test("a list of DELEGATE_LIST_MAX entries says that more may be hidden; a shorter list says nothing", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => delegate({ id: `d${i}`, name: `Person ${i}` }));
    expect(list(many(DELEGATE_LIST_MAX), true)).toContain("Showing the first 200 delegates.");
    expect(list(many(DELEGATE_LIST_MAX - 1), true)).not.toContain("Showing the first");
    setLocaleForTest("pl");
    expect(list(many(DELEGATE_LIST_MAX), true)).toContain("Pokazano pierwszych 200 wykonawców.");
  });

  test("a long name and a long address wrap instead of widening the row", () => {
    const html = list([delegate({ name: "N".repeat(200), email: `${"a".repeat(80)}@example.com` })], true);
    expect(html).toContain("break-words");
    expect(html).toContain("break-all");
  });

  test("the Polish page has the state, the labels and the buttons in Polish", () => {
    setLocaleForTest("pl");
    const html = list([delegate(), delegate({ id: "b", name: "Piotr Lis", active: false, tags: [] })], true);
    expect(html).toContain(">Aktywny<");
    expect(html).toContain(">Wyłączony<");
    expect(html).toContain('aria-label="Edytuj: Anna Nowak"');
    expect(html).toContain('aria-label="Aktywność: Anna Nowak"');
    expect(html).toContain("Brak tagów");
    expect(html).toContain(">Edytuj<");
  });
});

describe("DelegationTabs", () => {
  test("two links; the current page has aria-current and the other has none", () => {
    const html = renderToStaticMarkup(<DelegationTabs current="delegates" />);
    expect(html).toContain('aria-label="Delegation pages"');
    expect(html).toMatch(/<a href="\/delegations"(?![^>]*aria-current)[^>]*>Delegations<\/a>/);
    expect(html).toMatch(/<a href="\/delegates" aria-current="page"[^>]*>Delegates<\/a>/);
    const other = renderToStaticMarkup(<DelegationTabs current="delegations" />);
    expect(other).toMatch(/<a href="\/delegations" aria-current="page"[^>]*>Delegations<\/a>/);
    expect(other).toMatch(/<a href="\/delegates"(?![^>]*aria-current)[^>]*>Delegates<\/a>/);
  });

  test("the Polish names", () => {
    setLocaleForTest("pl");
    const html = renderToStaticMarkup(<DelegationTabs current="delegates" />);
    expect(html).toContain(">Zlecenia<");
    expect(html).toContain(">Wykonawcy<");
  });
});

describe("DelegationSwitch", () => {
  const render = (features: string[]) => {
    const me = { features } as unknown as Me;
    const value = { me, error: null, loading: false, reload: () => undefined };
    return renderToStaticMarkup(
      <MeContext.Provider value={value}>
        <DelegationSwitch current="delegations" />
      </MeContext.Provider>
    );
  };

  test("without the flag delegation_pages it renders nothing", () => {
    expect(render([])).toBe("");
  });

  test("with the flag it renders the nav of two links", () => {
    const html = render(["delegation_pages"]);
    expect(html).toContain('aria-label="Delegation pages"');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toMatch(/<a href="\/delegations" aria-current="page"[^>]*>Delegations<\/a>/);
    expect(html).toMatch(/<a href="\/delegates"(?![^>]*aria-current)[^>]*>Delegates<\/a>/);
  });
});

describe("TextField", () => {
  test("the label is tied to the field; an error is tied too and marks the field invalid", () => {
    const html = renderToStaticMarkup(<TextField id="f" label="Name" value="" error="Bad." help="Hint." />);
    expect(html).toContain("<label");
    expect(html).toContain('for="f"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="f-help f-error"');
    expect(html).toContain('id="f-error"');
  });

  test("no error: the field is not invalid and has no error text", () => {
    const html = renderToStaticMarkup(<TextField id="f" label="Name" value="x" />);
    expect(html).not.toMatch(/ aria-invalid=/);
    expect(html).not.toMatch(/ aria-describedby=/);
  });

  test("a read only field keeps its value and is tied to its note", () => {
    const html = renderToStaticMarkup(
      <TextField id="a" label="E-mail" value="anna@example.com" help="Note." readOnly />
    );
    expect(html).toContain('readOnly=""');
    expect(html).toContain('value="anna@example.com"');
    expect(html).toContain('aria-describedby="a-help"');
  });
});

describe("DelegateAddForm", () => {
  test("three labelled fields, the tag hint and an Add button", () => {
    const html = renderToStaticMarkup(<DelegateAddForm onAdded={noop} />);
    for (const label of ["Name", "E-mail", "Tags"]) expect(html).toContain(`>${label}</label>`);
    expect(html).toContain("Separate the tags with commas");
    expect(html).toContain('type="email"');
    expect(html).toContain(">Add</button>");
    // The button is never disabled: a disabled button drops the keyboard focus while the request runs.
    expect(html).not.toMatch(DISABLED);
  });

  test("Polish labels and button", () => {
    setLocaleForTest("pl");
    const html = renderToStaticMarkup(<DelegateAddForm onAdded={noop} />);
    for (const label of ["Imię i nazwisko", "Adres e-mail", "Tagi"]) expect(html).toContain(`>${label}</label>`);
    expect(html).toContain(">Dodaj</button>");
  });
});
