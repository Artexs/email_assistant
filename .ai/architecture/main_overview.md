# Kompleksowa Specyfikacja Architektury Systemu: AI Email Assistant

## 1. Przegląd Architektury

System realizowany jest w modelu podziału na Frontend (aplikacja kliencka Astro/React) oraz Backend (Modularny Monolit w Node.js).
Backend (repozytorium monorepo) zachowuje ścisłą separację modułów (wzorzec Ports & Adapters), co umożliwia przyszłą migrację do mikroserwisów.

System składa się z Warstwy Prezentacji (Frontend), trzech fizycznych punktów wejścia Backendowych (Aplikacji), Warstwy Domenowej oraz Infrastruktury.

## 2. Frontend (Warstwa Prezentacji)

Osobna aplikacja internetowa, stanowiąca centrum dowodzenia dla użytkownika (Prezesa/Asystentki).

### A. App: Dashboard & Config Panel

**Technologia:** Astro (szkielet, routing, SSR) + React (interaktywne komponenty "Islands") + Tailwind CSS.
**Rola:** Interfejs graficzny do zarządzania systemem, konfiguracją i raportami.
**Komunikacja:** Łączy się z App 1 (API Server) poprzez REST/TRPC oraz bezpośrednio z Supabase (Auth).

**Kluczowe Widoki i Funkcjonalności:**

- **Dashboard Główny:** Wizualizacja statystyk (liczba przetworzonych maili, zaoszczędzony czas, stosunek automat vs manual).
- **Panel Konfiguracyjny:**
  - **Action Switches:** Globalne włączniki (ON/OFF) dla każdego Narzędzia (Spam, Delegacja, Spotkania).
  - **Lists Management:** CRUD dla Whitelisty i Listy Delegatów.
  - **Style Editor:** Edycja i zatwierdzanie wygenerowanego "Opisu Stylu".
- **Manual Action Center:** Formularz "Ręcznej Delegacji" (wysyła żądanie do API).
- **Auth & Profile:** Logowanie (Supabase Auth), zarządzanie kontem.

## 3. Aplikacje Backendowe (Punkty Wejścia / Entry Points)

Są to niezależne procesy Node.js uruchamiane w kontenerach lub na serwerze. Dzielą współdzielony kod (shared kernel), ale mają różne odpowiedzialności.

### A. App 1: API & Interaction Server (HTTP)

**Typ:** Serwer HTTP (Express/Fastify).
**Rola:** Obsługa interakcji w czasie rzeczywistym z Frontendem i zewnętrznymi webhookami.

**Funkcjonalności:**

- **API Gateway:** Endpointy dla Frontendu (odbieranie konfiguracji, ręczne delegacje).
- **Webhook Receiver:** Odbieranie zdarzeń z WhatsApp (wiadomości tekstowe i głosowe).
- **User Intent Processor:** Analiza żądań użytkownika (np. "Zdeleguj to ręcznie", "Dodaj X do whitelisty") i uruchamianie odpowiednich akcji w Config Manager.
- **Voice Handler:** Przekazywanie plików audio do adaptera STT (Whisper).

### B. App 2: Triage Worker (Background Process)

**Typ:** Długo żyjący proces w tle (Daemon) z schedulerem (Cron).
**Rola:** "Mózg" operacyjny systemu. Cykliczne przetwarzanie skrzynki odbiorczej.

**Funkcjonalności:**

- **Cron Trigger:** Uruchamianie pętli przetwarzania (np. co 5 minut).
- **Triage Orchestrator:** Zarządzanie przepływem: Pobranie -> Decyzja -> Wykonanie.
- **Committer (Result Handler):** Jedyny punkt, który wykonuje zmiany (Side Effects). Odbiera "Plany Wykonania" od Narzędzi i atomowo aplikuje zmiany (DB + Gmail).

### C. App 3: Learning & Maintenance (Batch Jobs)

**Typ:** Proces wsadowy (Batch Job) / Skrypty CLI.
**Rola:** Ciężkie operacje obliczeniowe, które nie mogą blokować głównego Triage'u.

**Funkcjonalności:**

- **Vector Trainer:** Indeksowanie historycznych i nowych wątków mailowych do bazy wektorowej (dla RAG).
- **Style Analyzer:** Analiza wysłanych wiadomości w celu aktualizacji wzorca "Stylu Prezesa".
- **Initial Seed:** Skrypty pierwszego uruchomienia (import danych).

## 4. Logika Domenowa i Narzędzia (Core Business Logic)

Warstwa "czystej" logiki biznesowej. Moduły tutaj nie wiedzą, czy zostały uruchomione przez Crona, czy przez API.

### A. Moduł Triage & Router

- **Decision Router:** Analizuje metadane maila i decyduje, które Narzędzie uruchomić.
- **Rules Engine:** Aplikuje twarde reguły biznesowe (np. Whitelista ma priorytet nad AI).
- **Context Builder:** Pobiera dane z Bazy Wektorowej (Memory), aby zbudować bogaty prompt dla AI.

### B. Narzędzia (The "Hard 6" Tools)

Każde narzędzie implementuje wspólny interfejs. Są to funkcje czyste (pure functions) – nie modyfikują bazy ani nie wysyłają maili bezpośrednio. Zwracają obiekt ExecutionPlan.

**Spam Tool:**

- Wykrywa spam.
- Zwraca plan: MOVE_TO_SPAM, LEARN_NEGATIVE.

**Delegation Tool:**

- Analizuje treść zadania i dobiera delegata.
- Generuje treść delegacji (Draft/Send).
- Zwraca plan: CREATE_TASK, SEND_EMAIL (lub DRAFT), NOTIFY_WHATSAPP.

**Meeting Tool:**

- Parsuje daty z treści.
- Sprawdza kolizje (przez Calendar Adapter).
- Zwraca plan: REPLY_WITH_SLOTS lub ASK_FOR_CLARIFICATION.

**Summary Tool:**

- Generuje skrót informacyjny.
- Zwraca plan: ARCHIVE_EMAIL, SAVE_SUMMARY.

**Clarification Tool:**

- Uruchamiane, gdy brakuje danych do delegacji.
- Generuje draft zapytania do nadawcy lub Prezesa.
- Zwraca plan: CREATE_DRAFT, FLAG_FOR_REVIEW.

**Manual / Emergency Tool:**

- Fallback dla niskiej pewności AI lub błędów.
- Zwraca plan: MOVE_TO_MANUAL, LOG_ERROR, ALERT_ADMIN.

### C. Moduł Intent & Config (Zarządzanie)

- **Intent Logic:** Mapowanie języka naturalnego na komendy systemowe.
- **Config Manager:** Logika CRUD dla Whitelisty, Delegatów i Włączników Akcji.

## 5. Adaptery (Warstwa Infrastruktury)

Odizolowane moduły komunikacji ze światem zewnętrznym.

### Komunikacja

- **Gmail Adapter:** Obsługa IMAP/REST API. Pobieranie (Pull), Etykietowanie, Przenoszenie, Tworzenie Draftów.
- **WhatsApp Adapter:** Obsługa Meta API. Wysyłanie szablonów, odbieranie webhooków, pobieranie mediów.

### Sztuczna Inteligencja

- **OpenAI Adapter (LLM):** Obsługa modeli językowych (GPT-4o). Zarządzanie promptami i parsowanie JSON.
- **Whisper Adapter (STT):** Transkrypcja plików audio (głosówki) na tekst.

### Dane i Stan

- **Supabase SQL Adapter:** Klient PostgreSQL. Obsługa tabel: Users, Emails, Delegations, Logs.
- **Vector DB Adapter:** Klient bazy wektorowej (np. pgvector). Zarządzanie embeddingami (dodawanie, wyszukiwanie semantyczne).
- **Config / Feature Flag Adapter:** Pobieranie konfiguracji dynamicznej (np. czy tryb "Auto-Send" jest włączony).

### Narzędzia Pomocnicze

- **Calendar Adapter:** Abstrakcja nad Google Calendar / Outlook. Sprawdzanie dostępności (Free/Busy).
- **Logger Adapter:** Centralne logowanie zdarzeń i błędów (strukturalne).
- **Clock Adapter:** Wrapper na czas systemowy (dla testowalności logiki terminów).

## 6. Kluczowe Rozwiązania Techniczne i Procesy

### A. Wzorzec "Committer" (Transactional Safety)

Aby uniknąć niespójności danych (np. mail wysłany, ale nie zapisany w bazie), system stosuje wzorzec Unit of Work / Committer.

Triage Worker pobiera maila.
Tool generuje ExecutionPlan (JSON w pamięci).
Committer otrzymuje plan i wykonuje go w sekwencji:

- **Krok 1:** API Call (np. wyślij maila/draft).
- **Krok 2:** DB Transaction (zapisz status PROCESSED, zapisz delegację).
- **Krok 3:** Obsługa błędu (jeśli Krok 1 padnie -> nie zapisuj w DB, oznacz do Retry).

### B. Retry Mechanism & Error Handling

Każdy email ma licznik retry_count.
Błędy "miękkie" (np. timeout OpenAI) powodują powrót do kolejki.
Błędy "twarde" lub przekroczenie limitu prób (np. 3x) powodują uruchomienie Manual / Emergency Tool (przeniesienie do folderu "Manualna Obsługa").

### C. Baza Wektorowa (RAG - Retrieval Augmented Generation)

System nie jest bezstanowy w kontekście wiedzy.
Przed klasyfikacją maila, system wyszukuje w Vector DB 3-5 podobnych historycznych wątków lub definicji delegatów.
Znaleziony kontekst jest "wstrzykiwany" do promptu LLM, co drastycznie zwiększa precyzję decyzji (Few-Shot Learning).

### D. Globalny Przełącznik (Auto-Send vs Draft)

Adapter Gmaila sprawdza w Config Adapter globalną flagę.
Jeśli tryb to TEST (Draft Only): Nawet jeśli Narzędzie zwróci SEND_EMAIL, Adapter zamienia to na CREATE_DRAFT i dodaje tag [AUTO-GENERATED].

### E. Batchowe Uczenie (App 3)

Proces ten nie działa w pętli eventowej obsługi maili.
Uruchamiany np. raz na dobę lub na żądanie.
Pobiera nowe, zakończone wątki, generuje dla nich embeddingi i aktualizuje indeks wektorowy, aby asystent "pamiętał" nowe ustalenia.
