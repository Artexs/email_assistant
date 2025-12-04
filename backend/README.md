# AI Email Assistant - Backend

## Overview

This is the backend repository for the **AI Email Assistant**, an intelligent tool designed to automate and optimize inbox management for executives and managers. The system aims to drastically reduce time spent on email handling by automatically categorizing, delegating, managing spam, and summarizing threads.

Currently, this project is structured as a **modular monolith** within a single Node.js package, with clear boundaries between domains to facilitate a future migration to a microservices architecture.

## Architecture & Modules

The backend is composed of several core modules, each responsible for a specific domain of the application:

### 1. Orchestrator (`src/orchestrator`)

The central logic hub responsible for:

- Aggregating data and managing configuration.
- Handling cyclic processes (Cron Jobs) like Daily Reports and Chaser Crons.
- Managing the "EA Hand-Off" workflow (Triage -> Draft -> EA Review -> Executive Notification).
- Interfacing with the Gmail API for sending messages.

### 2. Triage Engine (`src/triage`)

The decision-making engine that classifies incoming messages:

- Uses context-aware weights (VIP status, Sender history) to classify emails.
- Executes tools based on classification:
  - **Spam Tool**: Moves noise to spam/trash.
  - **Delegation Tool**: Identifies tasks and drafts delegation emails.
  - **Meeting Tool**: Detects meeting requests and checks for calendar conflicts.
  - **Summary Tool**: Generates "knowledge pills" for informational emails.

### 3. Mental Model (`src/mental_model`)

The "Brain" of the system, responsible for maintaining the user's digital persona:

- **Cold Start**: Analyzes email history to build an initial style profile.
- **Feedback Loop**: Learns from manual corrections and edits to drafts to refine the style model.
- **Knowledge Base**: Maintains trust scores and competence tags for contacts.

### 4. AI Assistant (`src/assistant`)

The interface gateway for user interaction (via WhatsApp/Voice):

- Handles NLU (Natural Language Understanding) to identify user intents.
- Manages the conversation flow and "Human in the Loop" safety logic.
- Processes voice notes for quick delegation.

## Tech Stack

- **Runtime**: Node.js (managed with **Bun**)
- **Language**: TypeScript
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI API (LLM), Langfuse (Observability)
- **Integrations**: Gmail API, WhatsApp (via provider)
- **Tooling**: ESLint, Prettier

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.0 or later)
- Node.js (v20 or later recommended)
- Supabase CLI (for local development)

### Installation

```bash
# Install dependencies
bun install
```

### Running the Project

```bash
# Run in development mode
bun run dev

# Build for production
bun run build

# Run production build
bun run start
```

### Linting & Formatting

```bash
# Run linting
bun run lint

# Run formatting
bun run format
```

## Future Roadmap

While currently implemented as a single service, the architecture is designed to be split into independent microservices:

- **Orchestrator Service**
- **Triage Service**
- **Mental Model Service**
- **Gateway/Assistant Service**

This separation will allow for independent scaling and deployment of each component in the future.
