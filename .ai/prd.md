# Product Requirements Document (PRD) - AI Email Assistant (MVP)

## 1. Product Overview

The AI Email Assistant is an intelligent tool designed to automate and optimize inbox management for high-level executives and managers (the "President" role). The product aims to drastically reduce the time spent handling email by automatically categorizing, delegating tasks, managing spam, and intelligently summarizing threads.

The goal of the MVP (Minimum Viable Product) is to deliver a functional system that takes over four key, repeatable actions, maximizing the ratio of automatically handled emails versus those requiring manual intervention.

## 2. User Problem

Executives and high-level managers dedicate an excessive amount of time to manually sorting, processing, and responding to an avalanche of incoming emails. This manual intervention distracts them from higher-value strategic and operational tasks. They require a reliable, transparent, and fully controlled tool that can filter out noise, handle routine tasks (like delegation), and deliver condensed, critical summaries while preserving their professional communication style.

## 3. Functional Requirements

### 3.1 Core Processing (Triage Orchestrator)

The system must implement a central Triage module that orchestrates the email processing flow.

- **Filtrowanie Priorytetowe:** The Triage must first check if the sender's address is on the Whitelist. Whitelisted emails have the highest priority and cannot be classified as Spam or moved to the Spam folder (a hard business rule).
- **Definicja Akcji:** The Triage programmatically defines the four available MVP actions: Spam, Delegation, Meeting Handling (limited), and Informational Summary.
- **Klasyfikacja:** After Whitelist filtering, the email is passed to the AI for classification against available actions, taking into account the current status (ON/OFF) of each action. The Whitelist's influence on other actions acts as a modifier in the AI prompt.
- **Egzekucja:** The system must execute the action that best fits the classification, provided that its individual switch is set to ON.

### 3.2 MVP Actions

The system must fully support four key actions:

- **Spam:** Move the message to the designated Spam folder.
- **Podsumowanie Informacyjne:** Generate a summary of the email content and archive the original message upon completion of the summary generation.
- **Delegacja:** Send a formatted response/forward to the designated delegate and log the action for progress tracking.
- **Obsługa Spotkań:** Limited to detecting calendar conflicts and suggesting alternative solutions.

### 3.3 Configuration Panel

The system must provide an accessible web interface for configuration management.

- **Kontrola Akcji:** The panel must contain four individual ON/OFF switches for each of the actions (Spam, Delegation, Meeting Handling, Informational Summary).
- **Kontrola Globalna:** The panel must include one main switch "Auto Send/Draft" (Wysyłanie Auto/Draft), which allows the system to either send responses automatically or only create drafts.
- **Styl Prezesa:** A simplified text form. The initial content (max 500 characters) is suggested by the AI after scanning 100 sent messages. The user must manually approve or edit it.
- **Zarządzanie Listami:** Separate CRUD (Create, Read, Update, Delete) interfaces must exist for:
  - **Whitelist:** Email addresses that bypass Spam classification.
  - **Delegates List:** Including fields for Name, Email, and Competencies.
- **Wdrożenie Nieblokujące:** The user should be able to activate the system immediately. A "Deployment Checklist" must be visible in the dashboard, encouraging configuration of optional settings (Style, Lists).

### 3.4 Communication and Auditing

- **Komunikacja Zewnętrzna:** The system must implement communication via WhatsApp (or another agreed-upon messenger) to deliver daily reports and activity summaries to the President.
- **Ręczna Obsługa (Folder):** A designated email folder named "Manual Handling" must be completely outside the system's jurisdiction. The system can move emails there but must not process them further.
- **Ręczna Delegacja:** A separate "Delegate Manually" function on the dashboard (WWW/WhatsApp) must allow the President to manually initiate a task. This function must send a formatted message with a 'delegation' tag and add it to the database for progress tracking.

## 4. Product Boundaries

| Category | Inclusions (MVP Scope) | Exclusions (Phase 2 / TODO) |
| :--- | :--- | :--- |
| **Styl Komunikacji** | Simplified style generation (scan 100 emails, one proposal). | Advanced self-learning module (Phase 2). |
| **Role Użytkownika** | Only the President (Owner) role with full privileges. | Full implementation of the Assistant role and multi-tenant schema (organizationId) (TODO). |
| **Akcje** | Four core actions: Spam, Delegation, Informational Summary, Meeting Handling (limited). | Extended Meeting Handling scenarios; handling status inquiries (TODO). |
| **Audyt/Logowanie** | Basic statistics counting (handled emails, manual emails). | Detailed logging and monitoring for developers (Audit Trail) (TODO). |

## 5. User Stories

### 5.1 Onboarding and Configuration

| ID | Title | Description | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **US-001** | **System Activation** | As a President, I want to activate the system immediately upon first login so that it automatically starts filtering without requiring full configuration. | 1. The system starts processing emails immediately after activating the main switch.<br>2. A "Deployment Checklist" is displayed, encouraging optional configuration of lists and style. |
| **US-002** | **Simplified Style Generation** | As a President, I want the system to scan my past communication and propose a single "Style Description" so that I can quickly approve and activate my personalized communication tone. | 1. The system scans the last 100 sent emails and generates one suggested "Style Description" (max 500 characters).<br>2. The President must manually approve or edit the suggested Style in the web panel before it is used for outbound communication. |
| **US-003** | **Whitelist Management** | As a President, I want to manually add/remove email addresses to a Whitelist so that I can ensure important senders are always treated as trusted. | 1. A dedicated Whitelist configuration page with a CRUD interface exists.<br>2. Any email address on the Whitelist is guaranteed not to be classified as Spam. |
| **US-004** | **Individual Action Control** | As a President, I want to have separate ON/OFF switches for each core action so that I can control exactly which parts of my inbox are automated. | 1. The Configuration Panel displays four distinct ON/OFF switches for Spam, Delegation, Meeting Handling, and Informational Summary.<br>2. The Triage Orchestrator only executes an action if its respective switch is set to ON. |
| **US-005** | **Global Sending Control** | As a President, I want to set a global control to choose between automatic sending or draft creation so that I can manage my level of risk tolerance. | 1. A global switch named "Auto Send/Draft" (Wysyłanie Auto/Draft) is available.<br>2. When set to 'Draft', any action requiring an outbound email (e.g., Delegation, Meeting Response) creates a draft instead of sending automatically. |
| **US-014** | **Authentication and Authorization** | As a President, I must securely log in to the application and maintain full administrative control over all system configurations and data. | 1. The system requires secure user authentication (e.g., standard login process).<br>2. Only the "President" role has full administrative permissions to modify Configuration, Lists, and Action Controls. |

### 5.2 Core Processing and Triage

| ID | Title | Description | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **US-006** | **Whitelist Priority** | As a President, I need the system to prioritize my Whitelist for Spam filtering so that trusted senders' emails are never incorrectly moved to the Spam folder. | 1. When an email arrives, the Triage module checks the Whitelist first.<br>2. If the sender is on the Whitelist, the Triage skips the Spam classification check.<br>3. The email cannot be moved to the Spam folder by the system. |
| **US-007** | **Informational Summary Action** | As a President, I want the system to read and summarize non-urgent, informational emails so that I can quickly grasp the content without opening the original email. | 1. If the AI classifies the email as 'Informational Summary' and the action is ON, the system generates a concise summary.<br>2. The original email is archived after the summary is generated. |
| **US-008** | **Delegation Action** | As a President, I want the system to automatically identify delegation-suitable emails and forward them to the correct delegate so that tasks are actioned quickly. | 1. If the AI classifies the email as 'Delegation' and the action is ON, the system selects the appropriate delegate based on the Delegates List/Competencies.<br>2. The system sends a formatted email/response to the delegate.<br>3. The action is logged to the database for progress tracking. |
| **US-009** | **Meeting Conflict Detection** | As a President, I want the system to detect meeting conflicts in my calendar when new meeting requests arrive and suggest solutions. | 1. If the AI classifies the email as 'Meeting Handling' and the action is ON, the system checks for existing calendar conflicts.<br>2. The system suggests potential solutions (e.g., reschedule suggestion). |
| **US-010** | **Manual Handling Folder** | As a President, I want to be able to manually move certain emails to a designated folder that the automation system will completely ignore. | 1. The system never accesses or processes emails placed in the designated "Manual Handling" folder.<br>2. The system can place an email into this folder if it's explicitly configured to do so in the workflow (e.g., unclassified). |
| **US-015** | **Multiple Action Classification** | As a President, I need the Triage to correctly prioritize and select only one action when an email could potentially match several classifications. | 1. The Triage Orchestrator must select the single best-fitting action for execution.<br>2. The Triage must check the explicit hierarchy: Whitelist check $\rightarrow$ AI Classification $\rightarrow$ Action ON/OFF status $\rightarrow$ Execute action. |

### 5.3 Reporting and Auditing

| ID | Title | Description | Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **US-011** | **Daily Activity Report (WhatsApp)** | As a President, I want to receive a daily summary of the system's actions on my preferred messenger (WhatsApp) so that I can maintain trust and transparency. | 1. The system delivers a report of daily activity via WhatsApp (or another integrated messenger).<br>2. The report must clearly state what the system did (e.g., "Handled 50 emails. 5 delegated to Finance Dept."). |
| **US-012** | **Manual Delegation Tracking** | As a President, I want to manually initiate a delegation task via the dashboard or WhatsApp and have the system track it like an automatic delegation. | 1. A "Delegate Manually" button/functionality exists on the WWW panel and is accessible via WhatsApp.<br>2. Activating this function sends a pre-formatted email/message with a 'delegation' tag.<br>3. The sent task is added to the database for tracking. |
| **US-013** | **Basic Statistics View** | As a President, I want to view basic statistics on system performance so that I can gauge the value and effectiveness of the automation. | 1. The dashboard displays basic statistics (e.g., total emails handled, number of emails moved to 'Manual Handling').<br>2. Statistics allow for measuring the key success metric (handled vs. manual intervention ratio). |

## 6. Success Metrics

| Metric | Definition | Target |
| :--- | :--- | :--- |
| **Primary Goal** | Maximization of automatic handling. Ratio of emails automatically handled (by the system) to emails requiring manual intervention (moved to "Manual Handling" folder). | 90% of all incoming emails are handled automatically (Spam, Delegation, Summary, Meeting) within 30 days of configuration. |
| **Accuracy (Whitelist)** | Percentage of correct Spam classification for addresses on the Whitelist. | 100% accuracy (Hard Business Rule). |
| **Time to Value (TTV)** | Time from system activation to the first successfully delegated or summarized email. | Less than 1 hour. |
| **Engagement (Auditing)** | Daily activity report viewing rate via external messenger. | $\geq 80\%$ daily views of the WhatsApp/Messenger report. |
