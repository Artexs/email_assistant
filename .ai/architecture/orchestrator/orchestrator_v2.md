# Specyfikacja Techniczna: Moduł Zarządzania (Orkiestrator) v1.0

**Rola:** Centralny Backend & API Gateway
**Typ:** Modularny Monolit (Node.js / TypeScript)
**Architektura:** Headless, Event-Driven, Multi-Tenant (User + Aliases)

## 1. Podsumowanie Biznesowe i Architektoniczne

Moduł Orkiestratora to "mózg operacyjny" systemu, który nie posiada własnego interfejsu konwersacyjnego (tę rolę pełni oddzielny Moduł WhatsApp), ale zarządza stanem całego systemu. Oddziela on warstwę przetwarzania masowego (Triage) od warstwy interakcji z człowiekiem.

Kluczowe zmiany architektoniczne w wersji v1.0:

*   **Architektura Multi-Email:** System obsługuje strukturę 1 User -> N Email Accounts. Każdy mail, draft i delegacja są ściśle powiązane z konkretnym kontem pocztowym (aliasem).
*   **Filtr EA (Executive Assistant Hand-Off):** Wprowadzenie workflow, w którym drafty i akcje trafiają najpierw do weryfikacji przez EA (Panel WWW). Tylko oflagowane zdarzenia (EXECUTIVE_REVIEW) są pushowane do Modułu WhatsApp.
*   **Headless Intent Execution:** Orkiestrator wystawia API do wykonywania konkretnych intencji biznesowych (np. APPROVE_DRAFT, MEETING_BRIEF), które są wywoływane przez Moduł WhatsApp lub Frontend.

## 2. Diagram Architektury Systemu (C4 Level 2 - Container)

Diagram przedstawia centralną rolę Orkiestratora oraz przepływ danych uwzględniający EA i Multi-Email.

```mermaid
graph TD
    subgraph "Warstwa Zewnętrzna"
        WA_Service[Moduł WhatsApp<br/>(Interface & Intent Parser)]
        Frontend[Frontend App<br/>(Panel EA / Exec)]
    end

    subgraph "Core Backend (Orkiestrator)"
        API_Gateway[API Gateway / Router]
        
        subgraph "Logic Services"
            IntentHandler[Intent Executor Service]
            MultiEmailManager[Multi-Email Logic]
            EAFlowManager[EA Hand-off Logic]
            ContextEngine[Context & Threading Engine]
        end
        
        subgraph "Cron Jobs"
            ChaserCron[Chaser Cron<br/>(Monitor Delegacji)]
            ReportCron[Daily Report Cron<br/>(Agregacja)]
        end
    end

    subgraph "Persistence & Infrastructure"
        DB[(Supabase PostgreSQL)]
        Gmail_Adapter[Gmail Adapter]
        LLM_Service[OpenAI Service<br/>(RAG & Generation)]
    end

    %% Przepływy
    WA_Service -->|REST: Execute Intent| API_Gateway
    Frontend -->|REST: Manage Config/Drafts| API_Gateway
    
    API_Gateway --> IntentHandler
    API_Gateway --> EAFlowManager
    
    IntentHandler --> MultiEmailManager
    IntentHandler --> ContextEngine
    IntentHandler --> LLM_Service
    
    MultiEmailManager --> Gmail_Adapter
    MultiEmailManager --> DB
    
    EAFlowManager --> DB
    
    ChaserCron --> DB
    ChaserCron --> WA_Service
    ReportCron --> DB
    ReportCron --> WA_Service

    %% Relacje Danych
    ContextEngine -.->|Fetch Thread History| Gmail_Adapter
    ContextEngine -.->|Read| DB
```

## 3. Szczegółowa Specyfikacja Implementacyjna

### 3.1. Model Danych (PostgreSQL / Supabase)

Schemat bazy danych musi obsługiwać relację jeden-do-wielu dla kont email oraz statusy review dla EA.

#### A. Tabela email_accounts (Nowa)

Służy do obsługi Multi-Email.

*   `id`: UUID (PK)
*   `user_id`: UUID (FK -> users)
*   `email_address`: String (np. "jan@firma.pl")
*   `is_primary`: Boolean (Domyślny adres do wysyłki nowych wiadomości)
*   `access_token_status`: Enum (VALID, EXPIRED) - podwalina pod Health Check.

#### B. Tabela emails (Rozszerzenie tabeli Triage)

Tabela przechowująca wiadomości.

*   `account_id`: UUID (FK -> email_accounts) [CRITICAL]
*   `thread_id`: String (Gmail Thread ID) - do grupowania wątków.
*   `message_id`: String (Unique Gmail ID).
*   `ea_review_status`: Enum (PENDING_EA, EA_APPROVED, REQ_EXEC_REVIEW, ARCHIVED)
    *   `PENDING_EA`: Domyślny stan po Triage. Czeka na EA.
    *   `REQ_EXEC_REVIEW`: EA zaznaczył "Wyślij do Prezesa na WhatsApp".

#### C. Tabela delegations (Delegacje)

*   `id`: UUID (PK)
*   `source_email_id`: UUID (FK -> emails)
*   `account_id`: UUID (FK -> email_accounts)
*   `assigned_delegate_email`: String
*   `status`: Enum (CREATED, SENT, IN_PROGRESS, COMPLETED, OVERDUE)
*   `due_date`: Timestamp
*   `last_chase_at`: Timestamp (Kiedy ostatnio system upominał się o zadanie).

#### D. Tabela configurations (Konfiguracja per konto)

*   `id`: UUID
*   `account_id`: UUID (FK -> email_accounts)
*   `key`: String (np. "whitelist_domains", "auto_send_enabled")
*   `value`: JSONB

### 3.2. Interfejsy API (Kontrakty Wewnętrzne)

Orkiestrator wystawia endpointy dla Modułu WhatsApp (Machine-to-Machine) oraz Frontendu.

#### Endpoint: `POST /api/intents/execute`

Główny punkt wejścia dla Modułu WhatsApp. Przyjmuje ustrukturyzowaną intencję.

**Payload:**

```json
{
  "intent": "APPROVE_DRAFT",
  "user_phone": "+48600100200",
  "payload": {
    "draft_id": "draft_xyz_123", // Opcjonalne, jeśli kontekst jest znany
    "context_id": "last_notification_id" // Do mapowania odpowiedzi
  }
}
```

**Obsługiwane Intencje (Business Logic Mapping):**

*   **INTENT_APPROVE_DRAFT**
    *   **Logika:** Pobierz draft z DB -> Sprawdź account_id -> Użyj Gmail Adapter dla tego konta -> Wyślij -> Zmień status w DB na SENT.
    *   **Context:** Jeśli draft_id brak, pobierz ostatni draft o statusie REQ_EXEC_REVIEW wysłany do tego usera.

*   **INTENT_CORRECT_DRAFT**
    *   **Logika:** Pobierz draft -> Aktualizuj treść w Gmail (Draft Update) -> Zostaw status REQ_EXEC_REVIEW (lub wyślij, jeśli intencja to "Popraw i wyślij").

*   **INTENT_DELEGATE_MANUAL**
    *   **Logika:**
        1.  Rozpoznaj delegata (Proste matchowanie po delegates_list w configu konta Primary).
        2.  Utwórz draft maila z account_id = Primary Account.
        3.  Dodaj wpis do delegations (status: CREATED).
        4.  Zwróć potwierdzenie.

*   **INTENT_MEETING_BRIEF**
    *   **Logika (RAG):**
        1.  Pobierz nadchodzące spotkania (Calendar Adapter).
        2.  Dla każdego uczestnika pobierz ostatnie 5 wątków z emails (dla wszystkich account_id usera).
        3.  Wyślij do LLM z promptem: "Stwórz notatkę kontekstową".
        4.  Zwróć tekst do WhatsApp.

*   **INTENT_CHECK_STATUS**
    *   **Logika:**
        1.  `SELECT * FROM delegations WHERE status != COMPLETED`.
        2.  Sprawdź Inbox pod kątem nowych maili od delegatów (matchowanie po temacie/wątku).
        3.  Wygeneruj raport.

### 3.3. Logika Biznesowa i Algorytmy

#### A. Multi-Email Sending Logic (Algorytm Wyboru Nadawcy)

Przy każdej wysyłce (Draft/Reply/New), system musi zdecydować, którego konta Gmail użyć (auth_token).

```typescript
function resolveSenderAccount(context: EmailContext): AccountID {
  if (context.type === 'REPLY' || context.type === 'FORWARD') {
    // CRITICAL: Zachowaj ciągłość wątku.
    // Jeśli mail przyszedł na 'priv@...', odpisz z 'priv@...'
    return context.originalMessage.recipient_account_id;
  }
  if (context.type === 'NEW_MESSAGE' || context.type === 'MANUAL_DELEGATION') {
    // Użyj głównego konta zdefiniowanego w ustawieniach
    return db.accounts.find(acc => acc.is_primary === true).id;
  }
}
```

#### B. EA Hand-Off Workflow (Filtr Powiadomień)

Orkiestrator nie wysyła "wszystkiego" do WhatsApp.

1.  **Triage/Ingest:** Nowy draft ma status `ea_review_status = 'PENDING_EA'`.
2.  **Frontend (EA):** EA widzi listę PENDING.
3.  **Klik "Zatwierdź/Wyślij"** -> Zmienia na SENT (Prezes nawet nie widzi).
4.  **Klik "Zapytaj Prezesa"** -> Zmienia na REQ_EXEC_REVIEW.
5.  **Trigger DB:** Zmiana statusu na REQ_EXEC_REVIEW wyzwala event -> `WhatsAppService.sendNotification(draft)`.

#### C. Context Mapping (Threading)

Podczas generowania podsumowań (Intent: Meeting Brief / Get Info), system nie może polegać tylko na jednym mailu.

*   **Wymaganie:** Pobranie pełnego `threadId` z Gmail API.
*   **Scalanie:** Konkatenacja treści wszystkich wiadomości w wątku (chronologicznie) przed wysłaniem do LLM w celu podsumowania.

### 3.4. Cron Jobs (Procesy w tle)

#### 1. Chaser Cron (Co 1h)

*   **Cel:** Wykrywanie "zwisających" delegacji.
*   Pobiera delegacje gdzie status IN (SENT, IN_PROGRESS) AND due_date < NOW().
*   Sprawdza, czy w tabeli emails pojawiła się odpowiedź w tym wątku (thread_id).
*   Jeśli **BRAK** odpowiedzi -> Generuje alert dla EA (lub Prezesa, zależnie od configu).
*   Jeśli **JEST** odpowiedź (ale status wciąż nie COMPLETED) -> LLM analizuje treść odpowiedzi (czy to "Zrobione" czy "Zaraz zrobię") i sugeruje update statusu.

#### 2. Daily Report Cron (np. 08:00 i 16:00)

*   **Cel:** Agregacja pracy ze wszystkich kont.
*   Iteruje po wszystkich `email_accounts` usera.
*   Agreguje statystyki: `count(processed)`, `count(spam)`, `count(delegated)`.
*   Generuje listę "High Priority Pending" (rzeczy z REQ_EXEC_REVIEW które wiszą).
*   Wysyła jeden zbiorczy payload do Modułu WhatsApp.

### 3.5. Zależności Zewnętrzne i Biblioteki

*   **Gmail API (googleapis):**
    *   Scope: `https://www.googleapis.com/auth/gmail.modify` (Potrzebne do czytania, wysyłania i zarządzania etykietami/draftami).
    *   Kluczowe: Obsługa odświeżania tokenów (Refresh Token) dla wielu kont.
*   **OpenAI API (langchain / openai):**
    *   Model: `gpt-4o` (rekomendowany do analizy kontekstu i generowania briefów).
    *   Wykorzystanie: Meeting Briefs, Chaser Logic (analiza sentymentu odpowiedzi).
*   **Moduł WhatsApp (Internal HTTP):**
    *   Orkiestrator traktuje go jako "Dumb Pipe" – wysyła gotowy tekst/JSON do wyświetlenia.

### 3.6. Bezpieczeństwo i Edge Cases

*   **Izolacja Danych:** Każde zapytanie do DB musi uwzględniać `user_id`. W architekturze Multi-Email, zapytania muszą być typu `WHERE account_id IN (user_accounts)`.
*   **Rate Limiting (WhatsApp):** Orkiestrator implementuje "Debounce" dla powiadomień REQ_EXEC_REVIEW. Jeśli w ciągu 5 minut wpadną 3 prośby, są one grupowane w jedną wiadomość WhatsApp ("Masz 3 nowe drafty do akceptacji").
*   **Błąd Tokena Gmail:** Jeśli GmailAdapter zwróci błąd autoryzacji dla jednego z kont -> Orkiestrator flaguje konto jako `access_token_status = EXPIRED` i wysyła ALERT KRYTYCZNY do Panelu EA (WhatsApp opcjonalnie). System kontynuuje pracę dla pozostałych kont.