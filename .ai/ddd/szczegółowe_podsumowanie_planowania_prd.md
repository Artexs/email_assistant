# Baza Wiedzy: Projekt Automatyzacji E-maili

## Projekt: Wizja i Strategia

Opis: Projekt dotyczy stworzenia systemu automatyzacji emaili dla menedżerów wyższego szczebla (Executive'ów) i ich asystentek (EA). Celem biznesowym jest oszczędność czasu i "lewarowanie skupienia" (Focus Leverage) kadry kluczowej poprzez inteligentne przetwarzanie, klasyfikację, delegację i automatyzację obsługi skrzynki mailowej.

Decyzje / Kierunki:

- [cite_start]Segment Celowy: Automatyzacja Produktywności Osobistej (Personal & Executive Support)[cite: 2].
- [cite_start]Rozwiązanie ma automatycznie klasyfikować i przetwarzać emaile, delegować zadania, zarządzać spotkaniami i prezentować użytkownikowi tylko to, co wymaga jego uwagi[cite: 1].
- [cite_start]System ma działać w oparciu o dwa główne procesy: Inicjalizację (nauka stylu, konfiguracja) i Proces Operacyjny (cykliczne przetwarzanie)[cite: 1].
- Rdzeń aplikacji to obsługa emaili (kategoryzacja: spam, ekstrakcja informacji, delegacja), a moduły dodatkowe (zarządzanie, podsumowania, raporty, powiadomienia) będą budowane wokół tego rdzenia.

Uwagi / Alternatywy:

- [cite_start]Kluczowym problemem jest przeciążenie informacyjne Prezesa i ryzyko przeoczenia krytycznych spraw[cite: 1, 2].
- [cite_start]Dla Asystentki (EA) kluczowym problemem jest ręczne zarządzanie dwiema skrzynkami i filtrowanie szumu[cite: 2].

## Role Użytkowników i Uprawnienia

[cite_start]Opis: Zdefiniowano dwie główne persony: Prezes/Dyrektor (Konsument Wartości) i Asystent/ka Zarządu (Power User / Konfigurator)[cite: 2].

Decyzje / Kierunki:

- **Decyzja MVP:** Na potrzeby MVP role Asystentki i Prezesa **będą połączone** w jedno konto "Power Usera".
- **Decyzja MVP:** Prezes (Właściciel) może wszystko i jest to jedyne konto, które może zarządzać emailami w MVP.
- **Decyzja Przyszłościowa:** System docelowo będzie wspierał dwie osobne role (Właściciel, Asystent) z różnymi zakresami obowiązków i dostępów.
- **Decyzja Przyszłościowa:** System ma być zbudowany tak, aby umożliwiał dostęp do konta zarówno głównej osobie (Właścicielowi), jak i za pomocą dodatkowego konta (Asystenta).

Uwagi / Alternatywy:

- Nawet w przyszłości (po rozdzieleniu ról) będzie istniała możliwość połączenia obu funkcji w jedno konto.
- [cite_start]Wartością dla Prezesa jest "czysta" skrzynka i pewność śledzenia spraw (Follow-up) przy minimalnym zaangażowaniu[cite: 2].
- [cite_start]Wartością dla EA jest kontrola, możliwość konfiguracji reguł w imieniu Prezesa i odzyskanie czasu[cite: 2].

TODO / Otwarte wątki:

- Szczegółowy podział uprawnień (kto może co robić) zostanie doprecyzowany w dedykowanej dokumentacji modułu zarządzania użytkownikami.
- Na etapie planowania bazy danych zostanie dodana możliwość połączenia konta Prezesa z kontem Asystentki.

## Architektura: Domeny i Konteksty (DDD)

[cite_start]Opis: Przeprowadzono strategiczną analizę DDD (Domain-Driven Design) dla projektu[cite: 4].

Decyzje / Kierunki:

- **Core Subdomains** (Kluczowe przewagi konkurencyjne):
  - [cite_start]Analiza Stylu i Parsowanie Emaili (zapewnia autentyczność)[cite: 4].
  - [cite_start]Klasyfikacja i Triage Emaili (selekcja i priorytetyzacja)[cite: 4].
  - [cite_start]Delegacja i Śledzenie Zadań (mechanizm "Closed Loop")[cite: 4].
  - [cite_start]Audyt i Transparentność (kluczowe dla budowania zaufania)[cite: 4].
- **Supporting Subdomains** (Niezbędne operacyjnie, nie-dystynktywne):
  - [cite_start]Zarządzanie Powiadomieniami[cite: 4].
  - [cite_start]Zarządzanie Użytkownikami i Rolami[cite: 4].
  - [cite_start]Integracje Zewnętrzne (Kalendarz, HR)[cite: 4].
- **Generic Subdomains** (Rozwiązania gotowe/zewnętrzne):
  - [cite_start]Komunikacja Zewnętrzna (np. WhatsApp API)[cite: 4].
- **Zidentyfikowane Bounded Contexts** (Konteksty Ograniczone):
  - Kontekst Stylu i Parsowania
  - Kontekst Klasyfikacji i Triage
  - Kontekst Delegacji i Śledzenia
  - Kontekst Audytu i Transparentności
  - Kontekst Ról i Uprawnień
  - Kontekst Integracji Zewnętrznych
  - [cite_start]Kontekst Komunikacji Zewnętrznej[cite: 4].

## Architektura: Mapa Kontekstów i Integracje

[cite_start]Opis: Zdefiniowano relacje i wzorce integracji między Bounded Contexts[cite: 4].

Decyzje / Kierunki:

- **Relacje (Wzorce DDD):**
  - [cite_start]Styl i Parsowanie → Klasyfikacja (Customer–Supplier)[cite: 4].
  - [cite_start]Klasyfikacja → Delegacja (Customer–Supplier)[cite: 4].
  - [cite_start]Delegacja → Audyt (Customer–Supplier)[cite: 4].
  - [cite_start]Delegacja → Komunikacja Zewnętrzna (Open Host Service)[cite: 4].
  - [cite_start]Ról i Uprawnień ↔ Styl i Parsowanie (Shared Kernel)[cite: 4].
  - [cite_start]Ról i Uprawnień ↔ Integracje (Shared Kernel / Published Language)[cite: 4].
- **Wzorce Integracji:**
  - [cite_start]Styl → Klasyfikacja (Synchronous, Request–Response)[cite: 4].
  - [cite_start]Klasyfikacja → Delegacja (Asynchronous, Event-Driven)[cite: 4].
  - [cite_start]Delegacja → Audyt (Asynchronous, Event-Driven)[cite: 4].
  - [cite_start]Delegacja → Komunikacja (Asynchronous, Event-Driven / Webhook)[cite: 4].
- [cite_start]Architektura strategiczna powinna być zorganizowana wokół trzech głównych kontekstów: (1) Klasyfikacja, (2) Delegacja, (3) Audyt[cite: 4].

## Architektura: Skalowalność i Multi-Tenancy

Opis: Rozważano architekturę pod kątem obsługi wielu klientów.

Decyzje / Kierunki:

- **Decyzja MVP:** MVP będzie działać w trybie "jedno konto - jeden user" (single-tenant).
- **Decyzja Przyszłościowa:** Docelowo aplikacja ma umożliwiać korzystanie z wielu niezależnych kont (multi-tenant).

Uwagi / Alternatywy:

- Pojawiła się rekomendacja, aby na etapie projektowania bazy danych dodać `organizationId` w celu ułatwienia przyszłej migracji do multi-tenancy, nawet jeśli w MVP będzie ono nieużywane.

TODO / Otwarte wątki:

- Ostateczna decyzja o schemacie bazy danych (czy dodawać pola `organizationId` lub osobne tabele dla użytkowników/organizacji) została odłożona na etap projektowania bazy danych.

## Proces: Inicjalizacja i Onboarding (MVP)

Opis: Proces jednorazowej konfiguracji konta użytkownika (Prezesa).

Decyzje / Kierunki:

- **Decyzja MVP:** Proces onboardingu **nie będzie blokujący**. Użytkownik może aktywować system (np. tylko filtrowanie spamu) od razu.
- **Checklista Wdrożenia:** W dashboardzie pojawi się "Checklista Wdrożenia" (np. 1/3 Ukończono), która będzie zachęcać do opcjonalnej konfiguracji pozostałych modułów.
- **Skanowanie Stylu (MVP):** MVP będzie zawierało **uproszczoną** funkcję skanowania historii (np. 100 wysłanych emaili).
- **Wynik Skanowania Stylu:** Skanowanie wygeneruje **jedną propozycję "Opisu Stylu"** (np. akapit tekstu), którą użytkownik będzie musiał ręcznie **zatwierdzić lub edytować** w dedykowanym panelu (duże okno tekstowe).
- **Konfiguracja List (MVP):** Listy (Whitelista, Lista Delegatów) będą w MVP **wprowadzane ręcznie** do bazy przez użytkownika.
- **Interfejs List:** Whitelista będzie zarządzana przez prostą listę emaili (dodaj/usuń). Lista Delegatów będzie tabelą z opcjami (edycja, usunięcie, zatwierdzenie) i polami: Imię, Email, Opis Kompetencji.

Uwagi / Alternatywy:

- **Przyszłość Skanowania:** W przyszłości skanowanie będzie rozbudowane o:
  - Wykrywanie wielu stylów pisania.
  - Automatyczne sugerowanie Whitelisty (z maili przychodzących i wychodzących).
  - Automatyczne sugerowanie Listy Delegatów (na podstawie analizy treści i adresatów).
  - Analizę adresatów (kim są, o czym są rozmowy).

## Proces: Główny Przepływ Przetwarzania (Triage)

[cite_start]Opis: Cykliczny proces operacyjny pobierania i przetwarzania nowych emaili co kilka minut[cite: 1].

Decyzje / Kierunki:

- [cite_start]Emaile pobierane są synchronicznie (wszystkie nieodczytane), przetwarzane natychmiast, buforowane w bazie[cite: 1].
- **"Mózg" Systemu (Triage):** Zdefiniowano potrzebę stworzenia centralnego procesu-orchestratora (Triage).
- **Logika Triage:** Proces ten będzie (1) Programistycznie definiował dostępne akcje, (2) Filtrował email przez Whitelistę, (3) Sprawdzał, czy wymagane akcje są włączone (Włączniki Akcji), (4) Uruchamiał zapytanie AI służące klasyfikacji, (5) Wykonywał akcję.
- [cite_start]**Hierarchia Folderów:** Email fizycznie trafia tylko do jednego folderu wg hierarchii priorytetów (malejąco): Pilny -> VIP/Whitelista -> Delegacja -> Spotkanie -> Informacyjny -> Spam[cite: 1].
- [cite_start]**Tagowanie:** Email może mieć wiele tagów jednocześnie (np. 'VIP', 'Delegacja')[cite: 1].

Uwagi / Alternatywy:

- [cite_start]Usunięto nadmiarowe kroki z pierwotnego Event Stormingu (np. DE2 'Email zbuforowany') na rzecz natychmiastowego przetwarzania[cite: 1].
- [cite_start]Pierwotny diagram Mermaid (DE1-DE64) mapuje szczegółowy przepływ zdarzeń dla każdej kategorii[cite: 3].

## Funkcja: Panel Kontrolny (Włączniki Akcji)

Opis: Użytkownik musi mieć granularną kontrolę nad działaniami systemu.

Decyzje / Kierunki:

- **Tryb Testowy (Główny Włącznik):** Musi istnieć jeden główny włącznik odpowiedzialny za możliwość wysyłania emaili (Tryb "Ostry") lub tylko tworzenia draftów (Tryb "Testowy").
- **Włączniki Akcji (Granularne):** Każda akcja (funkcjonalność) musi mieć swój osobny włącznik ON/OFF w panelu konfiguracyjnym WWW.
- **Akcje z Włącznikami (MVP):** Lista akcji dla MVP obejmuje: (1) Spam, (2) Delegacja, (3) Obsługa Spotkań, (4) Podsumowanie Informacyjne.
- **Hierarchia Logiki:** Włączniki Akcji są nadrzędne. Jeśli akcja jest wyłączona, nie wykona się, nawet jeśli email jest na Whiteliście lub AI ją zasugeruje.

TODO / Otwarte wątki:

- Lista akcji (pkt 3) nie jest kompletna i będzie rozwijana w przyszłości.

## Funkcja: Kategoria SPAM

Opis: Obsługa emaili rozpoznanych jako niechciane.

Decyzje / Kierunki:

- [cite_start]Proste przeniesienie do folderu spam + tagowanie "spam"[cite: 1].

Uwagi / Alternatywy:

- [cite_start]Przyszła funkcjonalność: walidacja na podstawie historii nadawcy[cite: 1].

## Funkcja: Kategoria PILNY

Opis: Obsługa emaili wymagających natychmiastowej reakcji.

Decyzje / Kierunki:

- [cite_start]Dwuetapowa walidacja: wstępna klasyfikacja AI → pobranie kontekstu pilności z bazy → finalna walidacja[cite: 1].
- [cite_start]Powiadomienie asynchroniczne przez WhatsApp[cite: 1].
- [cite_start]Przeniesienie do folderu "Ważne"[cite: 1].

## Funkcja: Kategoria VIP / Whitelista

Opis: Obsługa emaili od kluczowych nadawców.

Decyzje / Kierunki:

- [cite_start]**Status:** VIP/Whitelista **nie jest** osobną kategorią końcową, ale **modyfikatorem priorytetu**[cite: 1].
- **Reguła Biznesowa:** Emaile z Whitelisty są zaufane. **Nigdy** nie mogą być sklasyfikowane jako Spam i **nigdy** nie trafią do folderu Spam (reguła twarda, nadpisuje AI).
- [cite_start]**Logika AI:** Wpływ na inne akcje będzie realizowany jako "modyfikator w prompcie AI" (np. łagodniejsze kryteria klasyfikacji)[cite: 1].
- [cite_start]Sprawdzenie whitelisty następuje PRZED analizą AI (statyczna lista z bazy)[cite: 1].

TODO / Otwarte wątki:

- Dalsze uszczegółowienie wpływu Whitelisty na poszczególne akcje (poza Spamem) odbędzie się podczas doprecyzowywania tych akcji w dedykowanej dokumentacji.

## Funkcja: Kategoria DELEGACJA (Automatyczna)

Opis: Automatyczne delegowanie zadań wyodrębnionych z treści emaila.

Decyzje / Kierunki:

- **Scenariusz A (Delegacja Podstawowa):**
  - [cite_start]Zadanie wyodrębnione[cite: 1].
  - [cite_start]Lista delegatów pobrana z bazy (manualnie wprowadzona w MVP)[cite: 1].
  - [cite_start]Delegat zidentyfikowany[cite: 1].
  - [cite_start]Email delegacji wysłany automatycznie[cite: 1].
  - [cite_start]Delegacja zapisana w bazie, przypomnienie zaplanowane[cite: 1].
- **Scenariusz B (Doprecyzowanie):**
  - [cite_start]AI wykrywa brak informacji (np. brak adresata, deadline)[cite: 1].
  - [cite_start]Szablon doprecyzowania generowany[cite: 1].
  - [cite_start]Draft email stworzony, ale NIE wysłany[cite: 1].
  - [cite_start]Delegacja zapisana w bazie jako "wymaga akcji"[cite: 1].
- **Scenariusz C (Nieznany Delegat):**
  - [cite_start]System nie może zmatchować delegata z bazy[cite: 1].
  - [cite_start]Email przeniesiony do folderu "manualna obsługa"[cite: 1].

## Funkcja: Ręczna Delegacja (Manualne Tworzenie Zadań)

Opis: Możliwość ręcznego zainicjowania śledzonego zadania przez użytkownika, niezależnie od przychodzących emaili.

Decyzje / Kierunki:

- System będzie posiadał funkcjonalność manualnego wysłania emaila (lub wiadomości WhatsApp) z tagiem "delegacja".
- Akcja ta będzie dostępna przez stronę WWW (przycisk "Deleguj Ręcznie" / "Nowe Zadanie") lub przez WhatsApp (intencja).
- Po wysłaniu takiej wiadomości, wątek zostanie automatycznie dodany do bazy danych (tabela `delegacje`) i będzie śledzony jego postęp (przypomnienia itd.), tak samo jak delegacja automatyczna.

## Funkcja: Kategoria SPOTKANIE

Opis: Obsługa próśb o spotkanie.

Decyzje / Kierunki:

- **Decyzja MVP:** Zakres MVP będzie ograniczony **tylko do Scenariusza B (Konflikt)**.
- **Scenariusz A (Wolny termin):** Automatyczne rezerwowanie i potwierdzanie wolnych terminów. [cite_start]**Poza zakresem MVP (Phase 2)**[cite: 1].
- **Scenariusz B (Konflikt terminów):**
  - [cite_start]Konflikt wykryty w kalendarzu[cite: 1].
  - [cite_start]System znajduje alternatywne wolne terminy[cite: 1].
  - [cite_start]Propozycja terminów wysłana do nadawcy[cite: 1].
  - [cite_start]System czeka na odpowiedź[cite: 1].

TODO / Otwarte wątki:

- Szczegóły logiki akcji "Obsługa Spotkań" (np. ile terminów proponować, jak parsować daty) zostaną doprecyzowane w dedykowanej dokumentacji.

## Funkcja: Kategoria INFORMACYJNY

Opis: Obsługa emaili, które nie wymagają akcji, a jedynie zapoznania się.

Decyzje / Kierunki:

- [cite_start]Email podsumowany przez AI[cite: 1].
- [cite_start]Podsumowanie zapisane w bazie danych[cite: 1].
- [cite_start]Email przeniesiony do archiwum[cite: 1].

## Funkcja: Kategoria AWARYJNA (Error Handling)

Opis: Obsługa błędów i sytuacji nieprzewidzianych.

Decyzje / Kierunki:

- [cite_start]Każda nieobsłużona sytuacja, błąd, lub email, dla którego wszystkie włączone akcje zawiodły, trafia do kategorii AWARYJNA[cite: 1].
- [cite_start]Email jest przenoszony do folderu "manualna obsługa"[cite: 1].
- [cite_start]Email jest tagowany: "wymaga interwencji"[cite: 1].

## Funkcja: Folder "Manualna Obsługa"

Opis: Folder docelowy dla emaili, których automat nie mógł przetworzyć lub które wymagają ręcznej interwencji.

Decyzje / Kierunki:

- Folder "manualna obsługa" jest **całkowicie poza jurysdykcją systemu** (write-only).
- System **tylko wrzuca** tam emaile i o nich zapomina.
- System nie śledzi, co się dzieje z mailami w tym folderze (np. czy zostały odczytane, czy wysłano odpowiedź).
- Użytkownik (Prezes/EA) traktuje ten folder tak, jak dotychczasową skrzynkę odbiorczą – obsługuje go manualnie.

## Funkcja: System Podsumowań i Raportów

Opis: Agregowanie działań systemu i prezentowanie ich użytkownikowi.

Decyzje / Kierunki:

- [cite_start]Dane do raportu agregowane są z tabel `emails` i `delegacje`[cite: 1].
- [cite_start]Format raportu: Sekcyjny (Typ A) - grupowanie po typie akcji (PILNE -> WYMAGA AKCJI -> WYKONANE -> PRZYPOMNIENIA)[cite: 1].
- [cite_start]Harmonogram: Cronjob (np. 10:00 i 14:00) + możliwość manualnego uruchomienia[cite: 1].

## Funkcja: Komunikacja (WhatsApp)

Opis: Wykorzystanie komunikatora (np. WhatsApp) jako głównego interfejsu komunikacyjnego.

Decyzje / Kierunki:

- **Decyzja MVP:** Komunikacja przez WhatsApp (lub inny komunikator) **jest kluczowa** i zostanie **wcześnie zaimplementowana**.
- [cite_start]**Kierunek (MVP):** Komunikator będzie używany do wysyłania powiadomień pilnych (asynchronicznie) oraz cyklicznych podsumowań dziennych[cite: 1].
- **Kierunek (MVP):** Komunikator będzie używany do ręcznego inicjowania delegacji (Pkt 6, Runda 4).
- [cite_start]**Kierunek (Phase 2):** Rozbudowa o pełną dwukierunkową komunikację i rozpoznawanie intencji (np. "Wyślij nowy email", "Lista przypomnień", "Szukaj konwersacji")[cite: 1].

Uwagi / Alternatywy:

- Podczas dyskusji pojawiła się chwilowa propozycja (Runda 3, Pkt 8), aby w MVP zastąpić WhatsApp panelem WWW, ale zostało to odrzucone (Runda 4, Pkt 8) na rzecz pierwotnej wizji.
- Na potrzeby testowania (przed pełną implementacją API) wiadomości mogą być wysyłane na stronę WWW lub do konsoli deweloperskiej.

## Funkcja: Dashboard WWW

Opis: Interfejs webowy do zarządzania systemem.

Decyzje / Kierunki:

- [cite_start]**Panel Konfiguracyjny:** Dashboard musi zawierać strony do zarządzania konfiguracją (Włączniki Akcji, Styl Prezesa, Lista Delegatów, Whitelista)[cite: 1].
- [cite_start]**Checklista Wdrożenia:** Musi zawierać nieblokujący moduł onboardingu[cite: 1].
- **Podsumowania:** Musi zawierać widok podsumowań (alternatywa/dodatek do WhatsApp).
- **Ręczna Delegacja:** Musi zawierać funkcję ręcznego tworzenia zadań ("Deleguj Ręcznie").

TODO / Otwarte wątki:

- Szczegółowy układ stron (UI/UX) zostanie zaprojektowany po przygotowaniu wszystkich modułów i akcji.
- Dashboard dla Asystentki (z pełnym widokiem przypomnień) był planowany, ale w MVP rola jest połączona, więc dashboard będzie jeden.

## Funkcja: System Przypomnień

Opis: Śledzenie delegowanych zadań i przypominanie o terminach.

Decyzje / Kierunki:

- [cite_start]Moduł oparty o tabelę `delegacje` w bazie danych[cite: 1].
- [cite_start]Webhook dodaje delegację do bazy (kto, co, deadline)[cite: 1].
- [cite_start]System sprawdza deadline'y i brak odpowiedzi[cite: 3].
- [cite_start]Przypomnienia są dodawane do raportu dziennego ("Sekcja PRZYPOMNIENIA")[cite: 1, 3].
- [cite_start]Umożliwia wysłanie przypomnienia (pojedynczo lub wszystkie)[cite: 1].

## Specyfikacja: Baza Danych (Propozycja)

Opis: Propozycja struktury tabel bazy danych (głównie z `podsumowanie_event_stormingu.md`).

Decyzje / Kierunki:

- [cite_start]**Tabela `emails`:** Przechowuje pobrane emaile i wyniki ich klasyfikacji (kategoria, tagi, folder, podsumowanie, status)[cite: 1].
- [cite_start]**Tabela `delegacje`:** Przechowuje śledzone zadania (FK do email_id, delegat, opis, deadline, status, daty przypomnień)[cite: 1].
- **Tabela `delegaci`:** (Wprowadzana manualnie w MVP) Przechowuje listę osób (imię, email, kompetencje).
- **Tabela `whitelista`:** (Wprowadzana manualnie w MVP) Przechowuje listę zaufanych emaili/domen.
- [cite_start]**Tabela `kontekst_pilnosci`:** Reguły biznesowe dla określania pilności[cite: 1].
- [cite_start]**Tabela `logi`:** (Oznaczona jako TODO) Archiwum akcji systemu[cite: 1].

Uwagi / Alternatywy:

- [cite_start]Zaproponowano również tabele `konwersacje_whatsapp` (dla Phase 2)[cite: 1].

TODO / Otwarte wątki:

- Ostateczny schemat bazy danych (w tym kwestie multi-tenancy i ról) zostanie doprecyzowany na etapie projektowania technicznego.

## Specyfikacja: Bezpieczeństwo i Prywatność

Opis: Wymagania dotyczące obsługi wrażliwych danych (emaile Prezesa).

Decyzje / Kierunki:

- **Wymóg MVP:** Korzystanie wyłącznie z API AI (np. OpenAI) z polityką "zero-retention" (bez zapisywania danych po stronie dostawcy AI).
- **Kierunek (Wersja Finalna):** Docelowo system będzie korzystał z **lokalnych modeli** do przetwarzania wrażliwych danych.

TODO / Otwarte wątki:

- HS10 (z `podsumowanie...`) zawiera listę otwartych pytań dotyczących szyfrowania, kontroli dostępu, RODO i retencji danych, które wymagają dalszej analizy.

## Specyfikacja: AI / Modele Językowe

Opis: Wykorzystanie modeli AI do klasyfikacji, podsumowań i generowania treści.

Decyzje / Kierunki:

- AI będzie używane do: klasyfikacji emaili, generowania podsumowań, generowania draftów (delegacje, odpowiedzi na spotkania), generowania opisu stylu Prezesa.
- Zmiana dostawcy AI (np. z API OpenAI na model lokalny) została uznana przez użytkownika za **kwestię konfiguracyjną, nieistotną** na etapie strategicznym (zmiana 1 linijki kodu/adresu URL).

Uwagi / Alternatywy:

- Odrzucono rekomendację budowania "Bramy AI" (AI Gateway) jako zbędną komplikację na tym etapie.
- Informacja o modelach lokalnych ma być używana marketingowo, ale technicznie nie stanowi wyzwania architektonicznego (wg użytkownika).

## Zarządzanie Projektem: MVP Scope

Opis: Definicja zakresu Pierwszej Wersji Produktu (MVP).

Decyzje / Kierunki:

- **IN SCOPE (Rdzeń):**
  - [cite_start]Proces Operacyjny (pełny)[cite: 1].
  - Akcje: Spam, Delegacja (Podstawowa + Doprecyzowanie), Spotkanie (Tylko Konflikt), Informacyjny, Awaryjna.
  - [cite_start]Baza Delegatów i Whitelista (manualna konfiguracja)[cite: 1].
  - Panel WWW (Konfiguracja, Włączniki Akcji, Ręczna Delegacja).
  - Inicjalizacja (Uproszczone skanowanie stylu).
  - [cite_start]System Podsumowań (generowanie raportu)[cite: 1].
  - [cite_start]Integracja z WhatsApp (wysyłanie podsumowań i powiadomień)[cite: 1].
- **OUT OF SCOPE (Phase 2+):**
  - [cite_start]Zaawansowany Proces Inicjalizacji (pełna nauka stylu, auto-sugerowanie list)[cite: 1].
  - [cite_start]Dwukierunkowa komunikacja WhatsApp (intencje od Prezesa, np. "szukaj...")[cite: 1].
  - Spotkania (automatyczna akceptacja wolnych terminów).
  - [cite_start]Zaawansowany Audyt i Monitoring[cite: 1].
  - Podział na role (Asystent/Prezes).

## Zarządzanie Projektem: Metryki Sukcesu

Opis: Jak mierzony będzie sukces MVP.

Decyzje / Kierunki:

- **Metryka Kluczowa:** Ilość/procent emaili pozostawionych w głównym katalogu (Inbox) lub przeniesionych do katalogu "manualna obsługa" (Cel: jak najmniej).
- **Metryka Zaufania:** 100% poprawności filtrowania Spamu dla adresów z Whitelisty.

TODO / Otwarte wątki:

- Szczegółowy dashboard ze wskaźnikami (np. wykres kołowy) został oznaczony jako TODO (powiązany z logowaniem).

## Zarządzanie Projektem: Logowanie i Monitoring

Opis: Śledzenie działań systemu (dla audytu użytkownika) i stanu technicznego (dla deweloperów).

Decyzje / Kierunki:

- **Decyzja:** Cały temat (zarówno logi użytkownika/audyt, jak i monitoring developerski) został oznaczony jako **TODO**.
- Wymaga kompleksowej uwagi i zaplanowania w **dedykowanej dokumentacji**.
- W PRD ma się pojawić jedynie wzmianka, że jest to element wymagany, ale do doprecyzowania później.

Uwagi / Alternatywy:

- Odrzucono rekomendację (Runda 3, Pkt 7), aby w MVP zaimplementować prosty "Audyt Użytkownika" jako krytyczny dla zaufania. Użytkownik zdecydował o odłożeniu _całego_ tematu logowania.

## Zarządzanie Projektem: Testowanie i Wdrożenie

Opis: Strategia testowania i uruchomienia systemu.

Decyzje / Kierunki:

- **Tryb Testowy:** System musi posiadać globalny "Tryb Testowy", który wyłącza wysyłanie emaili i zamienia je na tworzenie draftów.
- **Przenoszenie Emaili:** Przenoszenie emaili między folderami _musi_ działać nawet w trybie testowym (jest to krytyczna funkcjonalność).

## Otwarte Wątki (Hot Spots)

Opis: Zidentyfikowane problemy (HS) z `podsumowanie_event_stormingu.md`, które nie zostały w pełni rozwiązane.

TODO / Otwarte wątki:

- **HS2 (Format Raportu):** Dokładna struktura i formatowanie raportu sekcyjnego (szczegóły, głębokość podsumowań).
- **HS5 (Parsing Osób/Tematów):** Jak system (w Phase 2) będzie rozpoznawał osoby i tematy z języka naturalnego (Fuzzy matching, semantic search).
- **HS7 (Struktura Bazy):** Ostateczny schemat bazy danych (odłożone).
- **HS8 (Error Handling):** Szczegółowy flow obsługi błędów (Retry, Dead Letter Queue) - poza kategorią AWARYJNA.
- **HS9 (Integracja Kalendarza):** Szczegóły integracji (Google vs Microsoft, domyślny czas spotkań, bufory).
- **HS10 (Bezpieczeństwo):** Szczegóły (Szyfrowanie, RODO, Retencja Danych).
- **HS11 (Wydajność):** Wymagania dotyczące skalowania (ile emaili/dzień, latency, rate limits).
- **HS12 (Testowanie AI):** Jak testować system oparty na niedeterministycznym AI (labeled datasets, UAT).
