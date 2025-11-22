# Tech Spec: Moduł Inicjalizacji i Aktualizacji Konfiguracji (Backend)

## 1. Przegląd Zarządczy

Moduł backendowy ("Brain") działający jako autonomiczny analityk danych. Odpowiada za "zimny start" systemu (skanowanie historii) oraz ciągłe "doszkalanie" (feedback loop) na podstawie interakcji użytkownika. Nie posiada własnego UI – jego produktem są zaktualizowane dane w bazie (kontakty, style, wagi), które są konsumowane przez moduł Triage i API.

**Kluczowe filary:**
1. **Inicjalizacja (Batch):** Budowa bazy wiedzy z historii (ograniczonej limitem).
2. **Maintenance (Cron):** Uczenie się na błędach (Manual Handling) i korektach (Draft vs Sent).
3. **Bezpieczeństwo:** Whitelista jako reguła nadrzędna; modyfikacje oparte na systemie wag (TrustScore).

---

## 2. Architektura Systemu

Zaktualizowany diagram uwzględnia tabelę `Draft_Audit` niezbędną do analizy różnic (Diff Logic) oraz precyzuje przepływy danych.

```mermaid
graph TD
    subgraph "External Sources (Gmail API)"
        Inbox[Inbox / History]
        Sent[Sent Items]
        ManualFolder[Folder: 'Manual Handling']
    end

    subgraph "Internal Storage (PostgreSQL)"
        DB_Contacts[Table: Contacts (Profiles)]
        DB_Categories[Table: Categories (Styles)]
        DB_Drafts[Table: Draft_Audit (Snapshot)]
    end

    subgraph "Module: Initialization (One-Time)"
        InitWorker[Init Worker Process]
        Filter[Noise Filter & Heuristics]
        EntityExt[Entity Extractor]
    end

    subgraph "Module: Maintenance (Cron Job)"
        MaintWorker[Maintenance Worker]
        DiffEngine[Diff Engine (Draft vs Sent)]
        FeedbackLoop[Action Analyzer (Manual Folder)]
        CompEngine[Competence Summarizer]
    end

    %% Initialization Flow
    Inbox & Sent -->|Fetch Last 6mo/2k| InitWorker
    InitWorker --> Filter
    Filter -->|Clean Data| EntityExt
    EntityExt -->|Insert/Update| DB_Contacts
    EntityExt -->|Generate Rules| DB_Categories

    %% Maintenance Flow
    ManualFolder -->|Fetch Unprocessed| FeedbackLoop
    Sent -->|Fetch New| FeedbackLoop
    DB_Drafts -->|Fetch Original Draft| DiffEngine
    Sent -->|Fetch Final Email| DiffEngine
    
    FeedbackLoop -->|Move to Spam/Trash| DB_Contacts
    FeedbackLoop -->|Reply Detected| DB_Contacts
    
    DiffEngine -->|Update Style Examples| DB_Categories
    DiffEngine -->|Update Competence Tags| CompEngine
    CompEngine -->|Update Description| DB_Contacts
```

---

## 3. Szczegółowa Specyfikacja Implementacyjna

### 3.1. Model Danych (PostgreSQL / Supabase)

Schemat bazy danych musi wspierać rozdzielenie tożsamości od kompetencji oraz mechanizm auditowania draftów.

#### Tabela: `categories` (Słownik Kategorii)
Definiuje grupy kontaktów i zasady komunikacji.

| Kolumna | Typ | Opis |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `name` | VARCHAR | np. 'VIP', 'Team', 'Client', 'Spam', 'Notifications' |
| `base_style_prompt` | TEXT | Ogólna instrukcja dla LLM (generowana/edytowana). |
| `few_shot_examples` | JSONB | Tablica par wiadomości `[{q: "...", a: "..."}]`. Model LIFO (max 20). |
| `created_at` | TIMESTAMPTZ | |

#### Tabela: `contacts` (Profile & Kompetencje)
Główna tabela "Wiedzy". Łączy tożsamość z wagami i kompetencjami.

| Kolumna | Typ | Opis |
| :--- | :--- | :--- |
| `email` | VARCHAR | PK. Unikalny adres email. |
| `category_id` | UUID | FK do `categories`. Domyślna kategoria kontaktu. |
| `display_name` | VARCHAR | Imię i nazwisko / Nazwa firmy. |
| `trust_score` | INTEGER | Waga (-100 do 100). Domyślnie 0. Spam \< -50. VIP \> 50. |
| `competence_tags` | TEXT[] | Lista słów kluczowych (np. ["faktury", "umowy"]). Append-only. |
| `competence_summary` | TEXT | Wygenerowany przez LLM spójny opis roli (dla Delegatora). |
| `last_interaction` | TIMESTAMPTZ | Data ostatniej wymiany mailowej. |
| `individual_style` | TEXT | Opcjonalny override stylu (NULL by default). |

#### Tabela: `draft_audit` (Pamięć Draftów)
Krytyczna dla mechanizmu "Diff Logic". Przechowuje to, co AI *chciało* wysłać.

| Kolumna | Typ | Opis |
| :--- | :--- | :--- |
| `message_id` | VARCHAR | PK. ID wiadomości przychodzącej (Gmail Message-ID). |
| `generated_draft_body` | TEXT | Treść wygenerowana przez AI przed edycją użytkownika. |
| `category_snapshot` | UUID | ID kategorii użytej do generowania (dla celów analitycznych). |
| `created_at` | TIMESTAMPTZ | Czas wygenerowania draftu. |

---

### 3.2. Algorytmy i Logika Biznesowa

#### A. Proces Inicjalizacji (Cold Start)
* **Trigger:** Ręczne uruchomienie po podpięciu konta.
* **Input Scope:** `LIMIT = min(Date > NOW() - 6 months, Count <= 2000 sent emails)`.
* **Filtr Szumu (Hard Logic):**
    * Odrzuć, jeśli nadawca zawiera: `noreply`, `no-reply`, `bounce`, `notifications`, `support`.
    * Odrzuć, jeśli brak struktury konwersacyjnej (analiza HTML: brak `blockquote` lub nagłówków `On ... wrote:` w treści wysłanej).
* **Heurystyka Kategoryzacji (Auto-Tagging):**
    1. **Pracownik:** Domena nadawcy == Domena użytkownika (z wyłączeniem domen publicznych jak gmail.com).
    2. **VIP (Kandydat):**
        * Użytkownik wysłał \> 5 maili rozpoczynających wątek (Inicjatywa).
        * LUB Średni czas odpowiedzi użytkownika \< 2h (Responsywność).
    3. **Klient:** Słowa kluczowe w historii: "faktura", "oferta", "zamówienie", "kosztorys".
    4. **Fallback:** Kategoria "General/Inne".

#### B. Proces Maintenance: Analiza "Manualna Obsługa"
* **Trigger:** Cron (np. co 4h lub w nocy).
* **Logika:**
    1. Pobierz listę maili z folderu Gmail `Manual Handling` (które nie są jeszcze oflagowane w DB jako `processed`).
    2. **Sprawdź status w Gmailu:**
        * **Przypadek 1: Usunięty/Spam.** Jeśli maila nie ma w Inbox/Manual, a jest w Trash/Spam:
            * `UPDATE contacts SET trust_score = trust_score - 10 WHERE email = sender`.
            * Jeśli `trust_score < -50` -\> Sugeruj przeniesienie do kategorii SPAM.
        * **Przypadek 2: Odpowiedziano.** Szukaj w folderze `Sent` wiadomości gdzie header `In-Reply-To` == `Message-ID` maila z folderu Manual.
            * Jeśli znaleziono:
                * `trust_score += 5`.
                * Pobierz treść odpowiedzi.
                * Uruchom **Ekstrakcję Kompetencji** (zobacz punkt D).
                * Dodaj parę (Mail Przychodzący + Odpowiedź) do `categories.few_shot_examples` (dla odpowiedniej kategorii).

#### C. Proces Maintenance: Analiza Draftów (Diff Logic)
* **Cel:** Nauka stylu na podstawie korekt draftów.
* **Logika:**
    1. Pobierz nowe maile z folderu `Sent`.
    2. Sprawdź, czy dla danego maila istnieje wpis w tabeli `draft_audit` (na podstawie `In-Reply-To` lub thread matching).
    3. Jeśli istnieje:
        * Porównaj `draft_audit.generated_draft_body` z `sent_email.body`.
        * Oblicz podobieństwo (np. algorytm Levenshteina lub proste porównanie długości/słów).
        * **Threshold:** Jeśli różnica \> 10%:
            * Traktuj wersję `Sent` jako "Złoty Standard".
            * Dodaj do `categories.few_shot_examples` w trybie **LIFO** (usuń najstarszy przykład, dodaj nowy).

#### D. Ekstrakcja Kompetencji (Append & Summarize)
* **Działanie:** Wywoływane przy analizie maili wysłanych (Delegacji) lub Manualnych Odpowiedzi.
* **Krok 1 (Tagging):** Wykryj czasowniki/rzeczowniki oznaczające zadanie (np. "sprawdź", "zapłać", "umowa", "grafika"). Dopisuj unikalne tagi do `contacts.competence_tags`.
* **Krok 2 (Summarize - Batch):** Raz na cykl (np. tydzień) dla kontaktów ze zmienionymi tagami:
    * Prompt LLM: *"Based on these keywords: [tag1, tag2, ...], write a concise 1-sentence description of this person's responsibilities."*
    * Wynik zapisz w `contacts.competence_summary`.

---

### 3.3. Interfejsy i Zależności

#### Interfejsy Wewnętrzne (API)
Ten moduł nie wystawia endpointów REST dla Frontendu (poza triggerem startu). Bezpośrednio operuje na bazie danych.
1. `POST /api/init/start` - Uruchamia proces Inicjalizacji (wymaga tokenu Admina).
2. `POST /api/maintenance/trigger` - Manualne wymuszenie cyklu maintenance (dla testów).

#### Zależności Zewnętrzne
1. **Gmail API:**
    * Scope: `https://www.googleapis.com/auth/gmail.readonly` (dla analizy), `gmail.modify` (dla przenoszenia/etykietowania).
    * Wymagane pobieranie nagłówków: `Message-ID`, `In-Reply-To`, `References`, `Date`, `From`, `To`.
2. **OpenAI API (LLM):**
    * Model: `gpt-4o` (dla summarization i extraction) lub lżejszy model lokalny w przyszłości.
    * Zero-Retention Policy: Upewnić się, że dane nie są trenowane przez dostawcę (Enterprise/API settings).

---

### 3.4. Ograniczenia i Edge Cases (Implementacyjne)

1. **Whitelista (VIP) - Hard Rule:**
    * Algorytm **nigdy** nie może automatycznie zmienić kategorii z `VIP` na `Spam` ani usunąć kontaktu z `VIP`, nawet przy ujemnym `trust_score`.
    * W przypadku wykrycia anomalii (VIP w Spamie), system loguje "Alert" w tabeli logów (do wyświetlenia w Dashboardzie), ale nie wykonuje akcji.
2. **Draft Matching:**
    * Jeśli użytkownik nie wyśle draftu, tylko napisze nową wiadomość (bez użycia draftu), system nie będzie miał połączenia.
    * *Mitigation:* System próbuje matchować po `Thread-ID` jeśli `Message-ID` zawiedzie, ale z mniejszą pewnością.
3. **Latency:**
    * Zmiany w stylach i kompetencjach wchodzą w życie dopiero po zakończeniu cyklu Maintenance (nie są realtime).

### 3.5. Wymagania [OPTIONAL] / Post-MVP
* **PII Sanitizer:** Moduł regex/NLP do wycinania PESEL/Kart Kredytowych przed zapisem do `few_shot_examples`.
* **Config Snapshots:** Tabela `config_history` przechowująca JSON zrzuty konfiguracji przed każdą nocną aktualizacją.