//// https://gemini.google.com/app/5b19a70f56b75b8e?hl=pl

# Specyfikacja Modułu: Zarządzanie i Orkiestracja (Backend)

Moduł ten pełni funkcję centralnego węzła logicznego i warstwy API w architekturze. Jest on bezkontaktowy (nie obsługuje bezpośrednio komunikacji WhatsApp, która jest osobnym modułem) oraz bezstanowy w kontekście przetwarzania pojedynczego emaila (to robi Triage). Jego rola to agregacja, zarządzanie konfiguracją i cykliczne monitorowanie (Cron Jobs).

## 1. Zakres Odpowiedzialności (Orkiestrator)

| Obszar | Szczegóły | Status (MVP) |
| :--- | :--- | :--- |
| **API & Komunikacja** | Obsługa komunikacji (Request/Response) z Frontendem (Panel WWW) i Modułem WhatsApp. | Core |
| **Agregacja Danych** | Cykliczne generowanie raportów i podsumowań (np. raz lub trzy razy dziennie). | Core |
| **Zarządzanie Delegacjami** | Dodawanie manualnych delegacji do bazy i cykliczne monitorowanie statusów (Chaser Cron). | Core |
| **Konfiguracja** | Zarządzanie ustawieniami (włączniki, Whitelist/Blacklist, Delegaci) per podpięty adres email. | Core |
| **Health Check** | Monitorowanie statusu tokenów dostępowych do Gmail API (Token Health Monitor). | Post-MVP |
| **Wysyłka (Gmail API)** | Realizacja wysyłki wiadomości (Draft Approval, Nowy Email, Delegacja) w imieniu Executive'a. | Core |

## 2. Kluczowe Mechaniki Wdrożone

### 2.1. Wielokrotne Aliasy Email (Multi-Email Handling)

System obsługuje wiele skrzynek (aliasów) podpiętych pod jedno konto Executive'a.

*   **Pobieranie Danych:** Orkiestrator musi być w stanie pobierać dane (podsumowania, delegacje) ze wszystkich podpiętych aliasów.
*   **Wysyłanie (Reply Logic):**
    *   **Nowe Wiadomości:** Zawsze wysyłane z Głównego Adresu Email (ustawionego w konfiguracji).
    *   **Odpowiedzi / Drafty (Triage):** Zawsze wysyłane z adresu, na który przyszła wiadomość oryginalna (zachowanie kontekstu konwersacji).
*   **Konfiguracja:** Konfiguracja (Whitelist, Delegaci) jest zarządzana per podpięty adres email (z opcją przyszłej unifikacji).

### 2.2. Filtrowanie przez Asystenta Executive'a (EA Hand-Off)

Większość wiadomości wymagających uwagi jest najpierw obsługiwana przez EA (za pomocą Panelu WWW), co radykalnie redukuje powiadomienia do Prezesa.

*   **Flow:** Triage $\to$ Draft $\to$ EA Review $\to$ Executive Notification.
*   **Mechanizm:** W modelu danych (np. w tabeli `drafts` lub `action_logs`) musi istnieć pole `ea_status` (lub podobne), które pozwala EA na oznaczenie wiadomości:
    *   `EA_ACTIONED`: Opracowane przez EA (nie wysyłamy do Prezesa).
    *   `EXECUTIVE_REVIEW`: Wymaga bezpośredniego zatwierdzenia przez Prezesa.
*   **Powiadomienia:** Moduł Orkiestratora uruchamia powiadomienie do Prezesa (WhatsApp) tylko dla wiadomości oznaczonych jako `EXECUTIVE_REVIEW`.

### 2.3. Context Mapping Konwersacji Emailowej (Threading)

Aby zapewnić, że generowane przez system podsumowania i odpowiedzi są osadzone w kontekście, Orkiestrator musi zapewnić spójność wątków.

*   **Implementacja:** Podczas pobierania danych (Triage/Cron), system musi pobierać całą historię wiadomości w danym wątku (Gmail Thread ID) i udostępniać ją LLM/konsumentom API.

## 3. Finalna Lista Intencji (Intents) do Obsługi

Orkiestrator (za pośrednictwem API) musi być w stanie obsłużyć poniższe intencje, które pochodzą z języka naturalnego (WhatsApp) lub bezpośrednio z Panelu WWW.

| ID Intencji | Opis | Źródło | Moduł Docelowy |
| :--- | :--- | :--- | :--- |
| **INTENT_APPROVE_DRAFT** | Zatwierdzenie i wysłanie gotowego draftu (odpowiedzi Triage) przez Gmail API. | WhatsApp / UI | Gmail Adapter |
| **INTENT_CORRECT_DRAFT** | Odrzucenie draftu z podaniem treści do korekty, a następnie wysłanie skorygowanej wersji. | WhatsApp / UI | Gmail Adapter |
| **INTENT_DELEGATE_MANUAL** | Zlecenie zadania innej osobie (tekst/głos) i automatyczne wysłanie maila oraz zapis do tabeli delegations. | WhatsApp / UI | Delegation Tool |
| **INTENT_NEW_EMAIL** | Wysyłka nowej wiadomości (Prezes podaje treść i adresata) z Głównego Adresu. | WhatsApp / UI | Gmail Adapter |
| **INTENT_MEETING_BRIEF** | Żądanie podsumowania kontekstu do spotkania (historia maili z daną osobą/tematem). | WhatsApp / UI | RAG / Knowledge Tool |
| **INTENT_CHECK_STATUS** | Prośba o status otwartej delegacji lub grupy zadań (Sprawdzenie bazy delegations i folderu Inbox). | WhatsApp / UI | Chaser Cron / DB |
| **INTENT_GET_INFO** | Wyszukanie konkretnej informacji lub załącznika w historii maili. | WhatsApp / UI | RAG / Knowledge Tool |
| **INTENT_CONFIG_WHITELIST** | Prośba o dodanie/usunięcie adresu z Whitelisty. | WhatsApp / UI | Config Adapter |

## 4. Dodatkowe Mechaniki (Cron Jobs)

W ramach odpowiedzialności Orkiestratora za cykliczne procesy (Cron Jobs), należy zaimplementować:

*   **Chaser Cron:** Cykliczny proces sprawdzający tabelę `delegations`. Jeśli termin minął lub brak odpowiedzi od delegata, flaguje delegację do raportu lub do ręcznego monitu (zgodnie z logiką EA/Executive).
*   **Daily Report Cron:** Proces generujący zagregowane podsumowania dla wszystkich aliasów i wysyłający je w ustalonym oknie czasowym (1-3 razy dziennie).
*   **Config Cron:** Mechanizm zarządzania globalnymi przełącznikami (ON/OFF) i czasem raportowania (godzina) z poziomu Panelu WWW.