import { describe, expect, test } from "bun:test";

import { shiftDatesInText } from "./date-shift";

const ANCHOR = "2027-01-25";
const shift = (text: string, offset = -63) => shiftDatesInText(text, offset, ANCHOR);

describe("shiftDatesInText (test 8, offset −63, anchor 2027-01-25)", () => {
  test.each([
    ["do 29.01.2027 o 10:00", "do 27.11.2026 o 10:00"],
    ["29.01", "27.11"],
    ["1.03.2027", "28.12.2026"],
    ["5.02.2027", "4.12.2026"],
    ["29 stycznia 2027", "27 listopada 2026"],
    ["29 stycznia", "27 listopada"],
    ["January 29, 2027", "November 27, 2026"],
    ["29 January", "27 November"],
    ["29. Januar 2027", "27. November 2026"],
  ])("%s → %s", (source, expected) => {
    const result = shift(source);
    expect(result.text).toBe(expected);
    expect(result.shifted).toBe(1);
  });

  test.each(["ZK-2027-0143", "budżet na rok 2027", "12.50 EUR", "12.05", "styczeń 2027", "January 2027", "10.30"])(
    "%s stays",
    (source) => {
      expect(shift(source)).toEqual({ text: source, shifted: 0 });
    }
  );

  test("shifted counts the changed forms of a text", () => {
    const result = shift("Frist 29.01.2027, Treffen am 29. Januar, Rest 12.50 EUR, ZK-2027-0143, bis 30 stycznia.");
    expect(result.text).toBe(
      "Frist 27.11.2026, Treffen am 27. November, Rest 12.50 EUR, ZK-2027-0143, bis 28 listopada."
    );
    expect(result.shifted).toBe(3);
  });
});

describe("shiftDatesInText style and edges", () => {
  test("zero padding follows the source", () => {
    expect(shift("05.02.2027").text).toBe("04.12.2026");
    expect(shift("05.02").text).toBe("04.12");
    expect(shift("05 lutego").text).toBe("04 grudnia");
    expect(shift("5 lutego").text).toBe("4 grudnia");
    expect(shift("1 lutego", -14).text).toBe("18 stycznia");
    expect(shift("05 lutego", -35).text).toBe("01 stycznia");
  });

  test("month name case follows the source", () => {
    expect(shift("29 JANUARY").text).toBe("27 NOVEMBER");
    expect(shift("29 january").text).toBe("27 november");
    expect(shift("JANUARY 29").text).toBe("NOVEMBER 27");
  });

  test("a full date outside the ±90 day window still moves; a day and month outside does not", () => {
    expect(shift("04.02.2028").text).toBe("03.12.2027");
    expect(shift("12.05").shifted).toBe(0);
    expect(shift("25.04").shifted).toBe(1);
    expect(shift("26.04").shifted).toBe(0);
    expect(shift("27.10").shifted).toBe(1);
    expect(shift("26.10").shifted).toBe(0);
  });

  test("an invalid date stays", () => {
    expect(shift("31.02.2027")).toEqual({ text: "31.02.2027", shifted: 0 });
    expect(shift("31 lutego")).toEqual({ text: "31 lutego", shifted: 0 });
    expect(shift("February 30, 2027")).toEqual({ text: "February 30, 2027", shifted: 0 });
  });

  test("a version, a long dotted number and a time stay", () => {
    expect(shift("wersja 1.2.3")).toEqual({ text: "wersja 1.2.3", shifted: 0 });
    expect(shift("192.168.10.20")).toEqual({ text: "192.168.10.20", shifted: 0 });
    expect(shift("godz. 10.30")).toEqual({ text: "godz. 10.30", shifted: 0 });
    // A two-digit year is not a form of this function; the day and month must not move alone.
    expect(shift("29.01.27")).toEqual({ text: "29.01.27", shifted: 0 });
  });

  test("a date at the end of a sentence moves", () => {
    expect(shift("Termin: 29.01.").text).toBe("Termin: 27.11.");
    expect(shift("Termin: 29.01.2027.").text).toBe("Termin: 27.11.2026.");
  });

  test("a shared month name is German after a dot and English otherwise", () => {
    expect(shift("29. August 2027", -63).text).toBe("27. Juni 2027");
    expect(shift("29 August 2027", -63).text).toBe("27 June 2027");
  });

  test("a zero offset changes nothing", () => {
    expect(shiftDatesInText("29.01.2027", 0, ANCHOR)).toEqual({ text: "29.01.2027", shifted: 0 });
  });

  test("a year crossing and Feb 29 work", () => {
    expect(shift("5 stycznia 2027", 63).text).toBe("9 marca 2027");
    expect(shiftDatesInText("29 lutego 2028", 7, ANCHOR).text).toBe("7 marca 2028");
    expect(shiftDatesInText("28.12.2026", 7, ANCHOR).text).toBe("04.01.2027");
  });
});
