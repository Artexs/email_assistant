<conversation_summary> <decisions>

    Zakres MVP i Styl Prezesa: MVP będzie zawierało uproszczoną funkcję skanowania historii emaili w celu wygenerowania jednej propozycji "Opisu Stylu" (do edycji i zatwierdzenia przez użytkownika). Pełny, zaawansowany moduł uczący zostanie zrealizowany w Phase 2.

    Role Użytkownika (MVP): W MVP Prezes (Właściciel) ma pełnię uprawnień i jest jedynym zarządzającym kontem. Możliwość podłączenia konta Asystentki zostanie uwzględniona na etapie planowania bazy danych.

    Akcje i Kontrola: Zdefiniowano dwa poziomy kontroli: Główny włącznik (pozwalający na wysyłanie emaili lub tylko tworzenie draftów) oraz indywidualne włączniki ON/OFF dla każdej z akcji (Spam, Delegacja, Obsługa Spotkań, Podsumowanie Informacyjne).

    Whitelista i Priorytet: Emaile z Whitelisty są traktowane jako zaufane i nigdy nie zostaną sklasyfikowane jako Spam (Whitelista nadpisuje decyzję AI/filtrów). Wpływ Whitelisty na inne akcje to modyfikator w prompcie AI.

    Triage System (Mózg): Zdefiniowano konieczność posiadania centralnego procesu Triage (Orchestrator), który będzie decydował o kolejności wykonywania akcji (np. sprawdzając programistycznie zdefiniowane akcje, a następnie uruchamiając klasyfikację AI).

    Konfiguracja: Konfiguracja list (Styl, Delegaci, Whitelista) jest opcjonalna i nieblokująca startu systemu (Checklista Wdrożenia). Interfejs dla każdej listy będzie na osobnej podstronie (np. tabela dla Delegatów, pole tekstowe dla Stylu).

    Komunikacja Zewnętrzna: WhatsApp (lub inny komunikator) jest kluczowym kanałem komunikacji i zostanie wcześnie zaimplementowany do wysyłania raportów/podsumowań.

    Folder "Manualna Obsługa": Folder ten jest całkowicie poza jurysdykcją systemu. System wrzuca tam maile i o nich zapomina.

    Ręczna Delegacja: Zostanie wprowadzona osobna funkcja manualnego wysłania emaila/wiadomości (np. przez WWW/WhatsApp) z tagiem 'delegacja', która po wysłaniu zostanie dodana do bazy danych w celu śledzenia postępów.

    Logowanie/Monitoring: Etap logowania (dla użytkownika - Audyt, dla dewelopera - Monitoring) zostanie oznaczony jako TODO w PRD i doprecyzowany w dedykowanej dokumentacji.

</decisions>

<matched_recommendations>

    Wymóg uproszczenia stylu (Rekomendacja 1, Runda 2): Zdefiniujmy w PRD, że proces inicjalizacji skanuje 100 wysłanych maili i generuje jedną propozycję "Opisu Stylu" (do 500 znaków), którą następnie użytkownik musi ręcznie zatwierdzić lub edytować w panelu WWW.

    Twarda reguła Whitelisty (Rekomendacja 4, Runda 2): Ustalmy twardą regułę w PRD: "Email z Whitelisty nigdy nie może być sklasyfikowany jako Spam i nigdy nie trafi do folderu Spam, nawet jeśli AI/filtr tak zasugeruje".

    Wymóg kontroli akcji (Rekomendacja 3, Runda 3): Potwierdźmy w PRD, że panel konfiguracyjny MVP musi zawierać indywidualne przełączniki ON/OFF dla czterech głównych akcji (Spam, Delegacja, Spotkania, Informacyjny).

    Hierarchia Triage (Rekomendacja 5, Runda 3): Zdefiniujmy "Triage" w PRD jako centralny proces-orchestrator, który sprawdza hierarchię: (1) Czy mail jest na Whiteliście? (2) Która akcja pasuje najlepiej? (3) Czy ta akcja jest włączona? (4) Wykonaj akcję.

    Nieblokująca konfiguracja (Rekomendacja 10, Runda 3): Zastosujmy podejście nieblokujące. Użytkownik powinien móc aktywować system od razu, a w dashboardzie powinna być widoczna "Checklista Wdrożenia", zachęcająca do konfiguracji opcjonalnych.

    Śledzenie ręcznej delegacji (Rekomendacja 6, Runda 3): Dodajmy do PRD wymóg przycisku "Deleguj Ręcznie" w dashboardzie, który wysyła sformatowany email z tagiem 'delegacja' i dodaje go do bazy danych do śledzenia. </matched_recommendations>

<prd_planning_summary> a. Główne Wymagania Funkcjonalne Produktu (MVP)

    Rdzeń Przetwarzania (Triage): System musi posiadać centralny moduł (Triage), który programistycznie definiuje dostępne akcje, filtruje przez whitelistę (o najwyższym priorytecie) i przekazuje klasyfikację do AI, uwzględniając aktualne włączniki akcji.

    Akcje MVP: Pełna obsługa 4 kluczowych akcji: Spam (przeniesienie do spamu), Podsumowanie Informacyjne (archiwizacja po podsumowaniu), Delegacja (wysłanie maila do delegata + śledzenie), Obsługa Spotkań (ograniczona do wykrywania konfliktów i sugerowania rozwiązań).

    Panel Konfiguracyjny:

        Kontrola Akcji: Panel musi zawierać 4 indywidualne włączniki ON/OFF dla każdej akcji oraz jeden główny przełącznik "Wysyłanie Auto/Draft".

        Styl Prezesa: Uproszczony formularz tekstowy na podstawie skanowania 100 maili (sugestia AI do edycji).

        Listy: Ręczny interfejs CRUD dla Whitelisty oraz Listy Delegatów (z polami: Nazwa, Email, Kompetencje).

    Komunikacja Zewnętrzna: System musi zaimplementować komunikację przez WhatsApp (lub inny komunikator) w celu dostarczania raportów/podsumowań (krytyczne dla przyjęcia).

    Ręczna Delegacja: Osobna funkcjonalność pozwalająca Prezesowi na manualne zainicjowanie zadania (Deleguj Ręcznie) przez WWW/WhatsApp, które jest następnie śledzone przez system.

b. Kluczowe Historie Użytkownika i Ścieżki Korzystania

    Ścieżka Wdrożenia (Onboarding): Użytkownik włącza system, który automatycznie zaczyna filtrować maile. Następnie, asynchronicznie, jest prowadzony przez opcjonalną "Checklistę Wdrożenia" do konfiguracji Stylu, Delegatów i Whitelisty.

    Ścieżka Przetwarzania Maila: Email przychodzi -> Triage sprawdza whitelistę i włączniki -> Klasyfikacja AI -> Wykonanie włączonej akcji (np. wysłanie maila do Delegata) -> Przeniesienie do odpowiedniego folderu lub "manualna obsługa".

    Ścieżka Zaufania: Prezes dostaje podsumowanie dnia przez WhatsApp/WWW, informujące o tym, co system zrobił (np. "Obsłużono 50 maili. 5 delegowano do Działu Finansów.").

c. Ważne Kryteria Sukcesu i Sposoby Ich Mierzenia

    Główna Metryka: Maksymalizacja stosunku maili obsłużonych automatycznie do maili wymagających ręcznej interwencji (w folderze "manualna obsługa").

    Accuracy: 100% poprawności w klasyfikacji Spamu dla adresów z Whitelisty (twarda reguła biznesowa).

    Audyt i Transparentność: Zgodnie z decyzją, szczegółowe metryki i logowanie zostają przeniesione do fazy TODO, ale konieczne jest zliczanie podstawowych statystyk i ich prezentacja.

d. Wszelkie Nierozwiązane Kwestie lub Obszary Wymagające Dalszego Wyjaśnienia

    Logowanie i Monitoring (TODO): Brak szczegółowego planu dla logów deweloperskich i ścieżki audytu dla użytkownika (mimo że jest to Core Domain). Wymaga dedykowanego modułu PRD.

    Schemat Bazy Danych: Szczegóły dotyczące schematu bazy, w tym dodanie pól dla organizationId (multi-tenant) i podziału na role Właściciel/Asystent, zostają odłożone na etap projektowania technicznego.

    Pełny Zakres Akcji Spotkań: Dokładna logika akcji "Obsługa Spotkań" (poza wykrywaniem konfliktów) wymaga doprecyzowania w dedykowanej dokumentacji. </prd_planning_summary>

<unresolved_issues>

    Logowanie i Monitoring: Konieczność stworzenia dedykowanej dokumentacji dla systemów logowania (Audyt dla użytkownika i Monitoring dla deweloperów). Obecnie oznaczone jako TODO.

    Architektura Bazy Danych: Brak decyzji o implementacji pól dla skalowalności (organizationId, role Asystentki/Prezesa) w MVP, co może prowadzić do długu technologicznego.

    Szczegóły Akcji: Pełny zakres scenariuszy i logiki dla akcji Obsługa Spotkań oraz innych, przyszłych akcji (np. obsługa zapytań o status) wymaga doprecyzowania. </unresolved_issues> </conversation_summary>
