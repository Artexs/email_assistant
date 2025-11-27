### Core Modules
* [Orchestrator](#orchestrator)
* [Triage Engine](#triage-engine)
* [Mental Model](#mental-model)
* [AI Assistant + WhatsApp](#ai-assistant--whatsapp)
* [UI Interface (www)](#ui-interface-www)

##
### Orchestrator
* Centralny, bezstanowy węzeł logiczny obsługujący wiele kont. Dla każdego z nich wykonuje poniższe akcje:

* Pobiera dane z bazy i dostarcza do UI
* Zarządza ustawieniami, konfiguracją i przepływem danych w koncie:
    * Czy konto obsługuje jedynie Executive czy też pomiędzy nimi znajduje się Asystentka (EA)
    * Liczba aktywnych emaili na koncie oraz obsługa każdego z nich
* **Cron Job**:
    * **Triage Engine**: uruchamia Triage Engine
    * **Daily Report**: Generowanie podsumowań aktywności Triage dla każdego emaila oraz wysłanie raportu na WhatsApp
    * **Chaser**: monitorowanie delegowanych zadań, wysłanie ponaglenia (email) oraz powiadomienie Executive'a
    * **Aktualizacja profilu Executive'a**: uruchamia Mental Model - cykliczne aktualizacje
    * notatka na WhatsApp przed umówionym spotkaniem
* **EA Hand-Off**: Workflow przekierowujący drafty do weryfikacji przez Asystentkę (EA) przed powiadomieniem Prezesa.
* **Multi-Tenancy**: Architektura wspierająca obsługę wielu niezależnych organizacji i użytkowników na jednej instancji (Faza 2).
* Konfiguracja konta:
    * lista adresów email
    * dodane konto asystentki (EA)
    * włączone/wyłączone narzędzia Triage Engine
    * tryb bezpieczny (brak wysyłania emaili, jedynie drafty)
    * zmiana hasła/emaila/kluczy API
    * zmiana stylu pisania wiadomości Executive'a / list z emailami

##
### Triage Engine
* Silnik decyzyjny klasyfikujący wiadomości:
    * listy z emailami (VIP, Zespół, Delegate, Spam)
    * AI - wymaga dobrego **prompta klasyfikującego**
    * pewność klasyfikacji <70%, wiadomość przeniesiona do folderu obsługi ręcznej
    * pewność klasyfikacji <70%, przygotowany draft wiadomości
* Uruchamia następujące narzędzia:
    * **Spam Tool**: Przenoszenie niechcianych wiadomości do folderu Spam/Kosz, ew. zmniejszenie wagi nadawcy w *Mental Model*.
    * **Summary Tool**: Generowanie 3-zdaniowych "pigułek wiedzy" dla e-maili informacyjnych i archiwizacja oryginału.
    * **Delegation Tool**: Wyodrębnienie zadania, doboru delegata i utworzenia draftu lub wysłania wiadomości delegującej.
    * **Meeting Tool**: Wykrywanie próśb o spotkanie, sprawdzanie dostępności w kalendarzu
        * **Auto-Book**: Rezerwacja i potwierdzanie spotkań w wolnych terminach kalendarza.
        * **Conflict Detection**: Sugerowanie alternatywnych terminów w przypadku konfliktu.
    * **Manual Handling Folder**: Wiadomości trudne do automatyzacji, zostawione do ręcznego przetwarzania.
* Pobiera konfigurację narzędzi z bazy. Które narzędzia są dostępne oraz jaki mają zakres swobody (wysłać wiadomość lub tylko przygotować draft)

##
### Mental Model
* **Inicjalizacja**: Skanuje historię e-maili w celu wygenerowania startowego profilu stylu użytkownika.
* Generuje **whitelisty** z listą emaili oraz **styl odpowiedzi** dla każdej grup docelowych:
    * VIP - lista ważnych osobistości, od których emaile zawsze są przerwarzane z wysokim priorytetm
    * Zespół - lista współpracowników wraz z krótkim opisem / historią konwersacji
    * Delegate - lista osób decyzyjnych wraz z opisem ich zakresu kompetencji 
    * Spam - pomiń emaile 
* **Cykliczne aktualizacje**: odczytuje historię nieprzetworzonych (folder **Manualna obsługa**) lub niepewnych **draft** emaili w bazie danych. Skanuje następujące foldery w poszukiwaniu zmian:
    * folder wysłane: aktualizacja wzorca stylu i dopisanie do bazy danych (dodatkowa tabela/pole)
    * folder spam/kosz: obniżanie wagi nadawcy
    * folder manualna obsługa - wiadomość odczytana: ??
    * **draft -> wysłane**: aktualizacja wzorca stylu oraz danych dotyczących adresata (np delegacje) w bazie

##
### AI Assistant + WhatsApp
* Bramka interfejsu obsługująca interakcje tekstowe i głosowe (WhatsApp) oraz zarządzająca intencjami użytkownika.
* **WhatsApp**: 
    * cykliczne otrzymywanie podsumowań aktywności Triage
    * akceptacja draftów / korekta wiadomości z powyższego podsumowania
    * wyszukaj wiadomość/informacje w skrzynce
    * wysłanie nowej wiadomości email
    * otrzymaj notatkę przed spotkaniem
    * konfiguracja konta: 
        * zaktualizuj jedną z list email (zablokuj / odblokuj adres),
        * potwierdź aktualizację stylu
        * wyłącz powiadomienia (tryb koncentracji) na jakiś czas (np urlop, delegacja)
* **Voice**: Transkrypcja notatek głosowych WhatsApp
* **Two-Way WhatsApp Communication**: Pełna obsługa konwersacyjna - Asystent przechowuje kontekst rozmowy, może pytać, pobierać dane z bazy oraz systemu, uruchamiać narzędzia i generować odpowiedzi dla użytkownika

##
### UI Interface (www)
* **Config Panel (Web UI)**: Interfejs webowy umożliwiający zarządzanie globalnymi przełącznikami, listami (Whitelista, Delegaci) i edycją stylu.
* **Action Switches**: Granularne przełączniki ON/OFF dla każdej funkcjonalności automatycznej, sterujące ich aktywnością w czasie rzeczywistym.
* **Global Auto-Send/Draft Switch**: Globalny przełącznik trybu pracy systemu między pełną automatyzacją wysyłki a generowaniem wyłącznie draftów.
* **Onboarding Checklist**: Interaktywna lista kontrolna w UI prowadząca użytkownika przez proces konfiguracji systemu.
* Strona konfiguracja - podgląd wszystkich adresów email (zablokowanych/przechodzących w celu łatwego odblokowanoa/zablokowania adresu)

##
#### Logi
* **Advanced Audit Logs**: Szczegółowy, niezmienny rejestr wszystkich operacji systemowych dla celów audytowych (Faza 2).

#### Optional/Nice-to-have
* **Dashboard Statistics**: Prezentacja kluczowych metryk wydajności systemu i stosunku automatyzacji do interwencji ręcznych.
* **Context Mapping**: <Baza wektorowa??> Pobieranie pełnej historii wątku (Gmail Thread ID) w celu zapewnienia spójności kontekstu dla modelu LLM.
* **Vector Trainer**: Indeksowanie treści e-maili w bazie wektorowej w celu obsługi RAG (Retrieval Augmented Generation).
* **Local LLM Support**: Możliwość przełączenia przetwarzania danych na lokalne modele językowe w celu zwiększenia prywatności (Faza 2).
* podmiana danych wrażliwych (pesel, haslo, byc moze imie/nazwisko? )
* Wersjonowanie Konfiguracji (Backup) - konfiguracja powinna mieć wiele kopii w bazie, a zwracana jedynie ta aktywna
