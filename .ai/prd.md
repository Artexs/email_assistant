# Dokument Wymagań Produktowych (PRD) - Asystent Email AI (MVP)

## 1. Przegląd Produktu

Asystent Email AI to inteligentne narzędzie zaprojektowane w celu automatyzacji i optymalizacji zarządzania skrzynką odbiorczą dla kadry kierowniczej wyższego szczebla i menedżerów (rola "Prezesa"). Celem produktu jest drastyczne skrócenie czasu poświęcanego na obsługę poczty poprzez automatyczne kategoryzowanie, delegowanie zadań, zarządzanie spamem i inteligentne podsumowywanie wątków.

Celem MVP (Minimum Viable Product) jest dostarczenie funkcjonalnego systemu, który przejmuje cztery kluczowe, powtarzalne czynności, maksymalizując stosunek automatycznie obsługiwanych wiadomości do tych wymagających ręcznej interwencji.

## 2. Problem Użytkownika

Dyrektorzy i menedżerowie wysokiego szczebla poświęcają nadmierną ilość czasu na ręczne sortowanie, przetwarzanie i odpowiadanie na lawinę przychodzących e-maili. Ta ręczna interwencja odciąga ich od zadań strategicznych i operacyjnych o wyższej wartości. Potrzebują niezawodnego, przejrzystego i w pełni kontrolowanego narzędzia, które potrafi odfiltrować szum, obsłużyć rutynowe zadania (takie jak delegowanie) i dostarczyć skondensowane, krytyczne podsumowania, zachowując jednocześnie ich profesjonalny styl komunikacji.

## 3. Wymagania Funkcjonalne

### 3.1 Moduł Orkiestratora i Logika Rdzenia (Backend)

Moduł ten pełni funkcję centralnego węzła logicznego, odpowiedzialnego za agregację danych, zarządzanie konfiguracją oraz cykliczne procesy (Cron Jobs). Jest bezstanowy w kontekście przetwarzania pojedynczego e-maila, ale zarządza stanem globalnym systemu.

- **Zakres Odpowiedzialności:**
  - **API & Komunikacja:** Obsługa żądań z Frontendu i Modułu WhatsApp.
  - **Wysyłka (Gmail API):** Realizacja wysyłki wiadomości (Draft Approval, Nowy Email, Delegacja).
  - **Zarządzanie Delegacjami:** Monitorowanie statusów i obsługa "Chaser Cron".

- **Kluczowe Mechaniki:**
  - **Obsługa Wielu Aliasów (Multi-Email):** System obsługuje wiele skrzynek podpiętych pod jedno konto. Odpowiedzi są wysyłane z adresu, na który przyszła wiadomość (zachowanie kontekstu), a nowe wiadomości z adresu głównego.
  - **EA Hand-Off (Filtr Asystenta):** Model przepływu `Triage -> Draft -> EA Review -> Executive Notification`. Wiadomości mogą być oznaczone jako `EA_ACTIONED` (nie powiadamiają Prezesa) lub `EXECUTIVE_REVIEW` (wymagają zatwierdzenia).
  - **Context Mapping (Threading):** Pobieranie pełnej historii wątku (Gmail Thread ID) dla zapewnienia spójności kontekstu dla LLM.

- **Procesy Cykliczne (Cron Jobs):**
  - **Chaser Cron:** Sprawdza przeterminowane delegacje i flaguje je do raportu lub monitu.
  - **Daily Report Cron:** Generuje i wysyła zagregowane podsumowania (1-3 razy dziennie).
  - **Config Cron:** Zarządza globalnymi przełącznikami i oknami czasowymi raportowania.

- **Obsługiwane Intencje (API):**
  - `INTENT_APPROVE_DRAFT`, `INTENT_CORRECT_DRAFT`, `INTENT_DELEGATE_MANUAL`, `INTENT_NEW_EMAIL`, `INTENT_MEETING_BRIEF`, `INTENT_CHECK_STATUS`, `INTENT_GET_INFO`, `INTENT_CONFIG_WHITELIST`.

### 3.2 Silnik Triage i Rejestr Narzędzi

Moduł Triage odpowiada za podejmowanie decyzji o klasyfikacji wiadomości. Nie stosuje "ślepego" FastTracka, lecz wykorzystuje wagi kontekstowe (np. status VIP) do sterowania progiem decyzyjnym AI.

- **Logika Decyzyjna (Context-Aware):**
  - **Wagi:** Status nadawcy (VIP, Zespół, Nieznany) jest przekazywany do promptu jako silna sugestia.
  - **Confidence Threshold:** Jeśli pewność klasyfikacji AI wynosi < 70%, wiadomość trafia do folderu "Manualna Obsługa" z etykietą `❓ AI Unsure`.
  - **Atomowość:** Operacje na Gmailu i wpisy do DB są traktowane spójnie (transakcyjnie).

- **Rejestr Narzędzi (Tools Registry):**
  - **Priorytet (Strategic/VIP):** Przeniesienie do folderu VIP, oznaczenie gwiazdką.
  - **Delegacja (Operational/Admin):** Analiza treści -> Wybór delegata -> Utworzenie Draftu Delegacji.
  - **Spotkania (Meeting):** Wykrycie prośby -> Sprawdzenie konfliktu -> Utworzenie Draftu Odpowiedzi.
  - **Podsumowanie (Info/Knowledge):** Generowanie "pigułki wiedzy" (3 zdania) -> Archiwizacja oryginału.
  - **Auto-Archiwizacja (Notifications):** Oznaczenie jako przeczytane -> Archiwizacja (dla powiadomień systemowych).
  - **Spam (Noise):** Przeniesienie do Spam/Kosza (z logowaniem "Cichego Spamu" dla weryfikacji False Positives).

- **Centralne Logowanie:** Każde narzędzie kończy pracę wpisem do `DB Action Log`, co buduje pełny "Audit Trail" dla raportów.

### 3.3 Moduł Modelu Mentalnego ("The Brain")

Backendowy moduł odpowiedzialny za budowę i utrzymanie "Cyfrowego Modelu Mentalnego" Prezesa. Nie posiada interfejsu UI, lecz dostarcza kontekst dla Triage i API.

- **Inicjalizacja (Cold Start):**
  - Jednorazowa analiza ostatnich 6 miesięcy (lub 2000 wiadomości) w celu zbudowania startowej bazy wiedzy o kontaktach i stylu.
  - W przypadku pustej skrzynki system startuje na ustawieniach domyślnych ("Bezpieczny Styl").

- **Struktura Danych (Tożsamość i Kompetencje):**
  - **Kategorie:** Definicje grup (VIP, Zespół, Spam) z domyślnymi stylami.
  - **Kontakty:** Szczegółowe karty z `TrustScore` (Waga), Opisem Kompetencji i Indywidualnym Stylem.

- **Pętla Zwrotna (Feedback Loop):**
  - **Analiza Manualna:** Jeśli e-mail trafił do folderu "Manualna Obsługa", a potem do Kosza -> obniżenie wagi nadawcy.
  - **Analiza Draftów (Diff):** Porównanie wygenerowanego draftu z wersją ostatecznie wysłaną przez Prezesa. Różnice aktualizują wzorzec stylu.

- **Ekstrakcja Kompetencji:**
  - Automatyczne tagowanie delegatów na podstawie treści zlecanych im zadań (np. "faktura" -> Finanse).

### 3.4 Moduł Asystenta AI (Interface Gateway)

Warstwa interfejsu oddzielająca użytkownika od logiki backendu. Działa jako "tłumacz" i orkiestrator konwersacji, zapewniając naturalną interakcję (Tekst/Głos).

- **Wielokanałowa Obsługa (Voice & Text):**
  - Obsługa wiadomości tekstowych i notatek głosowych (Voice Notes) przez WhatsApp.
  - Integracja z modelem STT (np. Whisper) do natychmiastowej transkrypcji.

- **NLU i Zarządzanie Intencjami:**
  - Analiza języka naturalnego w celu identyfikacji intencji (np. `SEND_EMAIL`, `GET_BRIEFING`).
  - Obsługa "skakania po tematach" (Context Switching) i dopytywanie o szczegóły (Disambiguation).

- **Dynamiczny "Human in the Loop":**
  - **Safety Logic:** Asystent decyduje, kiedy prosić o potwierdzenie.
  - **VIP/High Risk:** Wymusza potwierdzenie draftu przed wysłaniem.
  - **Routine/Low Risk:** Informuje o wykonaniu akcji automatycznej.

- **Synteza i Powiadomienia:**
  - **Briefingi:** Zamiana surowych danych na naturalne podsumowania ("Masz spotkanie z X...").
  - **Push vs Digest:** Pilne sprawy (VIP) są wysyłane natychmiast, reszta w raportach cyklicznych.

### 3.5 Panel Konfiguracyjny (UI)

Webowy interfejs użytkownika służący do zarządzania globalną konfiguracją systemu, ustawieniami osobistego stylu i monitorowaniem statusu kluczowych delegacji.

- **Dashboard Status:**
  - Widok statusu kluczowych delegacji (bez pełnych logów).
  - Wskaźniki ryzyka (np. brak odpowiedzi delegata).

- **Konfiguracja i Sterowanie:**
  - **Włączniki Narzędzi:** Globalne przełączniki ON/OFF dla każdej automatyzacji (np. Auto-Delegacja).
  - **Edytor Stylu:** Pole tekstowe do edycji aktywnego promptu systemowego ("Stylu Prezesa").
  - **Reaktywność:** UI musi aktywnie odświeżać stan konfiguracji (Sync z WhatsApp).

- **Zarządzanie Listami (CRUD):**
  - **Whitelista:** Dodawanie/usuwanie adresów priorytetowych (wymaga potwierdzenia usunięcia).
  - **Delegaci:** Zarządzanie listą delegatów. Pole "Kompetencje/Kontekst" jest obowiązkowe.
  - **Walidacja:** Blokada dodania adresu Prezesa do listy delegatów.

- **Onboarding i Konto:**
  - Status podpięcia Gmail i WhatsApp.
  - Zarządzanie tokenami i autoryzacją.

### 3.4 Komunikacja i Audyt

- **Komunikacja Zewnętrzna:** System musi zaimplementować komunikację przez WhatsApp (lub inny uzgodniony komunikator), aby dostarczać codzienne raporty i podsumowania aktywności do Prezesa.
- **Ręczna Obsługa (Folder):** Wyznaczony folder e-mail o nazwie "Manual Handling" (Obsługa Ręczna) musi znajdować się całkowicie poza jurysdykcją systemu. System może przenosić tam e-maile, ale nie może ich dalej przetwarzać.
- **Ręczna Delegacja:** Oddzielna funkcja "Deleguj Ręcznie" w panelu (WWW/WhatsApp) musi pozwalać Prezesowi na ręczne zainicjowanie zadania. Funkcja ta musi wysłać sformatowaną wiadomość z tagiem 'delegacja' i dodać ją do bazy danych w celu śledzenia postępów.

## 4. Granice Produktu

| Kategoria | W zakresie (Zakres MVP) | Poza zakresem (Faza 2 / TODO) |
| :--- | :--- | :--- |
| **Styl Komunikacji** | Generowanie uproszczonego stylu (skan 6 miesięcy/2000 e-maili). Edycja ręczna promptu. | Zaawansowany moduł samouczący się w czasie rzeczywistym (Faza 2). |
| **Role Użytkownika** | Rola Prezesa (Właściciel) oraz wsparcie dla EA (Hand-Off w panelu). | Pełny system multi-tenant (SaaS) z wieloma organizacjami. |
| **Akcje i Narzędzia** | "Hard 6" Tools: Spam, Delegacja, Spotkania, Podsumowanie, Wyjaśnienie, Manual/Emergency. | Zaawansowane negocjacje terminów, automatyczne płatności. |
| **Intencje (NLU)** | 8 kluczowych intencji (m.in. Approve Draft, Correct Draft, Delegate Manual). | Dowolna konwersacja o pogodzie, newsach itp. (General Chat). |
| **Kanały** | WhatsApp (Tekst/Głos) + Web Panel. | Slack, Teams, Telegram, Dedykowana aplikacja mobilna. |

## 5. Historyjki Użytkownika (User Stories)

### 5.1 Wdrożenie i Konfiguracja

| ID | Tytuł | Opis | Kryteria Akceptacji |
| :--- | :--- | :--- | :--- |
| **US-001** | **Aktywacja Systemu** | Jako Prezes, chcę aktywować system natychmiast po pierwszym zalogowaniu, aby automatycznie rozpoczął filtrowanie bez konieczności pełnej konfiguracji. | 1. System rozpoczyna przetwarzanie e-maili natychmiast po aktywowaniu głównego przełącznika.<br>2. Wyświetlana jest "Lista kontrolna wdrożenia", zachęcająca do opcjonalnej konfiguracji list i stylu. |
| **US-002** | **Generowanie Uproszczonego Stylu** | Jako Prezes, chcę, aby system przeskanował moją dotychczasową komunikację i zaproponował jeden "Opis Stylu", abym mógł szybko zatwierdzić i aktywować mój spersonalizowany ton komunikacji. | 1. System skanuje ostatnie 100 wysłanych e-maili i generuje jeden sugerowany "Opis Stylu" (maks. 500 znaków).<br>2. Prezes musi ręcznie zatwierdzić lub edytować sugerowany Styl w panelu webowym, zanim zostanie on użyty do komunikacji wychodzącej. |
| **US-003** | **Zarządzanie Białą Listą** | Jako Prezes, chcę ręcznie dodawać/usuwać adresy e-mail do Białej Listy, aby mieć pewność, że ważni nadawcy są zawsze traktowani jako zaufani. | 1. Istnieje dedykowana strona konfiguracji Białej Listy z interfejsem CRUD.<br>2. Każdy adres e-mail na Białej Liście ma gwarancję, że nie zostanie sklasyfikowany jako Spam. |
| **US-004** | **Indywidualna Kontrola Akcji** | Jako Prezes, chcę mieć oddzielne przełączniki WŁ/WYŁ dla każdej głównej akcji, aby móc dokładnie kontrolować, które części mojej skrzynki odbiorczej są automatyzowane. | 1. Panel Konfiguracyjny wyświetla cztery oddzielne przełączniki WŁ/WYŁ dla Spamu, Delegacji, Obsługi Spotkań i Podsumowania Informacyjnego.<br>2. Orkiestrator Triage wykonuje akcję tylko wtedy, gdy jej odpowiedni przełącznik jest ustawiony na WŁ. |
| **US-005** | **Globalna Kontrola Wysyłania** | Jako Prezes, chcę ustawić globalną kontrolę, aby wybrać między automatycznym wysyłaniem a tworzeniem wersji roboczych, abym mógł zarządzać moim poziomem tolerancji ryzyka. | 1. Dostępny jest globalny przełącznik o nazwie "Auto Send/Draft" (Wysyłanie Auto/Draft).<br>2. Gdy ustawiony na 'Draft', każda akcja wymagająca wysłania e-maila (np. Delegacja, Odpowiedź na Spotkanie) tworzy wersję roboczą zamiast wysyłać automatycznie. |
| **US-014** | **Uwierzytelnianie i Autoryzacja** | Jako Prezes, muszę bezpiecznie logować się do aplikacji i zachować pełną kontrolę administracyjną nad wszystkimi konfiguracjami systemu i danymi. | 1. System wymaga bezpiecznego uwierzytelniania użytkownika (np. standardowy proces logowania).<br>2. Tylko rola "Prezesa" ma pełne uprawnienia administracyjne do modyfikowania Konfiguracji, List i Kontroli Akcji. |

### 5.2 Główne Przetwarzanie i Triage

| ID | Tytuł | Opis | Kryteria Akceptacji |
| :--- | :--- | :--- | :--- |
| **US-006** | **Priorytet Białej Listy** | Jako Prezes, potrzebuję, aby system priorytetowo traktował moją Białą Listę przy filtrowaniu Spamu, aby e-maile od zaufanych nadawców nigdy nie były błędnie przenoszone do folderu Spam. | 1. Gdy przychodzi e-mail, moduł Triage najpierw sprawdza Białą Listę.<br>2. Jeśli nadawca jest na Białej Liście, Triage pomija sprawdzanie klasyfikacji Spam.<br>3. E-mail nie może zostać przeniesiony do folderu Spam przez system. |
| **US-007** | **Akcja Podsumowania Informacyjnego** | Jako Prezes, chcę, aby system czytał i podsumowywał niepilne, informacyjne e-maile, abym mógł szybko zrozumieć treść bez otwierania oryginalnego e-maila. | 1. Jeśli AI sklasyfikuje e-mail jako 'Podsumowanie Informacyjne' i akcja jest WŁ, system generuje zwięzłe podsumowanie.<br>2. Oryginalny e-mail jest archiwizowany po wygenerowaniu podsumowania. |
| **US-008** | **Akcja Delegacji** | Jako Prezes, chcę, aby system automatycznie identyfikował e-maile nadające się do delegowania i przekazywał je do odpowiedniego delegata, aby zadania były szybko realizowane. | 1. Jeśli AI sklasyfikuje e-mail jako 'Delegacja' i akcja jest WŁ, system wybiera odpowiedniego delegata na podstawie Listy Delegatów/Kompetencji.<br>2. System wysyła sformatowany e-mail/odpowiedź do delegata.<br>3. Akcja jest logowana w bazie danych w celu śledzenia postępów. |
| **US-009** | **Wykrywanie Konfliktów Spotkań** | Jako Prezes, chcę, aby system wykrywał konflikty spotkań w moim kalendarzu, gdy przychodzą nowe prośby o spotkanie, i sugerował rozwiązania. | 1. Jeśli AI sklasyfikuje e-mail jako 'Obsługa Spotkań' i akcja jest WŁ, system sprawdza istniejące konflikty w kalendarzu.<br>2. System sugeruje potencjalne rozwiązania (np. sugestia zmiany terminu). |
| **US-010** | **Folder Obsługi Ręcznej** | Jako Prezes, chcę mieć możliwość ręcznego przenoszenia niektórych e-maili do wyznaczonego folderu, który system automatyzacji będzie całkowicie ignorował. | 1. System nigdy nie uzyskuje dostępu ani nie przetwarza e-maili umieszczonych w wyznaczonym folderze "Manual Handling" (Obsługa Ręczna).<br>2. System może umieścić e-mail w tym folderze, jeśli jest to wyraźnie skonfigurowane w przepływie pracy (np. niesklasyfikowane). |
| **US-015** | **Klasyfikacja Wielu Akcji** | Jako Prezes, potrzebuję, aby Triage poprawnie priorytetyzował i wybierał tylko jedną akcję, gdy e-mail potencjalnie pasuje do kilku klasyfikacji. | 1. Orkiestrator Triage musi wybrać jedną najlepiej pasującą akcję do wykonania.<br>2. Triage musi sprawdzić jawną hierarchię: Sprawdzenie Białej Listy $\rightarrow$ Klasyfikacja AI $\rightarrow$ Status Akcji WŁ/WYŁ $\rightarrow$ Wykonanie akcji. |

### 5.3 Raportowanie i Audyt

| ID | Tytuł | Opis | Kryteria Akceptacji |
| :--- | :--- | :--- | :--- |
| **US-011** | **Dzienny Raport Aktywności (WhatsApp)** | Jako Prezes, chcę otrzymywać codzienne podsumowanie działań systemu na moim preferowanym komunikatorze (WhatsApp), abym mógł zachować zaufanie i przejrzystość. | 1. System dostarcza raport dziennej aktywności przez WhatsApp (lub inny zintegrowany komunikator).<br>2. Raport musi jasno określać, co zrobił system (np. "Obsłużono 50 e-maili. 5 oddelegowano do Działu Finansów"). |
| **US-012** | **Śledzenie Ręcznej Delegacji** | Jako Prezes, chcę ręcznie inicjować zadanie delegacji przez panel lub WhatsApp i aby system śledził je tak jak automatyczną delegację. | 1. Przycisk/funkcjonalność "Deleguj Ręcznie" istnieje w panelu WWW i jest dostępna przez WhatsApp.<br>2. Aktywacja tej funkcji wysyła wstępnie sformatowany e-mail/wiadomość z tagiem 'delegacja'.<br>3. Wysłane zadanie jest dodawane do bazy danych w celu śledzenia. |
| **US-013** | **Widok Podstawowych Statystyk** | Jako Prezes, chcę przeglądać podstawowe statystyki wydajności systemu, abym mógł ocenić wartość i skuteczność automatyzacji. | 1. Panel wyświetla podstawowe statystyki (np. całkowita liczba obsłużonych e-maili, liczba e-maili przeniesionych do 'Obsługi Ręcznej').<br>2. Statystyki pozwalają na mierzenie kluczowego wskaźnika sukcesu (stosunek obsłużonych do ręcznej interwencji). |

### 5.4 Interakcja z Asystentem (Nowe)

| ID | Tytuł | Opis | Kryteria Akceptacji |
| :--- | :--- | :--- | :--- |
| **US-016** | **Obsługa Notatek Głosowych** | Jako Prezes, chcę wysyłać notatki głosowe na WhatsApp, aby szybko delegować zadania w biegu. | 1. Plik audio wysłany na WhatsApp jest transkrybowany przez STT.<br>2. Transkrypcja jest przetwarzana jako intencja (np. "Deleguj do Ani"). |
| **US-017** | **EA Hand-Off (Filtr Asystenta)** | Jako Prezes, chcę, aby moja Asystentka weryfikowała drafty przed wysłaniem, abym otrzymywał powiadomienia tylko o sprawach krytycznych. | 1. Drafty trafiają najpierw do weryfikacji EA w panelu.<br>2. Tylko status `EXECUTIVE_REVIEW` wyzwala powiadomienie Push do Prezesa. |
| **US-018** | **Cold Start (Analiza Historii)** | Jako Prezes, chcę, aby system automatycznie nauczył się mojego stylu z historii maili przy pierwszym uruchomieniu. | 1. System skanuje do 2000 ostatnich wiadomości wysłanych.<br>2. Profil stylu i kompetencji kontaktów jest tworzony automatycznie. |
| **US-019** | **Korekta Draftu (NLU)** | Jako Prezes, chcę móc poprawić treść draftu odpisując na WhatsApp "Zmień X na Y", bez konieczności logowania do panelu. | 1. System rozpoznaje intencję korekty.<br>2. Treść draftu jest aktualizowana i ponownie przesyłana do akceptacji. |

## 6. Metryki Sukcesu

| Metryka | Definicja | Cel |
| :--- | :--- | :--- |
| **Główny Cel** | Maksymalizacja automatycznej obsługi. Stosunek e-maili obsłużonych automatycznie (przez system) do e-maili wymagających ręcznej interwencji (przeniesionych do folderu "Manual Handling"). | 90% wszystkich przychodzących e-maili jest obsługiwanych automatycznie (Spam, Delegacja, Podsumowanie, Spotkanie) w ciągu 30 dni od konfiguracji. |
| **Dokładność (Biała Lista)** | Procent poprawnej klasyfikacji Spamu dla adresów z Białej Listy. | 100% dokładności (Twarda Reguła Biznesowa). |
| **Czas do Wartości (TTV)** | Czas od aktywacji systemu do pierwszego pomyślnie oddelegowanego lub podsumowanego e-maila. | Mniej niż 1 godzina. |
| **Zaangażowanie (Audyt)** | Dzienny wskaźnik wyświetlania raportu aktywności przez zewnętrzny komunikator. | $\geq 80\%$ dziennych wyświetleń raportu WhatsApp/Messenger. |
