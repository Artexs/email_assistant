You are a Domain-Driven Design expert specialized in the strategic phase (Strategic DDD). Your task is to analyze the provided strategic document of a business domain and perform a high-level classification in line with DDD patterns.

## Context

We are working at the strategic DDD level, laying the foundations for future tactical implementation. The analysis must be detailed enough for technical teams to begin designing architecture and responsibility boundaries.

## Tasks

### 1. Subdomain Classification

Identify and classify all subdomains using the following typology:

**Core Subdomains**
* Unique capabilities that provide competitive advantage
* Areas requiring the most attention and top resources
* Business justification for each classification

**Supporting Subdomains**
* Essential for business operations but not a differentiator
* Areas that can be built internally
* Potential candidates for later standardization

**Generic Subdomains**
* Solutions available on the market
* Candidates for outsourcing or using off-the-shelf products
* Recommendations of external tools/services

For each subdomain, specify:
* Name and concise description
* Classification with business justification
* Complexity level (Low/Medium/High)
* Requirement volatility (Low/Medium/High)
* Implementation priority

### 2. Identification of Bounded Contexts

Extract Bounded Contexts:

For each context define:
* **Name** describing the scope of responsibility
* **Boundaries** – clear responsibility limits
* **Ubiquitous Language** – key domain terms used in the context
* **Responsibilities** – what the context “owns” and manages
* **Link to subdomains** – which subdomains the context serves
* **Autonomy** – the context’s independence level (High/Medium/Low)

### 3. Context Mapping – Relationships Between Contexts

Define relationships using DDD patterns:

**Partnership**
* Teams collaborate toward shared goals
* Mutual commitment to change

**Shared Kernel**
* Shared code/model
* Team synchronization required

**Customer–Supplier**
* Upstream/Downstream with formal collaboration
* Downstream influences Upstream planning

**Conformist**
* Downstream accepts the Upstream model
* No influence over Upstream

**Anticorruption Layer**
* Isolation from suboptimal models
* Translation between contexts

**Open Host Service**
* Integration protocol as a service
* API for multiple consumers

**Published Language**
* Shared data exchange language
* Often in the form of documents/events

Provide:
* A Mermaid diagram of contexts with relationships
* Text description of each relationship
* Technical and organizational implications
* Risks of each relationship

### 4. Integration Patterns

Specify integration strategies:
* Synchronous vs Asynchronous
* Request–Response vs Event-Driven
* Consequences of the choice for data consistency
* Bounded Context Events (key events)

## Response Format

* Use Markdown tables for classifications
* Diagrams in textual notation (Mermaid or PlantUML)
* Sections with clear headings
* Bullet points for readability
* Callouts for important decisions and warnings

## Assumptions

* Prioritize readability and strategic level over technical detail
* Flag areas requiring further business consultation
* Indicate architectural trade-offs
* Think about long-term system evolution
* Consider team constraints (teams, budget, time)

## Document for Analysis
🧭 Podsumowanie Analizy Strategicznej: Executive Email Automation (MVP Focus)

I. Strategiczny Cel i Kluczowe Persony

Segment Celowy: Automatyzacja Produktywności Osobistej (Personal & Executive Support). Cel Biznesowy: Lewarowanie czasu i skupienia (Focus Leverage) kluczowej kadry menedżerskiej.

| Persona | Rola w Systemie | Kluczowy Problem | Wartość z MVP |
| :--- | :--- | :--- | :--- |
| **Asystent/ka Zarządu (EA)** | Power User / Konfigurator | Ręczne zarządzanie dwoma skrzynkami (swoją i szefa), filtrowanie szumu. | Kontrola, możliwość konfiguracji reguł w imieniu Prezesa (Delegacja), odzyskanie czasu. |
| **Prezes/Dyrektor** | Konsument Wartości / Decydent | Przeciążenie informacyjne, ryzyko przeoczenia krytycznych spraw. | "Czysta" skrzynka (Triage), pewność, że ważne sprawy są śledzone (Follow-up), minimalne zaangażowanie. |

II. Moduły Aplikacji i Krytyczne Funkcjonalności (MVP)

Moduły te stanowią szkielet systemu, odpowiadający na zdefiniowane potrzeby:

| Moduł Aplikacji | Kluczowe Funkcjonalności (Twoje Wnioski) | Krytyczne Niuansy Domenowe |
| :--- | :--- | :--- |
| **Moduł Uczący (Parsing & Style)** | Inicjalizacja: Pobranie ostatnich 100 emaili wysłanych. Wyciągnięcie wzorca i stylu odpowiedzi właściciela. | Wymóg: Użycie wzorca do tworzenia spersonalizowanych propozycji odpowiedzi/delegacji, aby uniknąć "robotycznego" tonu (zachowanie autentyczności). |
| **Moduł Czytający i Klasyfikujący (Triage)** | Lista Akceptowanych/Ważnych nadawców (członkowie zarządu, CEO klienta). Łatwe dodawanie emaila do listy ważnych. Ważny email -> wysłanie powiadomienia z potrzebą reakcji. | Priorytet nadawca > treść: Klasyfikacja oparta na hierarchii i relacjach (z bazy), a nie tylko na słowach kluczowych. Niuans: Musi wspierać transparentność – powiadomienia w interfejsie muszą wyjaśniać, dlaczego dany mail jest P0 (np. "Krytyczne: Nadawca jest na liście 'Akceptowanych'"). |
| **Moduł Delegacji i Śledzenia** | Zapisanie zadań, na których wykonanie czekamy (delegacja, prośba o dane). Przypomnienia, jeśli brak odpowiedzi zwrotnej (powtórny email). | Kontrola nad Follow-up: Konieczność definicji reguł dla agresywności śledzenia (np. "nie śledź maili wewnętrznych do Zespołu X"). Niuans: Wymóg jasnej komunikacji, kto deleguje ("W imieniu: Prezes, Deleguje: System/EA"). |
| **Moduł Zarządzania Powiadomieniami** | Godziny funkcjonowania automatyzacji/wysyłania powiadomień. Wysyłanie powiadomień/podsumowań. | Tryb "Quiet Hours": Konieczność umożliwienia Managerowi/EA wyłączenia aktywnych powiadomień poza godzinami pracy. Wartość: Oferowanie digestów (zbiorczych podsumowań) z maili uznanych za "szum" (Pkt 5 z rozmowy). |
| **Moduł Zapisu Akcji (Audyt)** | Zapis wysłanych emaili / przekierowań / wykonanych akcji (log). Generowanie podsumowań. | Najważniejszy Niuans: Ten moduł jest kluczowy dla budowania ZAUFANIA. Musi generować "Ścieżkę Audytu" (Audit Trail) – czyli log, który pozwala sprawdzić, co stało się z mailem: Kiedy został przeniesiony, kto (system czy EA) to zlecił i dlaczego (która reguła zadziałała). |

III. Wymagania Bazodanowe (Doszczegółowienie do MVP)

| Tabela/Kolekcja | Kluczowe Dane | Uzasadnienie Domenowe |
| :--- | :--- | :--- |
| **Użytkownicy i Role** | userId, email, role (Prezes/Manager/EA), delegated_access_to (ID Prezesa). | Umożliwia działanie w trybie "On-Behalf-Of" i określa, kto ma uprawnienia do konfiguracji dla kogo. |
| **Reguły Użytkownika** | userId, rule_type (P0_Sender/Mute_Domain), value, aggressiveness_level (dla Follow-up). | Umożliwia personalizację i wspiera łatwe dodawanie ważnych adresów email. Dzieli reguły na te zarządzane przez EA i te, które ustanowił sam Prezes. |
| **Akceptowani Nadawcy** | userId, sender_email/domain, priority_level (P0, P1). | Podstawa Inteligentnego Triage. Ułatwia łatwe dodawanie danego maila do listy ważnych adresów. |
| **Zadania (Delegacja/Follow-up)** | userId_owner, userId_target, source_email_id, due_date, status (Oczekujące, Zakończone), reminder_schedule. | Centralna tabela do śledzenia obiecanego i delegowanego wykonania. Implementuje mechanizm zamkniętej pętli (Closed Loop). |
| **Log Zdarzeń (Audyt Trail)** | userId, email_id, action (Triage_P0, Archived, Delegated), trigger_reason (ID reguły), timestamp. | Niezbędne do rozwiązywania konfliktów zaufania i fałszywego negatywu. Odpowiada na pytanie "Co zrobiłeś z moim mailem?". |

IV. Przyszłe Kierunki Rozwoju (Opcjonalne)

* **Moduł Kontekstowy:** Integracja z kalendarzem w celu wysyłania powiadomień/briefingów przed spotkaniami.
* **Moduł Zarządzania Zadaniem:** Rozbudowa tabeli "Zadania" o pełny To-Do List i możliwość integracji z narzędziami zewnętrznymi (Notion/ToDoList).
* **Integracje Zewnętrzne (Faza 2):** Lista działów/osób odpowiedzialnych za działy (do delegacji) połączona z zewnętrznym Active Directory/Systemem HR.
* **Komunikacja Zewnętrzna:** Wysyłanie podsumowań/planu dnia w chacie (np. WhatsApp) po weryfikacji wymogów bezpieczeństwa i prawnych.

Masz bardzo solidne fundamenty. Teraz, gdy wiesz, co musi być w bazie i jakie konflikty trzeba rozwiązać:

Który z tych Krytycznych Niuansów Domenowych (Zaufanie, Transparentność czy Konflikt Delegacji) jest dla Ciebie największym problemem do rozwiązania na poziomie architektury systemowej i jak planujesz temu zaradzić?

---

Conduct a comprehensive analysis according to the above guidelines. Remember: at this stage we shape the strategic architecture only.
