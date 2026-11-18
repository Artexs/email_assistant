// Seeded random accounts and ordinary Polish business sentences for the tests of the account view.
// Tests only: no import outside this folder.

export type Rnd = () => number;

/** A small seeded generator (mulberry32): the same seed gives the same numbers. */
export function prng(seed: number): Rnd {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rnd, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
const int = (r: Rnd, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const digits = (r: Rnd, n: number): string => Array.from({ length: n }, () => String(int(r, 0, 9))).join("");
const letters = (r: Rnd, n: number): string =>
  Array.from({ length: n }, () => String.fromCharCode(65 + int(r, 0, 25))).join("");
// Real account numbers are mostly digits: 15 % of the characters are letters.
const alnum = (r: Rnd, n: number): string =>
  Array.from({ length: n }, () => (r() < 0.85 ? digits(r, 1) : letters(r, 1))).join("");

export const COUNTRIES = ["PL", "NL", "DE", "GB", "FR", "NO", "KZ", "MT", "CARD"] as const;

/** The two check digits that make an IBAN valid (mod 97). */
export function withCheckDigits(iban: string): string {
  const moved = `${iban.slice(4)}${iban.slice(0, 2)}00`;
  let rest = 0;
  for (const char of moved)
    for (const digit of /\d/.test(char) ? char : String(char.charCodeAt(0) - 55))
      rest = (rest * 10 + Number(digit)) % 97;
  return `${iban.slice(0, 2)}${String(98 - rest).padStart(2, "0")}${iban.slice(4)}`;
}

/** A random valid IBAN of a country (with its structure) or a card number of 13 to 19 digits. */
export function account(r: Rnd, country: (typeof COUNTRIES)[number]): string {
  const raw = accountWithoutCheck(r, country);
  return country === "CARD" ? raw : withCheckDigits(raw);
}

function accountWithoutCheck(r: Rnd, country: (typeof COUNTRIES)[number]): string {
  const check = digits(r, 2);
  switch (country) {
    case "PL":
      return `PL${check}${digits(r, 24)}`;
    case "NL":
      return `NL${check}${letters(r, 4)}${digits(r, 10)}`;
    case "DE":
      return `DE${check}${digits(r, 18)}`;
    case "GB":
      return `GB${check}${letters(r, 4)}${digits(r, 14)}`;
    case "FR":
      return `FR${check}${digits(r, 10)}${alnum(r, 11)}${digits(r, 2)}`;
    case "NO":
      return `NO${check}${digits(r, 11)}`;
    case "KZ":
      return `KZ${check}${digits(r, 3)}${pick(r, ["KZT", "USD", "EUR", "RUB"])}${digits(r, 10)}`;
    case "MT":
      return `MT${check}${letters(r, 4)}${digits(r, 5)}${alnum(r, 18)}`;
    case "CARD":
      return digits(r, int(r, 13, 19));
  }
}

// A joiner: 1 to 3 characters that are no letter and no digit.
const JOINER_CHARS = [
  " ",
  " ",
  " ",
  "\n",
  "\t",
  ".",
  "-",
  "/",
  "_",
  ",",
  "·",
  "。",
  "\u00a0",
  "|",
  ":",
  ";",
  "(",
  ")",
  "[",
  "]",
  "\u2009",
  "–",
  "—",
  "‑",
  "#",
  "*",
  "+",
  "=",
  "~",
  "'",
  '"',
  "&",
  "%",
  "!",
  "?",
  "\\",
  "<",
  ">",
  "{",
  "}",
  "@",
  "^",
  "`",
];
export function joiner(r: Rnd): string {
  const n = r() < 0.6 ? 1 : int(r, 2, 3);
  return Array.from({ length: n }, () => pick(r, JOINER_CHARS)).join("");
}

// 6 to 8 digits written as a date with random separators, or null when they are no calendar date.
function dateOf(r: Rnd, window: string): string | null {
  const sep = (): string => pick(r, [".", "-", "/"]);
  let day: string;
  let month: string;
  let year: string;
  let text: string;
  if (window.length === 8) {
    if (r() < 0.5) {
      [day, month, year] = [window.slice(0, 2), window.slice(2, 4), window.slice(4)];
      text = `${day}${sep()}${month}${sep()}${year}`;
    } else {
      [year, month, day] = [window.slice(0, 4), window.slice(4, 6), window.slice(6)];
      text = `${year}${sep()}${month}${sep()}${day}`;
    }
  } else if (window.length === 7) {
    [day, month, year] = [window.slice(0, 1), window.slice(1, 3), window.slice(3)];
    text = `${day}${sep()}${month}${sep()}${year}`;
  } else if (window.length === 6) {
    [day, month, year] = [window.slice(0, 1), window.slice(1, 2), window.slice(2)];
    text = `${day}${sep()}${month}${sep()}${year}`;
  } else return null;
  const [d, m, y] = [Number(day), Number(month), Number(year)];
  return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2199 ? text : null;
}

/** The text split into random groups of 1 to 6 characters with random joiners; sometimes with a date-like window. */
export function formatAccount(r: Rnd, raw: string, dateSplit: boolean): string {
  let parts: string[] = [];
  for (let i = 0; i < raw.length; ) {
    const size = Math.min(int(r, 1, 6), raw.length - i);
    parts.push(raw.slice(i, i + size));
    i += size;
  }
  if (dateSplit) {
    for (let tries = 0; tries < 20; tries += 1) {
      const length = pick(r, [6, 7, 8]);
      const at = int(r, 0, Math.max(0, raw.length - length));
      const window = raw.slice(at, at + length);
      const date = /^\d+$/.test(window) ? dateOf(r, window) : null;
      if (date === null) continue;
      parts = [raw.slice(0, at), date, raw.slice(at + length)].filter((part) => part !== "");
      break;
    }
  }
  return parts.map((part, index) => (index === 0 ? part : `${joiner(r)}${part}`)).join("");
}

const CURRENCIES = [
  "zł",
  "zl",
  "PLN",
  "pln",
  "EUR",
  "eur",
  "USD",
  "usd",
  "GBP",
  "CHF",
  "CZK",
  "euro",
  "euros",
  "dolarów",
  "złotych",
  "$",
  "€",
  "£",
];

/** A reply body with a random account number in a random sentence, with a random currency before or after. */
export function accountBody(r: Rnd, country: (typeof COUNTRIES)[number]): { body: string; raw: string } {
  const base = account(r, country);
  // 25 % of the accounts are typed in lower case.
  const raw = r() < 0.25 ? base.toLowerCase() : base;
  const text = formatAccount(r, raw, r() < 0.4);
  const currency = pick(r, CURRENCIES);
  const glue = r() < 0.5 ? " " : "";
  // A currency word before the number has a separator; a sign or a suffix may be glued.
  const before = ["$", "€", "£"].includes(currency) ? glue : " ";
  const placed = pick(r, [
    text,
    `${currency}${before}${text}`,
    `${text}${glue}${currency}`,
    `${currency}${before}${text}${glue}${currency}`,
  ]);
  const body = pick(r, [
    `Dzień dobry, proszę o przelew ${placed} do piątku.`,
    `Nowy rachunek: ${placed}. Pozdrawiam`,
    `Dzień dobry,\n\nproszę wpłacić kwotę 4 800,00 zł na konto ${placed}.\n\nPozdrawiam`,
    `Tak, ${placed}`,
    `Przelew na ${placed}, termin 18.11.2026.`,
  ]);
  return { body, raw };
}

function price(r: Rnd): string {
  const n = int(r, 1, 999999);
  const grouped = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, pick(r, [" ", " ", ".", ","]));
  const decimals = pick(r, ["", ",00", ",50", ",99", ".00", ".50"]);
  const currency = pick(r, ["zł", "PLN", "EUR", "USD", "€", "zł netto", "zł brutto"]);
  const amount = `${r() < 0.5 ? String(n) : grouped}${decimals}`;
  if (currency === "€" || currency === "USD")
    return pick(r, [`${amount} ${currency}`, `${currency === "€" ? "€" : "$"}${amount}`]);
  return `${amount} ${currency}`;
}

function dateText(r: Rnd): string {
  const [d, m, y] = [int(r, 1, 28), int(r, 1, 12), int(r, 2025, 2030)];
  const p = (x: number): string => String(x).padStart(2, "0");
  return pick(r, [
    `${p(d)}.${p(m)}.${y}`,
    `${d}.${m}.${y}`,
    `${y}-${p(m)}-${p(d)}`,
    `${p(d)}/${p(m)}/${y}`,
    `${p(d)}-${p(m)}-${y}`,
  ]);
}

const timeText = (r: Rnd): string => `${int(r, 7, 20)}:${pick(r, ["00", "15", "30", "45"])}`;

function invoice(r: Rnd): string {
  return pick(r, [
    `FV/${int(r, 2025, 2030)}/${int(r, 1, 12)}/${String(int(r, 1, 9999)).padStart(4, "0")}`,
    `FV ${int(r, 1, 999)}/${int(r, 2025, 2030)}`,
    `${int(r, 2025, 2030)}/${int(r, 1, 12)}/${String(int(r, 1, 99999)).padStart(6, "0")}`,
    `nr ${int(r, 1, 99999)}/${int(r, 2025, 2030)}`,
    `Ref. ${dateText(r)}/${String(int(r, 1, 9999)).padStart(4, "0")}`,
  ]);
}

/** An ordinary Polish business sentence: prices, dates, ranges, invoice numbers. No identifier of 9 digits or more. */
export function sentence(r: Rnd): string {
  const text = pick<() => string>(r, [
    () => `Cena wynosi ${price(r)}.`,
    () => `Koszt całości to ${price(r)}, a rabat ${int(r, 1, 30)}%.`,
    () => `Faktura ${invoice(r)} na kwotę ${price(r)} jest w załączniku.`,
    () => `Termin płatności to ${dateText(r)}.`,
    () => `Spotkanie odbędzie się ${dateText(r)} o ${timeText(r)}.`,
    () => `Od ${dateText(r)} do ${dateText(r)} jestem na urlopie.`,
    () => `Między ${dateText(r)}${pick(r, ["-", " - ", " – ", "–"])}${dateText(r)} biuro jest zamknięte.`,
    () =>
      `W dniach ${int(r, 1, 9)}-${int(r, 10, 28)}.${String(int(r, 1, 12)).padStart(2, "0")}.${int(r, 2025, 2030)} nie ma mnie.`,
    () => `Godziny pracy: ${timeText(r)}-${timeText(r)}.`,
    () => `Zamówienie ${invoice(r)} wysłano ${dateText(r)}.`,
    () => `Termin dostawy: do ${dateText(r)}, ilość: ${int(r, 1, 99)} sztuk.`,
    () => `Mam ${int(r, 1, 99)} pytania i ${int(r, 1, 20)} uwag, pokój ${int(r, 1, 300)}, piętro ${int(r, 1, 9)}.`,
    () => `Budżet ${price(r)} na rok ${int(r, 2025, 2030)}, w tym ${price(r)} na marketing.`,
    () => `Wersja ${int(r, 1, 9)}.${int(r, 0, 20)}.${int(r, 0, 50)} jest gotowa od ${dateText(r)}.`,
    () => `Proszę o potwierdzenie do ${dateText(r)} do godziny ${timeText(r)}.`,
    () => `Oferta ważna do ${dateText(r)}: ${int(r, 1, 500)} szt. po ${price(r)}.`,
    () => `Nakład ${int(r, 1, 999)} ${int(r, 100, 999)} egzemplarzy w cenie ${price(r)}.`,
    () => `Dostawa ${dateText(r)}, płatność ${price(r)} w ${int(r, 2, 12)} ratach.`,
    () => `Zaliczka ${price(r)} do ${dateText(r)}, reszta ${price(r)} do ${dateText(r)}.`,
    () => `Kolejne spotkanie ${dateText(r)} (${timeText(r)}–${timeText(r)}), sala ${int(r, 1, 30)}.`,
  ])();
  const pre = pick(r, ["", "Dzień dobry,\n\n", "Dziękuję za wiadomość. ", "Szanowni Państwo, "]);
  const post = pick(r, [
    " Dziękuję bardzo.",
    "\n\nPozdrawiam, dziękuję bardzo",
    " Pozdrawiam serdecznie, jest to dla mnie ważne.",
  ]);
  return `${pre}${text}${post}`;
}
