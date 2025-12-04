//// https://gemini.google.com/app/c2da5a241436e551?hl=pl

# 📝 Finalny Dokument Wynikowy: Moduł Frontend/UI

Poniżej przedstawiam ustrukturyzowany dokument wynikowy, zawierający wszystkie ustalenia dotyczące logiki biznesowej Modułu UI w wersji MVP.

## 1. 🖥️ Nagłówek Modułu: Panel Kontrolny Executive'a (Frontend/UI)

- **Nazwa:** Panel Konfiguracyjny Asystenta AI
- **Krótki Opis:** Webowy interfejs użytkownika służący do zarządzania globalną konfiguracją systemu, ustawieniami osobistego stylu i monitorowaniem statusu kluczowych delegacji.
- **Główny Cel Biznesowy:** Stanowić centrum kontroli nad zachowaniem AI, zapewniając Prezesowi transparentność i poczucie kontroli nad automatyzacją.

## 2. 📐 Diagram Architektury (Mermaid)

Wizualizacja Modułu UI i jego interakcji z głównymi modułami Backendu.

```mermaid
graph TD
    subgraph UI [Frontend/UI: Panel Konfiguracyjny]
        A[Dashboard: Status Delegacji]
        B[Konfiguracja: Włączniki/Styl]
        C[Zarządzanie Listami]
        D[Sekcja Konta (OPTIONAL)]
    end

    subgraph Backend [Backend]
        E(Orchestrator API & Config Adapter)
        F(Triage: Logika Biznesowa)
        G(Brain: Kontekst & Styl)
        H(Delegations DB)
    end

    UI -->|REST/TRPC| E
    E -->|Write/Read| G
    E -->|Write/Read| H
    A -->|Read Status/Delegations| H
    B -->|Write Config| G
    C -->|Write/Read Lists| G
    D -->|Auth/Token Management| Supabase(Supabase Auth)
    E <-- F
```

## 3. ⚙️ Szczegółowy Opis Funkcjonalności

| Funkcjonalność                | Abstrakcyjny Opis                                                                                                | Cel Biznesowy                                                                                  | Kategoria  | 2-3 Kluczowe Edge Case'y                                                                                                                                                            |
| :---------------------------- | :--------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- | :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard Status**          | Główny widok prezentujący status kluczowych zadań delegowanych. Nie zawiera statystyk ani pełnej historii logów. | Natychmiastowa identyfikacja ryzyka braku realizacji zadania.                                  | [MVP]      | 1. Termin delegacji jest po terminie, ale Delegat manualnie odpowiedział Prezesowi w Gmailu (Status w DB musi być aktualny).                                                        |
| **Włączniki Narzędzi**        | Lista wszystkich automatycznych akcji (np. Auto-Delegacja, Auto-Summary) z binarnymi przełącznikami ON/OFF.      | Zapewnienie Prezesowi natychmiastowej, granularnej kontroli nad agresywnością AI.              | [MVP]      | 1. Prezes wyłącza Auto-Delegacja przez UI, ale komenda z WhatsAppa próbuje ją włączyć (System musi zastosować najnowszą zmianę).                                                    |
| **Edytor Stylu Prezesa**      | Pole tekstowe do ręcznej edycji aktywnego promptu systemowego, na którym AI bazuje do generowania odpowiedzi.    | Umożliwienie Prezesowi kalibracji tonu komunikacji bez konieczności interwencji dewelopera.    | [MVP]      | 1. Wprowadzenie dłuższego opisu (limit 1000 znaków) - UI musi egzekwować limit.<br>2. Pole jest puste (System musi albo użyć wartości domyślnej, albo UI musi wymusić wypełnienie). |
| **Zarządzanie Delegatami**    | Tabela do manualnego dodawania, edytowania i usuwania Delegatów (email + obowiązkowe pole Kompetencje/Kontekst). | Zapewnienie wysokiej jakości danych kontekstowych dla Modułu Triage.                           | [MVP]      | 1. Próba dodania własnego adresu email Prezesa jako Delegata (UI musi zablokować).<br>2. Dodanie Delegata bez wypełnienia pola Kompetencje (UI musi zablokować zapis).              |
| **Zarządzanie Whitelistą**    | Tabela do manualnego dodawania i usuwania adresów priorytetowych.                                                | Ochrona przed klasyfikacją kluczowych kontaktów jako spam (Hard Business Rule: 100% Accuracy). | [MVP]      | 1. Próba usunięcia kluczowego inwestora (UI musi prosić o potwierdzenie).<br>2. Dodanie błędnie sformatowanego adresu email (UI musi walidować format).                             |
| **Onboarding Status**         | Wskaźnik i przycisk do podpięcia Konta Gmail i WhatsApp.                                                         | Zapewnienie Minimalnej Wymaganej Konfiguracji do uruchomienia systemu.                         | [MVP]      | 1. Token Gmaila wygasł (UI musi wyświetlić czerwony status i przycisk 'Odnów Autoryzację').                                                                                         |
| **Sekcja Zarządzania Kontem** | Osobny widok do obsługi logowania, tokenów dostępowych, zmiany hasła i usuwania konta.                           | Zapewnienie ostatecznej kontroli i możliwości dezinstalacji/pauzy systemu.                     | [OPTIONAL] | 1. Usuwanie konta (wymaga dwustopniowej weryfikacji ze względu na nieodwracalność).                                                                                                 |

## 4. 🚀 Lista Zidentyfikowanych Wymagań (Nowe/Zmienione)

- **Reaktywność Konfiguracji (Sync):** UI musi aktywnie odświeżać i wyświetlać aktualną konfigurację z bazy, aby odzwierciedlać zmiany wprowadzone przez Asystenta WhatsApp.
- **Walidacja Adresów:** W UI musi być zaimplementowana walidacja blokująca dodanie głównego adresu email Prezesa do Listy Delegatów.
- **Wymuszenie Kontekstu Delegata:** Pola "Kompetencje/Kontekst" dla każdego Delegata muszą być obowiązkowe w UI.
- **Uproszczona Kontrola Usunięcia:** Operacja usuwania adresu z Whitelisty musi wymagać potwierdzenia modalem.

## 5. ✨ Lista Ulepszeń (Post-MVP)

- **Audit Trail (Logi Systemowe):** Dodanie uproszczonego, czytelnego widoku "Historii Akcji", aby budować zaufanie (np. "10:05 - Delegacja do Ani").
- **Przycisk Monit/Chaser:** Dodanie przycisku "Wyślij Monit" obok delegacji, aby natychmiast wysłać przypomnienie do Delegata (akcja wywoływana przez Orchestrator/Asystenta).
- **Wskaźnik Aktywności Brain:** Mały, nieinwazyjny wskaźnik informujący o dacie ostatniej aktualizacji modelu/stylu.
- **Zaawansowany Import List:** Możliwość importu list Delegatów i Whitelisty z pliku CSV lub prostego wklejenia tekstu, co usprawni onboarding.
