# Dokumentacja Modułu: Inicjalizacja i Aktualizacja Konfiguracji (The "Brain")

## 1. Opis i Cel Biznesowy

Moduł backendowy odpowiedzialny za budowę i ciągłe utrzymanie "Cyfrowego Modelu Mentalnego" Prezesa. Jego celem jest automatyczne tworzenie bazy wiedzy o kontaktach (kim są) i stylu komunikacji (jak do nich pisać) na podstawie historii mailowej oraz bieżących obserwacji manualnych interwencji użytkownika. Moduł nie posiada własnego interfejsu użytkownika – jest dostawcą danych dla modułu Triage i API.

## 2. Architektura Przepływu Danych

```mermaid
graph TD
    subgraph "Źródła Danych (Gmail/IMAP)"
        Inbox[Skrzynka Odbiorcza]
        Sent[Folder Wysłane]
        Manual[Folder 'Manualna Obsługa']
        Drafts[Drafty Systemowe]
    end

    subgraph "Moduł Inicjalizacji i Aktualizacji"
        InitProcess[Proces Inicjalizacji<br/>(One-time Batch)]
        MaintProcess[Proces Maintenance<br/>(Cykliczny Cron)]
        
        Logic_Class[Klasyfikator Kategorii<br/>(VIP/Spam/Pracownik)]
        Logic_Diff[Analizator Różnic<br/>(Draft vs Sent)]
        Logic_Comp[Ekstraktor Kompetencji]
    end

    subgraph "Baza Danych (PostgreSQL)"
        DB_Contacts[Tabela: Kontakty<br/>(Opis, Styl, Kompetencje, Wagi)]
        DB_Categories[Tabela: Kategorie<br/>(Listy Emaili, Zasady Stylu)]
    end

    Inbox & Sent --> InitProcess
    InitProcess --> Logic_Class
    Logic_Class --> DB_Contacts
    Logic_Class --> DB_Categories

    Manual & Sent & Drafts --> MaintProcess
    MaintProcess --> Logic_Diff
    MaintProcess --> Logic_Comp
    Logic_Diff --> DB_Contacts
    Logic_Diff --> DB_Categories
    Logic_Comp --> DB_Contacts
```

## 3. Szczegółowy Opis Funkcjonalności

### F1. Inicjalizacja "Zimny Start" (Batch Processing)
**Kategoria:** [MVP]
**Opis:** Jednorazowe uruchomienie skanera historii w celu zbudowania startowej bazy wiedzy.
- **Zakres:** Ostatnie 6 miesięcy lub 2000 wysłanych wiadomości (limit hybrydowy).
- **Logika:**
    - Pobranie par wiadomości (Otrzymana - Wysłana).
    - Ekstrakcja encji (Kto to jest?) na podstawie domeny i słów kluczowych.
    - Wstępne przypisanie do kategorii (Współpracownik, Klient, Inne) na podstawie prostych heurystyk (np. @firma.com = Pracownik).
    - Generowanie ogólnych instrukcji stylu dla głównych kategorii.
- **Edge Case:** Pusta skrzynka (nowe konto) -> System pomija analizę i startuje na domyślnych ustawieniach ("Bezpieczny Styl").

### F2. Struktura Danych "Tożsamość i Kompetencje"
**Kategoria:** [MVP]
**Opis:** Implementacja dwupoziomowej struktury danych zgodnie z ustaleniami.
- **Tabela Kategorii:** Przechowuje definicje grup (VIP, Zespół, Spam, Notyfikacje) oraz przypisane do nich domyślne style komunikacji.
- **Tabela Kontaktów (Emaili):** Szczegółowa karta kontaktu zawierająca:
    - Email (klucz)
    - Kategoria (FK)
    - Waga/TrustScore (do automatyzacji awansów/degradacji)
    - Opis Kompetencji (dla delegatów)
    - Indywidualny Styl (opcjonalny override stylu kategorii)

### F3. Pętla Zwrotna (Maintenance & Learning)
**Kategoria:** [MVP]
**Opis:** Cykliczny proces analizujący manualne interwencje w celu aktualizacji bazy.
- **Analiza Folderu "Manualna Obsługa":**
    - Jeśli mail z tego folderu trafił do Kosza/Spamu -> Zmniejsz wagę kontaktu / Dodaj do Spamlisty.
    - Jeśli na maila została wysłana odpowiedź -> Przeanalizuj parę i zaktualizuj kontekst kontaktu.
- **Analiza Draftów (Diff Logic):**
    - Porównanie Treści Draftu (zapisanego w DB) z Treścią Wysłaną.
    - Jeśli różnica jest istotna -> Zapisz wersję wysłaną jako nowy "Wzorzec Stylu" dla danej kategorii/kontaktu.

### F4. Ekstrakcja Kompetencji (Append & Summarize)
**Kategoria:** [MVP]
**Opis:** Budowanie profilu delegata na podstawie treści zadań, które są mu zlecane (zarówno automatycznie, jak i ręcznie).
- **Mechanizm:**
    - Wykrycie słów kluczowych w mailu delegującym (np. "sprawdź umowę", "faktura").
    - Dopisanie tagów do profilu kontaktu.
    - Okresowe (np. raz w miesiącu) przeredagowanie tagów w spójny "Opis Kompetencji" przez LLM.

### F5. Obsługa Notyfikacji vs Spam
**Kategoria:** [MVP]
**Opis:** Rozróżnienie niechcianych wiadomości od raportów systemowych.
- **Spam:** Trafia na czarną listę (autocharing/blokada).
- **Notyfikacje:** (np. wyciągi bankowe, raporty z Jira) Trafiają do kategorii "Informacyjne" z poleceniem generowania podsumowań (Summary), zamiast pełnego archiwizowania.

## 4. Lista Zidentyfikowanych Wymagań (Nowe/Zmienione)

- **Magazyn Draftów:** Baza danych musi przechowywać historię wygenerowanych draftów (nawet tych niewysłanych) powiązaną z Message-ID oryginału, aby umożliwić analizę porównawczą (Diff) po wysłaniu maila przez użytkownika.
- **Mechanizm Wag:** Wprowadzenie pola Weight/Score dla kontaktu. Ujemna waga (uzyskana przez częste manualne korekty/spamowanie) jest sygnałem do sugerowanego usunięcia z Whitelisty.
- **Parowanie Po Nagłówkach:** System w analizie "Manualnej Obsługi" musi polegać na nagłówkach In-Reply-To, aby bezbłędnie łączyć pytania z odpowiedziami.

## 5. Lista Ulepszeń (Post-MVP)

- **[OPTIONAL] Sanityzacja Danych (PII):** Moduł wykrywający i zamazujący dane wrażliwe (PESEL, karty kredytowe) przed zapisaniem treści maila do bazy wiedzy/przykładów stylu.
- **[OPTIONAL] Auto-Detekcja VIP:** Zaawansowana heurystyka badająca czas reakcji (Latency) i inicjatywę, aby automatycznie proponować kandydatów do Whitelisty.
- **[OPTIONAL] Wersjonowanie Konfiguracji:** Mechanizm snapshotów (kopii zapasowych) bazy stylów i kontaktów przed nocną aktualizacją, umożliwiający "Rollback" w razie degradacji jakości AI.