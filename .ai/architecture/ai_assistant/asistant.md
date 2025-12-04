//// https://gemini.google.com/app/2a56be06428d89bf?hl=pl

# Dokumentacja Modułu: Asystent AI (Interface Gateway)

## 1. Opis i Cel Biznesowy

Moduł Asystenta to inteligentna warstwa interfejsu (Interface Gateway), oddzielająca użytkownika (Executive) od złożoności systemowej backendu. Nie wykonuje on operacji biznesowych bezpośrednio (nie wysyła sam maili, nie zmienia statusów w bazie), lecz działa jako tłumacz i orkiestrator konwersacji.

**Główny cel biznesowy:** Zapewnienie naturalnej, wielokanałowej (Tekst/Głos) i bezpiecznej interakcji z systemem, która minimalizuje obciążenie poznawcze Prezesa. Asystent "rozumie" intencje, dopytuje o szczegóły w razie niejasności i syntetyzuje dane z backendu w czytelne komunikaty.

## 2. Architektura Przepływu Danych

```mermaid
graph TD
    subgraph "Kanały Komunikacji"
        WA[WhatsApp User]
        Web[Web Chat Interface]
    end

    subgraph "Moduł Asystenta (Interface Layer)"
        Listener[Webhook Listener & Auth]
        STT[Whisper API (Voice-to-Text)]
        NLU[LLM Core (Rozumienie Intencji)]
        Synth[Synteza Odpowiedzi]
        ContextDB[(Pamięć Konwersacji & Vector DB)]
    end

    subgraph "Backend (Logic & Tools)"
        Orchestrator[Orchestrator API]
        TriageService[Triage Service]
        DataTools[RAG / Calendar / Email Data]
    end

    WA & Web --> Listener
    Listener -->|Audio| STT
    Listener -->|Tekst| NLU
    STT --> NLU

    NLU <--> ContextDB
    NLU -->|JSON Intent: Send/Delegate/Query| Orchestrator

    Orchestrator -->|Status/Raw Data| Synth
    Orchestrator -->|Push Notification| Synth

    Synth --> WA
```

## 3. Szczegółowy Opis Funkcjonalności

### F1. Wielokanałowa Obsługa Wejścia (Voice & Text)

**Kategoria:** [MVP]
**Opis:** Asystent nasłuchuje wiadomości tekstowych oraz notatek głosowych (Voice Notes).

- **Logika:**
  - Autoryzacja użytkownika na podstawie numeru telefonu (Whitelist w DB).
  - Pliki audio są natychmiast przesyłane do modelu STT (np. Whisper), a uzyskany tekst jest procesowany tak samo jak wiadomość tekstowa.
- **Edge Case:** Słaba jakość nagrania/szum -> Asystent prosi o powtórzenie lub wpisanie ręczne.

### F2. NLU i Zarządzanie Intencjami (Wielowątkowość)

**Kategoria:** [MVP]
**Opis:** "Mózg" konwersacyjny. Analizuje tekst, identyfikuje intencje (np. SEND_EMAIL, GET_BRIEFING, APPROVE_DRAFT) i buduje ustrukturyzowany obiekt JSON dla Backendu.

- **Logika:**
  - Obsługa "skakania po tematach" (Context Switching) - użytkownik może przerwać dyktowanie maila, zapytać o kalendarz i wrócić do maila.
  - Ujednoznacznianie (Disambiguation): Jeśli brakuje danych (np. "Wyślij do Marka" - którego?), Asystent dopytuje zanim zawoła Backend.
- **Edge Case:** Intencja niezrozumiała -> Fallback do pytania "Nie zrozumiałem, czy chodziło Ci o X czy Y?".

### F3. Synteza Danych i Briefingi (Just-in-Time)

**Kategoria:** [MVP]
**Opis:** Zamiana surowych danych z Backendu na naturalny język.

- **Mechanizm:** Backend dostarcza "mięso" (np. lista 5 ostatnich maili, JSON ze slotami kalendarza). Asystent formatuje to w czytelną wiadomość WhatsApp ("Masz spotkanie z X. Ostatnio ustaliliście Y...").
- **Trigger:** Na żądanie użytkownika LUB automatycznie (np. CRON wyzwala "Pre-meeting Briefing").

### F4. Dynamiczny "Human in the Loop" (Safety Logic)

**Kategoria:** [MVP]
**Opis:** Inteligentne decydowanie, kiedy prosić o potwierdzenie akcji.

- **Logika:**
  - Asystent sprawdza kategorię/wagę kontaktu (dane z modułu Triage).
  - Niska waga / Rutyna: Akcja automatyczna ("Wysłano").
  - Wysoka waga (VIP) / Niejasna intencja: Asystent generuje podgląd i wymusza potwierdzenie ("To mail do Inwestora. Oto treść. Czy wysłać?").

### F5. Zarządzanie Powiadomieniami (Push & Digest)

**Kategoria:** [MVP]
**Opis:** Asystent pełni rolę filtra antyszumowego.

- **Pilne (Urgent):** Powiadomienia o mailach VIP lub krytycznych błędach są wypychane (Push) natychmiast.
- **Rutynowe:** Wszystkie inne informacje czekają na cykliczny raport (Daily Digest) lub są dostępne na żądanie.

### F6. UX: Statusy Pośrednie (Optimistic UI)

**Kategoria:** [MVP]
**Opis:** Zarządzanie oczekiwaniem użytkownika na operacje backendowe.

- **Mechanizm:** Jeśli operacja może trwać >3 sekundy (np. generowanie draftu), Asystent wysyła status "Przetwarzam..." lub "Piszę maila...", a po sukcesie edytuje wiadomość lub wysyła nową z potwierdzeniem "✅ Gotowe".

## 4. Lista Zidentyfikowanych Wymagań

- **Interfejs API (Internal):** Backend (Orchestrator) musi wystawić endpointy przyjmujące JSON, a nie tekst naturalny. Asystent bierze na siebie ciężar NLU.
- **Współdzielona Baza Danych:** Asystent musi mieć dostęp (read-only) do tabeli users (autoryzacja) oraz (read-write) do message_logs (historia) i vector_store (pamięć kontekstowa).
- **Obsługa Błędów Asynchronicznych:** Asystent musi posiadać webhook/mechanizm, dzięki któremu Backend może zgłosić błąd po czasie (np. "Mail jednak nie wyszedł"), co wyzwoli powiadomienie do użytkownika.

## 5. Lista Ulepszeń (Post-MVP)

- **[OPTIONAL] Głosowa Konfiguracja:** Możliwość zmiany ustawień systemu komendą głosową (np. "Od jutra zmień mój styl na bardziej formalny", "Dodaj Marka do Whitelisty").
- **[OPTIONAL] Web Chat Mirror:** Pełna replikacja interfejsu WhatsApp na stronie WWW (stan rozmowy zsynchronizowany w czasie rzeczywistym).
- **[OPTIONAL] Proaktywność Osobowości:** Asystent sam sugeruje akcje na podstawie kontekstu (np. "Widzę, że masz luźniejszy piątek, czy przesunąć spotkanie z X na wtedy?").
