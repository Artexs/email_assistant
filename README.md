# Asystent Email AI

## Spis Treści

- [Opis Projektu](#opis-projektu)
- [Stos Technologiczny](#stos-technologiczny)
- [Uruchomienie Lokalne](#uruchomienie-lokalne)
- [Dostępne Skrypty](#dostępne-skrypty)
- [Zakres Projektu](#zakres-projektu)
- [Status Projektu](#status-projektu)
- [Licencja](#licencja)

## Opis Projektu

**Asystent Email AI** to inteligentne narzędzie zaprojektowane w celu automatyzacji i optymalizacji zarządzania skrzynką odbiorczą dla kadry kierowniczej wyższego szczebla i menedżerów (rola "Prezesa"). Celem produktu jest drastyczne skrócenie czasu poświęcanego na obsługę poczty poprzez automatyczne kategoryzowanie, delegowanie zadań, zarządzanie spamem i inteligentne podsumowywanie wątków.

System działa jako "cyfrowy asystent", który filtruje szum, obsługuje rutynowe zadania i dostarcza skondensowane podsumowania, pozwalając użytkownikowi skupić się na zadaniach strategicznych. Rozwiązuje problem nadmiaru e-maili i konieczności ręcznego sortowania, dostarczając jednocześnie pełną kontrolę nad procesem.

## Stos Technologiczny

Projekt wykorzystuje nowoczesny stos technologiczny zapewniający wydajność, skalowalność i bezpieczeństwo.

### Frontend

- **Astro:** Główny framework webowy, zapewniający wysoką wydajność i Server-Side Rendering (SSR).
- **React:** Wykorzystywany do budowy interaktywnych komponentów UI ("islands of interactivity").
- **TypeScript:** Gwarantuje statyczne typowanie, poprawiając jakość i utrzymywalność kodu.
- **Tailwind CSS:** Framework CSS typu utility-first do szybkiego i spójnego stylowania.

### Backend & Baza Danych

- **Supabase:** Platforma Backend-as-a-Service (BaaS) obsługująca uwierzytelnianie (Auth) oraz bazę danych PostgreSQL.
- **Astro API Routes:** Serverless backend endpoints do bezpiecznej komunikacji z usługami zewnętrznymi.
- **Node.js:** Środowisko uruchomieniowe dla narzędzi i serwera.

### AI & Integracje

- **OpenAI API:** Główny dostawca modeli LLM (Large Language Models).
- **Langfuse:** Narzędzie do observability i monitorowania promptów oraz wyników AI.
- **Gmail API:** Integracja do odbioru, wysyłki i zarządzania wiadomościami e-mail.
- **WhatsApp:** Kanał komunikacji z użytkownikiem (wiadomości tekstowe i notatki głosowe).

### Narzędzia Deweloperskie i Testy

- **Docker:** Konteneryzacja aplikacji zapewniająca spójność środowisk.
- **Vitest:** Framework do testów jednostkowych.
- **Playwright:** Narzędzie do testów end-to-end (E2E).
- **GitHub Actions:** Automatyzacja procesów CI/CD.

## Uruchomienie Lokalne

Aby uruchomić projekt w środowisku lokalnym, postępuj zgodnie z poniższymi krokami.

### Wymagania wstępne

- **Node.js**: Wersja `22.14.0` (zgodnie z plikiem `.nvmrc`).
- **npm**: Menedżer pakietów.

### Instalacja

1. **Sklonuj repozytorium:**

   ```bash
   git clone <adres-repozytorium>
   cd email_assistant
   ```

2. **Zainstaluj zależności:**

   ```bash
   npm install
   ```

3. **Skonfiguruj zmienne środowiskowe:**
   Utwórz plik `.env` w głównym katalogu projektu. Uzupełnij go o wymagane klucze API i konfigurację (np. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `OPENAI_API_KEY`).

4. **Uruchom serwer deweloperski:**
   ```bash
   npm run dev
   ```

Aplikacja powinna być dostępna pod adresem `http://localhost:4321`.

## Dostępne Skrypty

W pliku `package.json` zdefiniowane są następujące skrypty:

- `npm run dev`: Uruchamia lokalny serwer deweloperski Astro.
- `npm run build`: Buduje aplikację do wersji produkcyjnej.
- `npm run preview`: Uruchamia podgląd zbudowanej wersji produkcyjnej.
- `npm run lint`: Uruchamia linter (ESLint) w celu sprawdzenia jakości kodu.
- `npm run lint:fix`: Automatycznie naprawia błędy wykryte przez linter.
- `npm run format`: Formatuje kod przy użyciu Prettier.

## Zakres Projektu

Projekt w obecnej fazie **MVP (Minimum Viable Product)** koncentruje się na kluczowych funkcjonalnościach:

| Kategoria                | W zakresie (MVP)                                                                   |
| :----------------------- | :--------------------------------------------------------------------------------- |
| **Role Użytkownika**     | Rola Prezesa (Właściciel) oraz wsparcie dla EA (Executive Assistant).              |
| **Narzędzia ("Hard 6")** | Spam, Delegacja, Spotkania, Podsumowanie, Wyjaśnienie, Manual/Emergency.           |
| **Kanały Komunikacji**   | WhatsApp (Tekst/Głos) + Panel Webowy.                                              |
| **Intencje (NLU)**       | 8 kluczowych intencji (m.in. Approve Draft, Correct Draft, Delegate Manual).       |
| **Styl Komunikacji**     | Generowanie uproszczonego stylu na podstawie historii (skan ostatnich wiadomości). |

## Status Projektu

🟢 **Status: W trakcie rozwoju (MVP)**

Projekt jest aktywnie rozwijany. Obecnie trwają prace nad implementacją kluczowych modułów MVP, w tym integracji z Gmail API oraz logiki orkiestratora.

## Licencja

Projekt udostępniony na licencji MIT.
