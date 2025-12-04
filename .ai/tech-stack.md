# Tech Stack

This document outlines the core technologies used in the AI email assistant project.

## Frontend

- **Astro:** The primary web framework. Used for its content-focused architecture, server-side rendering capabilities, and high performance. It acts as the orchestrator for the entire frontend.
- **React:** Used for building interactive UI components ("islands of interactivity"). Specifically for features like the flashcard review grid, the study module, and other dynamic user interface elements.
- **TypeScript:** Provides static typing for all JavaScript code, improving code quality, maintainability, and developer experience.
- **Tailwind CSS:** A utility-first CSS framework used for rapidly styling the application. It allows for building custom designs without writing traditional CSS.

## Backend & Database

- **Supabase:** The all-in-one backend-as-a-service (BaaS) platform.
  - **Supabase Auth:** Manages all user authentication, including sign-up, login, password reset, and email verification.
  - **Supabase Database:** A managed PostgreSQL database used to store all user data and flashcard content. It leverages Row Level Security (RLS) to ensure data privacy.
- **Astro API Routes:** Used to create serverless backend endpoints for handling specific tasks, most importantly for securely communicating with the external AI service to generate flashcards.

## AI

- **External AI Service (TBD):** An external API (e.g., OpenAI's GPT series, Google's Gemini) will be called from a secure backend route to perform the core function of generating questions and answers from user-provided text.

## Development & Tooling

- **Node.js:** The runtime environment for Astro and all related tooling.
- **ESLint & Prettier:** Used for code linting and formatting to ensure a consistent and high-quality codebase.

## Testing

- **Vitest:** Used for running unit tests.
- **Playwright:** Used for end-to-end testing in a real browser environment.

## CI/CD and Deployment

- **GitHub Actions:** Used to orchestrate the CI/CD workflows for automated testing and deployment.
- **Docker:** Used for containerizing the application to ensure consistent environments.
- **GitHub Container Registry (ghcr.io):** Used as a private registry to store Docker images.
- **Tailscale:** Provides secure networking for the deployment process, allowing the GitHub Actions runner to connect to the production server.

## AI Integration

- **OpenAI API** — główny dostawca LLM (bezpośrednie połączenie przez middleware).
- **Langfuse** — observability / trace promptów i wyników LLM (monitoring).

## Communication Modules

- **Gmail API** — odbiór, pobieranie załączników, tworzenie draftów, etykiety.
- **SMTP / Nodemailer** — uniwersalna wysyłka email (fallback).

## Middleware & Microservices

- **Microservices (Node/TypeScript)**:
- **Docker Compose** — uruchamianie lokalne wszystkich serwisów (Redis, workers, app services).

## Monitoring

- **(placeholder)** — Monitoring / logging - to be defined.
