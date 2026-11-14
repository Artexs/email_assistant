import type { Scenario, SimPersona } from "./scenario";

function persona(key: string, group: SimPersona["group"], lang: SimPersona["lang"], host: string): SimPersona {
  return {
    key,
    displayName: `Persona ${key}`,
    address: `${key}@${host}`,
    group,
    lang,
    voice: `Short and direct, writes as the ${group} ${key}.`,
    signature: group === "boss" || group === "team" ? `Pozdrawiam, ${key}` : "",
  };
}

// A small valid scenario for tests of the sim code; the real scenario is a file in evals/sim.
export const miniScenario: Scenario = {
  id: "mini",
  company: { name: "Mini Sp. z o.o.", domain: "mini.test" },
  executive: {
    key: "szef",
    displayName: "Szef Mini",
    address: "szef@mini.test",
    lang: "pl",
    timeZone: "Europe/Warsaw",
  },
  personas: [
    persona("prezes", "boss", "pl", "mini.test"),
    persona("kasia", "team", "pl", "mini.test"),
    persona("anna", "delegate", "pl", "mini.test"),
    persona("marek", "delegate", "pl", "mini.test"),
    persona("client-a", "client", "en", "client-a.test"),
    persona("partner-b", "partner", "en", "partner-b.test"),
    persona("vendor-c", "vendor", "pl", "vendor-c.test"),
    persona("news-d", "newsletter", "en", "news-d.test"),
    persona("promo-e", "marketing", "pl", "promo-e.test"),
    persona("system-f", "system", "en", "system-f.test"),
    persona("spam-g", "spammer", "en", "spam-g.test"),
    persona("phish-h", "phishing", "en", "phish-h.test"),
  ],
  delegates: [
    { persona: "anna", tags: ["faktury", "ksiegowosc"] },
    { persona: "marek", tags: ["oferty", "sprzedaz"] },
  ],
  urgency: {
    vip: ["prezes"],
    profile: {
      topics: [
        { label: "Fuzja z Beta", keywords: ["fuzja", "beta"] },
        { label: "Audyt roczny", keywords: ["audyt"] },
      ],
      deadlines: [
        { label: "Oferta dla klienta A", due: "2026-11-20" },
        { label: "Zamkniecie audytu", due: "2026-12-04" },
      ],
    },
  },
  calendar: { bankStart: "2026-11-02", weekStart: "2026-11-16" },
  topics: [
    { key: "faktury", label: "Faktury i platnosci", personas: ["anna", "vendor-c"] },
    { key: "oferty", label: "Oferty dla klientow", personas: ["marek", "client-a"] },
    { key: "fuzja", label: "Fuzja z Beta", personas: ["prezes", "partner-b"] },
    { key: "audyt", label: "Audyt roczny", personas: ["kasia"] },
    { key: "systemy", label: "Powiadomienia systemowe", personas: ["system-f"] },
  ],
};
