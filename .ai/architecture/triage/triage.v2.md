Specyfikacja Techniczna: Triage Orchestrator Module

Wersja: 2.0 (Ready for Dev)
Autor: Senior Technical Lead
Status: Do Implementacji
Data: 2024-06-15

1. Podsumowanie Wykonawcze (Executive Summary)

Moduł Triage Orchestrator to bezstanowy proces backendowy (uruchamiany przez Worker/Cron), odpowiedzialny za klasyfikację przychodzących wiadomości email i podejmowanie natychmiastowych akcji.

System działa w modelu "Fire & Forget" dla akcji zewnętrznych (np. tworzenie draftu w Gmailu), ale zachowuje Pełną Spójność Danych (Data Consistency) wewnątrz systemu poprzez transakcyjne zapisy do bazy danych.

Kluczowa Zmiana w v2.0:
Narzędzie DelegationTool nie tylko loguje zdarzenie, ale tworzy nową encję biznesową w tabeli delegations. Pozwala to oddzielić historię techniczną (co system zrobił) od stanu biznesowego (jakie zadania są otwarte).

2. Architektura Przepływu Danych (Zaktualizowany Mermaid)

Diagram uwzględnia specyficzną ścieżkę dla Delegacji (zapis do dwóch tabel) oraz obsługę wag dla AI.

graph TD
    %% Wejście
    Input[Cron / Webhook] --> Fetch[Pobierz Email (Gmail API)]
    Fetch --> DB_Lookups[(DB: Whitelista & Config)]
    
    %% Analiza Kontekstowa
    DB_Lookups --> ContextBuilder[Budowanie Kontekstu + Wagi]
    ContextBuilder --> SwitchType{Typ Nadawcy}
    
    %% Ścieżka Szybka (Block)
    SwitchType -->|Blocked| ToolSpam[Narzędzie: Spam]
    
    %% Ścieżka AI
    SwitchType -->|VIP / Team / Unknown| AI_Process[LLM Classifier (OpenAI)]
    AI_Process --> Validator{Confidence > 70%?}
    
    %% Walidacja
    Validator -->|Nie| ToolManual[Narzędzie: Manual Review]
    Validator -->|Tak| Router{Router Kategorii}
    
    %% Narzędzia
    Router -->|STRATEGIC| ToolPriority[Narzędzie: Priorytet]
    Router -->|MEETING| ToolMeeting[Narzędzie: Spotkania]
    Router -->|INFO| ToolSummary[Narzędzie: Podsumowanie]
    Router -->|NOTIFICATIONS| ToolArchive[Narzędzie: Auto-Archiwizacja]
    Router -->|SPAM| ToolSpam
    
    %% Narzędzie Delegacji (Złożone)
    Router -->|OPERATIONAL / ADMIN| ToolDelegation[Narzędzie: Delegacja]
    
    %% Egzekucja (Gmail)
    ToolPriority --> G_Label[Gmail: Label 'VIP']
    ToolMeeting --> G_DraftM[Gmail: Draft Odpowiedzi]
    ToolSummary --> G_ArchS[Gmail: Archive]
    ToolArchive --> G_ArchA[Gmail: Mark Read + Archive]
    ToolSpam --> G_Trash[Gmail: Trash]
    ToolManual --> G_LabelM[Gmail: Label 'Review']
    
    %% Egzekucja Delegacji (Gmail)
    ToolDelegation --> G_DraftD[Gmail: Draft Delegacji]
    
    %% Zapis do Bazy Danych (Transakcje)
    G_Label --> LogDB
    G_DraftM --> LogDB
    G_ArchS --> LogDB
    G_ArchA --> LogDB
    G_Trash --> LogDB
    G_LabelM --> LogDB
    
    %% Specjalny Zapis dla Delegacji
    G_DraftD --> TransakcjaDelegacji[Transakcja DB]
    TransakcjaDelegacji --> LogDB[Tabela: action_logs]
    TransakcjaDelegacji --> DelegDB[Tabela: delegations]
    
    LogDB --> End((Koniec Procesu))


3. Specyfikacja Implementacyjna

3.1. Model Danych (Supabase / PostgreSQL)

Wymagane są następujące tabele i struktury. Typy danych w formacie PostgreSQL.

A. action_logs (Audit Trail)

Główna tabela logująca każdą decyzję Triage'u.

id: UUID (Primary Key)

email_id: String (ID wiadomości z Gmaila, unikalne)

category: Enum (STRATEGIC, OPERATIONAL, ADMIN, INFO, NOTIFICATIONS, NOISE, MANUAL_REVIEW)

confidence_score: Float (0.0 - 1.0)

action_taken: String (np. "DRAFT_CREATED", "ARCHIVED", "MOVED_TO_SPAM")

tool_used: String (np. "DelegationTool", "SummaryTool")

metadata: JSONB (Pełny dump decyzji AI, powód klasyfikacji, użyte tokeny)

created_at: Timestamp

B. delegations (Encje Biznesowe)

Tabela przechowująca aktywne procesy delegacji. Wypełniana tylko przez DelegationTool.

id: UUID (Primary Key)

source_email_id: String (FK do Gmail ID)

status: Enum (DRAFT_CREATED, SENT, IN_PROGRESS, COMPLETED) - Inicjalnie: DRAFT_CREATED

assigned_to_email: String (Email delegata wyznaczony przez AI)

generated_draft_id: String (ID draftu w Gmailu - do późniejszego sprawdzania czy wysłano)

task_summary: Text (Krótki opis zadania wygenerowany przez AI)

priority: Enum (HIGH, NORMAL, LOW)

created_at: Timestamp

C. whitelist_rules (Konfiguracja)

email: String (Unique)

type: Enum (VIP, TEAM, BLOCKED, FINANCE)

weight_modifier: Float (np. 1.5 dla VIP - podbija szansę na kategorię STRATEGIC)

3.2. Interfejsy Systemowe (TypeScript)

Definicje typów dla komunikacji wewnątrz backendu.

// Wynik działania AI (Structured Output z OpenAI)
interface TriageAnalysisResult {
  category: 'STRATEGIC' | 'OPERATIONAL' | 'ADMIN' | 'INFO' | 'NOTIFICATIONS' | 'NOISE';
  confidence: number; // 0.0 - 1.0
  reasoning: string; // Dlaczego taka decyzja?
  suggested_action: {
    tool: 'DELEGATION' | 'SUMMARY' | 'MEETING' | 'ARCHIVE' | 'SPAM';
    payload?: {
      delegate_email?: string; // Dla Delegacji
      task_description?: string; // Dla Delegacji
      summary_text?: string; // Dla Podsumowań
      meeting_proposal?: string; // Dla Spotkań
    };
  };
}

// Interfejs Narzędzia (Strategy Pattern)
interface ITriageTool {
  name: string;
  execute(email: GmailMessage, analysis: TriageAnalysisResult): Promise<ToolExecutionResult>;
}

interface ToolExecutionResult {
  success: boolean;
  actionLog: ActionLogEntry; // Dane do tabeli action_logs
  delegationData?: DelegationEntry; // Opcjonalne dane do tabeli delegations
}


3.3. Algorytmy i Logika Biznesowa

Krok 1: Budowanie Promptu (Context Injection)

Prompt systemowy musi dynamicznie przyjmować zmienne.

Input: Treść maila + Metadane nadawcy (z tabeli whitelist_rules).

Logic:

Jeśli nadawca jest VIP -> Dodaj instrukcję: "Sender is critical stakeholder. Bias towards STRATEGIC category."

Jeśli nadawca jest TEAM -> Dodaj instrukcję: "Sender is internal team. Look for requests/reports (OPERATIONAL)."

Krok 2: Klasyfikacja AI (LLM Call)

Użyj modelu z obsługą JSON Mode (np. GPT-4o lub GPT-3.5-Turbo).

Zdefiniuj Zod Schema zgodny z TriageAnalysisResult.

Krok 3: Router i Bezpiecznik (Safety Guardrail)

if (analysis.confidence < 0.70) {
  return executeManualReviewTool(email);
}
// Switch case po analysis.category


Krok 4: Logika Narzędzia Delegacji (Kluczowa Zmiana)

Narzędzie DelegationTool wykonuje sekwencję:

Gmail API: Utwórz draft (users.messages.drafts.create).

To: analysis.suggested_action.payload.delegate_email

Subject: Fwd: ${original_subject}

Body: Wygenerowana instrukcja + Oryginalna treść (cytowana).

Pobierz ID Draftu: API zwraca draft.id.

DB Transaction (Supabase):

INSERT INTO action_logs (...)

INSERT INTO delegations (status='DRAFT_CREATED', generated_draft_id=draft.id, ...)

Commit. (Jeśli insert do DB się nie uda, należy spróbować usunąć draft lub zalogować błąd krytyczny).

Krok 5: Obsługa Notifications (Agresywna)

Dla kategorii NOTIFICATIONS:

Wywołaj users.messages.batchModify: dodaj Label PROCESSED, usuń Label INBOX (Archiwizacja).

Nie generuj podsumowania, chyba że treść zawiera słowa kluczowe: Error, Failed, Overdue.

3.4. Zależności i Obsługa Błędów

Gmail API Limits: Implementacja Exponential Backoff przy błędach 429.

OpenAI Timeout: Timeout ustawiony na 10s. W przypadku timeoutu -> Fallback do ManualTool.

Transakcyjność: Użycie Supabase RPC lub klienta transakcyjnego, aby zapewnić, że wpis w delegations powstanie zawsze, gdy powstanie log w action_logs dla tego typu akcji.

3.5. Bezpieczeństwo

Sanityzacja Danych: Przed wysłaniem treści maila do OpenAI, usuń wrażliwe wzorce (opcjonalnie, w zależności od polityki prywatności - dla MVP zakładamy zaufanie do OpenAI Enterprise/Zero Retention).

Drafts only: Upewnij się, że Global Config flag (Auto-Send) jest sprawdzany. W MVP zawsze Draft, ale kod musi być gotowy na przełączenie.

4. Zadania dla Developerów (Checklista)

[ ] Stworzyć migracje DB dla tabel action_logs i delegations.

[ ] Zaimplementować GmailService (wrapper na Google API).

[ ] Zaimplementować OpenAIService ze strukturalnym outputem (Zod).

[ ] Napisać logikę DelegationTool z podwójnym zapisem do DB.

[ ] Skonfigurować CronJob wywołujący Triage co 5 minut.

[ ] Dodać obsługę błędów (try-catch) z powiadomieniem na konsolę/Sentry.