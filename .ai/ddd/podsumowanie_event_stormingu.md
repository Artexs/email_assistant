# Podsumowanie Rozmowy - Event Storming: System Automatyzacji Email dla Executive'ów

## <conversation_summary>

### <decisions>

#### **Architektura Systemu**

1. **Dwa główne procesy**: 
   - Proces Inicjalizacji (one-time) - uczenie się stylu prezesa z historii emaili
   - Proces Operacyjny (cykliczny) - pobieranie i przetwarzanie nowych emaili co kilka minut

2. **Model przetwarzania**: 
   - Emaile pobierane synchronicznie (wszystkie nieodczytane od ostatniej aktualizacji)
   - Przetwarzanie natychmiastowe po pobraniu
   - Buforowanie wyników w bazie danych
   - Prezentacja rezultatów w określonych godzinach (np. 10:00 i 14:00) + możliwość manualnego uruchomienia

3. **Usunięcie nadmiarowych kroków**: 
   - Usunięto DE2 (Email zbuforowany) - emaile są od razu przetwarzane
   - Połączono analizę i klasyfikację w jeden krok (DE2)
   - Usunięto filtrację emaili z głównego flow (funkcjonalność na przyszłość)

#### **Kategorie i Flow Przetwarzania Emaili**

4. **Hierarchia folderów** (priorytet malejący):
   - Pilny (najwyższy)
   - VIP/Whitelista
   - Delegacja
   - Spotkanie
   - Informacyjny
   - Spam (najniższy)

5. **System tagowania**: 
   - Email może mieć wiele tagów jednocześnie
   - Fizycznie email trafia do jednego folderu (według hierarchii)
   - Tagowanie następuje sekwencyjnie podczas wykonywania akcji

6. **Kategoria SPAM**:
   - Proste przeniesienie do folderu spam + tagowanie
   - Przyszła funkcjonalność: walidacja na podstawie historii nadawcy
   - Tag dodatkowy: "do sprawdzenia"

7. **Kategoria PILNY**:
   - Dwuetapowa walidacja: wstępna klasyfikacja AI → pobranie kontekstu pilności z bazy → finalna walidacja
   - Powiadomienie asynchroniczne przez WhatsApp
   - Przeniesienie do folderu "ważne"

8. **Whitelista/VIP - zmiana koncepcji**:
   - VIP nie jest osobną kategorią końcową, ale **modyfikatorem priorytetu**
   - Emaile z whitelisty mają wyższy priorytet podczas przetwarzania
   - Łagodniejsze kryteria klasyfikacji (nigdy nie trafiają do spamu)
   - Sprawdzenie whitelisty następuje PRZED analizą AI (statyczna lista z bazy)
   - Po oznaczeniu VIP, email wraca do procesu klasyfikacji z podwyższonym priorytetem

9. **Kategoria DELEGACJA - trzy scenariusze**:
   
   **a) Delegacja Podstawowa** (automatyczna):
   - Zadanie wyodrębnione z emaila
   - Lista delegatów pobrana z bazy danych (statyczna, z opcjonalnym auto-uczeniem)
   - Delegat zidentyfikowany
   - Email delegacji wysłany automatycznie
   - Delegacja zapisana w bazie danych
   - Przypomnienie zaplanowane (sekwencyjnie)
   - Tagowanie i logowanie

   **b) Delegacja Doprecyzowanie** (wymaga akcji prezesa/asystentki):
   - AI wykrywa brak informacji (np. brak adresata, budżetu, deadline)
   - Szablon doprecyzowania generowany
   - Draft email stworzony ale NIE wysłany
   - Delegacja zapisana w bazie jako "wymaga akcji"
   - Log dodany do raportu dziennego

   **c) Delegacja Nieznany Delegat** (błąd):
   - Gdy system nie może zmatchować delegata z bazy
   - Email przeniesiony do folderu "manualna obsługa"
   - Tag: "wymaga interwencji"

10. **Baza Delegatów**:
    - Statyczna lista osób i działów (nazwa, email, opis kompetencji)
    - Tworzona podczas inicjalizacji
    - Opcjonalna funkcjonalność: auto-korekta/auto-uczenie z historii (uruchamiane manualnie)

11. **Kategoria SPOTKANIE - dwa scenariusze**:
    
    **a) Wolny termin**:
    - Kalendarz sprawdzony
    - Termin pokrywa się z wolnym miejscem
    - Spotkanie automatycznie zarezerwowane
    - Potwierdzenie wysłane

    **b) Konflikt terminów**:
    - Konflikt wykryty
    - System znajduje alternatywne wolne terminy
    - Propozycja terminów wysłana
    - Czeka na odpowiedź

12. **Kategoria INFORMACYJNY**:
    - Email podsumowany przez AI
    - Podsumowanie zapisane w bazie danych
    - Tagowanie: "informacyjny"
    - Email przeniesiony do archiwum

13. **Kategoria AWARYJNA**:
    - Dla błędów, braku akcji, lub nieobsłużonych sytuacji
    - Email przeniesiony do folderu "manualna obsługa"
    - Tag: "wymaga interwencji"
    - Log zapisany

#### **System Podsumowań**

14. **Format raportu: Sekcyjny (Typ A)**:
    - Grupowanie po typie akcji
    - Sekcje: PILNE → WYMAGA AKCJI → WYKONANE AUTOMATYCZNIE → PRZYPOMNIENIA
    - Podsumowania w ramach sekcji priorytetyzowane
    - Struktura szczegółowa do dopracowania (HS2)

15. **Agregacja danych**:
    - Tabela w bazie danych z wieloma polami (jeden rekord = jedna wiadomość)
    - Po wygenerowaniu raportu rekordy przenoszone do tabeli "logi"
    - Raport generowany na podstawie danych z tabeli "emails" + "delegacje"

16. **Harmonogram**:
    - Cronjob uruchamiany o określonych godzinach (np. 10:00, 14:00)
    - Możliwość manualnego uruchomienia przez prezesa
    - Webhook pobiera dane z bazy → generuje raport → wysyła przez WhatsApp

#### **Moduł WhatsApp**

17. **Centralne miejsce komunikacji**:
    - Powiadomienia pilne (asynchroniczne)
    - Cykliczne podsumowania dzienne
    - Dwukierunkowa komunikacja z prezesem
    - Kolejka wiadomości WhatsApp

18. **Intencje od Prezesa** (4 główne):

    **a) Wyślij nowy email**:
    - Konwersacja dwukierunkowa (multi-turn)
    - Draft generowany → akceptacja/modyfikacja → wysyłka
    - Stan konwersacji do zarządzania (HS4)

    **b) Lista przypomnień**:
    - Parametr czasu: dziś/jutro/zakres
    - Pobieranie z bazy delegacji według deadline
    - Raport przypomnień wysyłany na WhatsApp

    **c) Szukaj konwersacji**:
    - Parametry: osoba/temat/zakres czasu
    - Przeszukiwanie emaili z ostatnich dni
    - Podsumowanie konwersacji generowane
    - Parsing osoby/tematu wymaga dopracowania (HS5)

    **d) Wyślij przypomnienie**:
    - Parametry: pojedyncze/wszystkie
    - Email przypomnienia generowany
    - Status delegacji aktualizowany w bazie

19. **Obsługa audio i tekstu**:
    - Transkrypcja głosu przez model AI (Whisper lub podobny)
    - Parsing intencji z tekstu
    - Rozpoznawanie akcji

#### **Baza Delegacji (System Przypomnień)**

20. **Struktura modułu**:
    - Dwie części: Zapis i Odczyt
    - Webhook dodaje delegację do bazy (z info: kto, co, deadline)
    - Webhooks do odczytu: generuj raport, aktualizuj/usuń zadania

21. **Punkty wejścia**:
    - Z kategorii Delegacja → zapis do bazy
    - Z systemu podsumowań → odczyt raportu
    - Z modułu WhatsApp → odczyt na żądanie prezesa

22. **UI delegacji**:
    - Strona WWW z dashboardem
    - Lista przypomnień: przeterminowane + w trakcie
    - Button "Wyślij przypomnienie" (pojedynczo lub wszystkie)

#### **Struktura Bazy Danych** (propozycja eksperta)

23. **Tabela `emails`**:
    - Pola: id, email_id, from, to, subject, body, received_at
    - kategoria (spam/delegacja/pilny/...)
    - tagi (array)
    - folder (według hierarchii)
    - podsumowanie (AI summary)
    - status (processed/pending/error)
    - created_at, updated_at

24. **Tabela `delegacje`**:
    - Pola: id, email_id (FK)
    - delegat_name, delegat_email
    - tytul, opis, deadline
    - status (wyslane/czeka_na_odpowiedz/przeterminowane/zakonczone)
    - data_wyslania, data_przypomnienia
    - created_at, updated_at

25. **Tabela `logi`** (archiwum):
    - Pola: id, email_id (FK), akcja, szczegoly (JSON), timestamp

#### **Error Handling**

26. **Obsługa błędów**:
    - Błędy podczas wysyłania: osobny error handler (do implementacji później)
    - Każda nieobsłużona sytuacja trafia do kategorii AWARYJNA
    - Folder "manualna obsługa" + tag "wymaga interwencji"

</decisions>

---

### <matched_recommendations>

#### **Event Storming - Metodyka**

1. **Rozpoczęcie od procesu głównego (operacyjnego)**: Zgodnie z Alberto Brandolini - "start with the money-making process". Proces inicjalizacji odkrywany później.

2. **Domain Events w czasie przeszłym**: Wszystkie zdarzenia nazwane jako fakty (np. "Email pobrany", "Delegacja wysłana").

3. **Hierarchia akcji przez priorytety**: System priorytetyzacji folderów zapewnia, że najważniejsze akcje nie są przegapiane.

4. **Batch processing z delayed notification**: Pattern "Quiet Period" - pobieranie częste (co kilka minut), ale prezentacja rzadka (co kilka godzin), chroni prezesa przed bombardowaniem, ale zachowuje aktualność danych.

5. **Multi-Action with Single-Folder Constraint**: Email może mieć wiele akcji/tagów, ale fizycznie jest w jednym folderze. Zapobiega chaosowi w skrzynce.

#### **Automatyzacja Emaili - Best Practices**

6. **Whitelista jako modifier, nie kategoria**: VIP emails nie są izolowane, ale mają wyższy priorytet podczas całego przetwarzania. Zapobiega "VIP vs Pilny" konfliktom.

7. **Dwuetapowa walidacja pilności**: Wstępna klasyfikacja AI + kontekst biznesowy z bazy danych. Redukuje false positives (fałszywe alarmy).

8. **Kategoria awaryjna jako safety net**: Każdy edge case ma miejsce docelowe zamiast powodować crash systemu.

9. **Raport sekcyjny (Typ A) dla executive'ów**: 
   - Najbardziej "actionable" - prezes wie co robić
   - Łatwy do implementacji (proste GROUP BY)
   - Naturalnie odpowiada kategoriom systemowym

10. **Delegacje z przypomnieniami**: Closed-loop pattern - system nie tylko deleguje, ale też śledzi realizację. Zwiększa odpowiedzialność zespołu.

#### **User Experience**

11. **WhatsApp jako central hub**: Prezes nie musi uczyć się nowego UI, używa znanego narzędzia. Obniża próg wejścia.

12. **Konwersacyjny interfejs dla złożonych akcji**: Dla tworzenia emaili system prowadzi dialog, zamiast pokazywać formularz. Naturalne dla użytkowników executive-level.

13. **Dashboard WWW jako "advanced view"**: Dla asystentek i power-users, którzy potrzebują pełnego przeglądu.

14. **Hybrid approach dla przypomnień**: Przeterminowane w dziennym raporcie (natychmiastowa akcja) + osobny dashboard (planowanie). Balance między wygodą a kontrolą.

#### **Architektura Techniczna**

15. **Statyczna baza delegatów z opcjonalnym uczeniem**: Prosty start (manual setup), ale możliwość ewolucji (ML). MVP-first approach.

16. **Asynchroniczne powiadomienia**: System nie blokuje się na wysyłce, może procesować kolejne emaile. Lepsza wydajność.

17. **Logging wszystkich akcji**: Pełny audit trail dla transparentności i debugowania.

18. **Separation of concerns**: Osobne moduły: przetwarzanie emaili, baza delegacji, system podsumowań, moduł WhatsApp. Łatwiejsze maintenance.

#### **AI/ML Strategy**

19. **Proces inicjalizacji (uczenie się stylu)**: System najpierw się uczy z historii, potem automatyzuje nowe emaile. Zapewnia autentyczność odpowiedzi.

20. **Transkrypcja głosu przez dedykowany model**: Odseparowanie voice-to-text od intent recognition. Modular approach.

21. **Intent recognition z tekstu**: Rozpoznawanie 4+ głównych intencji od prezesa. Extensible na przyszłość.

</matched_recommendations>

---

### <prd_planning_summary>

## **Executive Email Automation System - MVP Planning Summary**

### **Vision & Problem Statement**

System automatyzacji emaili dla menedżerów wyższego szczebla i ich asystentek, którego głównym celem jest **oszczędność czasu** poprzez inteligentne przetwarzanie, klasyfikację i delegację emaili.

**Kluczowy problem**: Prezesi i menedżerowie tonują w emailach. Większość wiadomości wymaga prostych akcji (delegacja, potwierdzenie spotkania, archiwizacja), ale zajmuje cenny czas.

**Rozwiązanie**: System AI, który:
1. Automatycznie klasyfikuje i przetwarza emaile
2. Deleguje zadania do odpowiednich osób
3. Zarządza spotkaniami
4. Prezentuje tylko to, co wymaga osobistej uwagi prezesa
5. Umożliwia zarządzanie przez WhatsApp (bez logowania do nowego systemu)

---

### **User Stories & Use Cases**

#### **Epic 1: Automatyczne Przetwarzanie Emaili**

**US-1.1**: Jako prezes, chcę aby system automatycznie pobierał moje nowe emaile co kilka minut, żebym nie musiał ręcznie sprawdzać skrzynki.
- **Acceptance Criteria**: 
  - System pobiera emaile cyklicznie (konfigurowalny interwał, domyślnie: co 5 minut)
  - Pobierane są tylko nieodczytane emaile od ostatniej synchronizacji
  - System może być uruchomiony manualnie przez prezesa

**US-1.2**: Jako prezes, chcę aby spam i newslettery były automatycznie usuwane z mojego widoku, żebym widział tylko istotne wiadomości.
- **Acceptance Criteria**:
  - Emaile sklasyfikowane jako spam są przenoszone do folderu "Spam"
  - System taguje wiadomości jako "spam"
  - W przyszłości: walidacja na podstawie historii nadawcy

**US-1.3**: Jako prezes, chcę otrzymywać natychmiastowe powiadomienie o pilnych emailach, żebym mógł szybko zareagować na kryzysowe sytuacje.
- **Acceptance Criteria**:
  - AI klasyfikuje emaile jako potencjalnie pilne
  - System pobiera kontekst pilności z bazy danych (firma, stanowisko, kontrahenci)
  - Finalna walidacja pilności
  - Powiadomienie wysyłane asynchronicznie na WhatsApp
  - Email przenoszony do folderu "Ważne"

**US-1.4**: Jako prezes, chcę aby emaile od VIP-ów (zarząd, akcjonariusze) były traktowane priorytetowo, ale nadal automatycznie przetwarzane.
- **Acceptance Criteria**:
  - Whitelista adresów email w bazie danych
  - Emaile z whitelisty mają wyższy priorytet podczas klasyfikacji
  - Łagodniejsze kryteria (nigdy nie trafiają do spamu)
  - Mogą być oznaczone jako pilne i otrzymać natychmiastowe powiadomienie

#### **Epic 2: Automatyczna Delegacja Zadań**

**US-2.1**: Jako prezes, chcę aby system automatycznie delegował proste zadania do odpowiednich osób, żebym nie musiał tego robić ręcznie.
- **Acceptance Criteria**:
  - System wyodrębnia zadanie z treści emaila
  - Pobiera listę delegatów z bazy danych (imię, email, kompetencje)
  - Identyfikuje odpowiedniego delegata
  - Wysyła email delegacji automatycznie
  - Zapisuje delegację w bazie z deadline
  - Planuje przypomnienie w przypadku braku odpowiedzi

**US-2.2**: Jako prezes, chcę otrzymywać draft emaila delegacji gdy system nie ma wystarczających informacji, żebym mógł go uzupełnić przed wysłaniem.
- **Acceptance Criteria**:
  - AI wykrywa brak kluczowych informacji (delegat, deadline, budżet itp.)
  - Generuje szablon delegacji z pytaniami
  - Tworzy draft email (NIE wysyła)
  - Zapisuje w bazie jako "wymaga akcji"
  - Informacja pojawia się w dziennym raporcie

**US-2.3**: Jako prezes, chcę otrzymywać przypomnienia o delegacjach bez odpowiedzi, żebym mógł ponaglić realizację lub ponownie przypisać zadanie.
- **Acceptance Criteria**:
  - System sprawdza deadline delegacji raz dziennie
  - Wykrywa brak odpowiedzi po X dniach (konfigurowalny)
  - Dodaje przypomnienie do dziennego raportu
  - Umożliwia wysłanie przypomnienia (pojedynczo lub wszystkie naraz)
  - Aktualizuje status delegacji w bazie

**US-2.4**: Jako prezes, gdy system nie może zidentyfikować delegata, chcę aby email trafił do mojej asystentki, żeby mogła go ręcznie przypisać.
- **Acceptance Criteria**:
  - Email przenoszony do folderu "Manualna obsługa"
  - Tag: "wymaga interwencji"
  - Log zapisany w bazie
  - Informacja w dziennym raporcie

#### **Epic 3: Automatyczne Zarządzanie Spotkaniami**

**US-3.1**: Jako prezes, chcę aby system automatycznie rezerwował spotkania gdy proponowany termin jest wolny, żebym nie tracił czasu na potwierdzenia.
- **Acceptance Criteria**:
  - System sprawdza kalendarz
  - Jeśli termin z emaila jest wolny → rezerwuje automatycznie
  - Wysyła potwierdzenie do nadawcy
  - Taguje email jako "spotkanie"
  - Log w bazie danych

**US-3.2**: Jako prezes, gdy termin spotkania koliduje z moim kalendarzem, chcę aby system zaproponował alternatywne terminy, żebym nie musiał sam ich szukać.
- **Acceptance Criteria**:
  - System wykrywa konflikt terminów
  - Znajduje 3-5 najbliższych wolnych terminów
  - Wysyła propozycję do nadawcy
  - Czeka na odpowiedź
  - Log w bazie danych

#### **Epic 4: Cykliczne Podsumowania**

**US-4.1**: Jako prezes, chcę otrzymywać podsumowanie emaili 2 razy dziennie (np. 10:00 i 14:00), żebym wiedział co się dzieje bez ciągłego sprawdzania skrzynki.
- **Acceptance Criteria**:
  - Cronjob uruchamiany o określonych godzinach (konfigurowalny)
  - Pobiera dane z bazy (tabela emails + delegacje)
  - Generuje raport sekcyjny (format A)
  - Wysyła na WhatsApp jako wiadomość tekstowa
  - Publikuje pełną wersję na stronie WWW

**US-4.2**: Jako prezes, chcę móc ręcznie wygenerować podsumowanie w dowolnym momencie, na wypadek gdybym potrzebował szybkiej aktualizacji.
- **Acceptance Criteria**:
  - Webhook/button na WhatsApp lub stronie WWW
  - Generuje raport on-demand
  - Wysyła natychmiast

**US-4.3**: Jako prezes, chcę aby podsumowanie było podzielone na sekcje, żebym od razu wiedział co wymaga mojej akcji.
- **Acceptance Criteria**:
  - Sekcja 1: PILNE (z linkami do emaili)
  - Sekcja 2: WYMAGA AKCJI (drafty do akceptacji, konflikty spotkań)
  - Sekcja 3: WYKONANE AUTOMATYCZNIE (delegacje, spotkania, podsumowania)
  - Sekcja 4: PRZYPOMNIENIA (przeterminowane + zbliżające się)
  - W każdej sekcji: priorytetyzacja wg ważności

#### **Epic 5: Moduł WhatsApp (dwukierunkowa komunikacja)**

**US-5.1**: Jako prezes, chcę móc dyktować nowy email przez WhatsApp (głosowo lub tekstowo), żeby system go wygenerował i wysłał.
- **Acceptance Criteria**:
  - Transkrypcja głosu (Whisper API lub podobny)
  - Rozpoznanie intencji: "wyślij email"
  - Rozpoczęcie konwersacji dwukierunkowej
  - Generowanie draftu na podstawie dyktowania
  - Prezentacja draftu do akceptacji
  - Możliwość modyfikacji przez prezesa
  - Wysyłka po potwierdzeniu

**US-5.2**: Jako prezes, chcę móc zapytać system o listę przypomnień (dziś/jutro), żebym wiedział jakie delegacje są w trakcie.
- **Acceptance Criteria**:
  - Rozpoznanie intencji: "pokaż przypomnienia"
  - Parsing parametru czasu (dziś, jutro, zakres)
  - Pobieranie z bazy delegacji według deadline
  - Generowanie raportu przypomnień
  - Wysłanie na WhatsApp

**US-5.3**: Jako prezes, chcę móc wyszukać historię konwersacji z daną osobą lub na dany temat, żebym szybko przypomniał sobie kontekst.
- **Acceptance Criteria**:
  - Rozpoznanie intencji: "szukaj konwersacji"
  - Parsing parametrów: osoba, temat, zakres czasu
  - Przeszukiwanie emaili w bazie danych (ostatnie X dni)
  - Generowanie podsumowania konwersacji
  - Wysłanie na WhatsApp

**US-5.4**: Jako prezes, chcę móc wysłać przypomnienie do delegata (lub wszystkich naraz), gdy widzę że zadanie się opóźnia.
- **Acceptance Criteria**:
  - Rozpoznanie intencji: "wyślij przypomnienie"
  - Parsing parametrów: pojedyncze/wszystkie, do kogo
  - Generowanie emaila przypomnienia
  - Wysyłka
  - Aktualizacja statusu w bazie

#### **Epic 6: Dashboard WWW (dla asystentek i power-users)**

**US-6.1**: Jako asystentka, chcę widzieć dashboard z listą wszystkich przypomnień (przeterminowane + w trakcie), żebym mogła zarządzać delegacjami.
- **Acceptance Criteria**:
  - Strona WWW z tabelą delegacji
  - Filtry: przeterminowane, w trakcie, zakończone
  - Sortowanie: deadline, osoba, status
  - Akcje: wyślij przypomnienie, edytuj, usuń
  - Real-time aktualizacja

**US-6.2**: Jako asystentka, chcę widzieć pełną wersję raportu dziennego na stronie WWW, żebym miała więcej szczegółów niż prezes na WhatsApp.
- **Acceptance Criteria**:
  - Wszystkie sekcje z wersji WhatsApp
  - Dodatkowe szczegóły: pełne treści emaili, załączniki
  - Linki do oryginalnych emaili w skrzynce
  - Historia raportów (archiwum)

---

### **Success Criteria & Metrics**

#### **Business Metrics**

1. **Oszczędność czasu prezesa**:
   - Target: 80% emaili obsłużonych automatycznie (bez interwencji prezesa)
   - Measurement: Stosunek emaili automatycznych do wymagających akcji prezesa

2. **Redukcja czasu spędzonego na emailach**:
   - Target: -60% czasu dziennie (z ~2h do ~45min)
   - Measurement: Self-reported time tracking przez prezesa (przed/po)

3. **Czas reakcji na pilne emaile**:
   - Target: <5 minut od otrzymania do powiadomienia prezesa
   - Measurement: Timestamp otrzymania vs timestamp wysłania powiadomienia

4. **Closed-loop delegacji**:
   - Target: 90% delegacji zakończonych na czas (po implementacji przypomnień)
   - Measurement: Stosunek delegacji on-time do przeterminowanych

#### **Technical Metrics**

5. **Accuracy klasyfikacji**:
   - Target: >85% zgodność z intencją prezesa
   - Measurement: Feedback prezesa ("to było spam", "to było pilne") + ręczne reklasyfikacje

6. **System uptime**:
   - Target: 99.5% dostępności
   - Measurement: Monitoring cykli pobierania emaili

7. **Latency przetwarzania**:
   - Target: <30 sekund na email (od pobrania do zakończenia akcji)
   - Measurement: Timestamps w logach

#### **User Satisfaction Metrics**

8. **NPS (Net Promoter Score)**:
   - Target: >50 (po 3 miesiącach użytkowania)
   - Measurement: Quarterly survey

9. **Adoption rate funkcji WhatsApp**:
   - Target: Prezes używa >3 intencji tygodniowo
   - Measurement: Tracking wywołań intencji

---

### **Technical Architecture (High-Level)**

#### **Components**

1. **Email Processor Service** (Python/Node.js):
   - Połączenie z serwerem email (IMAP/Gmail API)
   - Cykliczne pobieranie (cron: */5 * * * *)
   - Klasyfikacja AI (OpenAI API / Claude API)
   - Orchestracja akcji

2. **Database** (PostgreSQL):
   - Tabele: emails, delegacje, logi, whitelista, kontekst_pilności, delegaci
   - Full-text search dla wyszukiwania konwersacji

3. **WhatsApp Integration** (Twilio API / WhatsApp Business API):
   - Kolejka wiadomości (Redis)
   - Webhook dla incoming messages
   - Audio transcription (Whisper API)

4. **Calendar Integration** (Google Calendar API / Microsoft Graph):
   - Sprawdzanie dostępności
   - Rezerwacje automatyczne

5. **Web Dashboard** (React/Next.js):
   - Strona dla asystentek
   - Real-time updates (WebSockets)

6. **Report Generator Service** (Python):
   - Cronjob dla cyklicznych podsumowań
   - Template engine dla formatowania

#### **AI/ML Stack**

- **Klasyfikacja emaili**: GPT-4 / Claude Sonnet z few-shot prompting
- **Generowanie odpowiedzi**: Fine-tuned model na stylu prezesa (Proces Inicjalizacji)
- **Intent recognition**: GPT-4 / Claude z structured outputs
- **Transkrypcja**: Whisper API
- **Semantic search**: Embeddings (OpenAI ada-002) + vector DB (Pinecone/Weaviate)

---

### **MVP Scope (Phase 1)**

**IN SCOPE**:
- ✅ Proces Operacyjny (pełny flow przetwarzania emaili)
- ✅ Kategorie: Spam, Pilny, Delegacja (podstawowa + doprecyzowanie), Spotkanie, Informacyjny, Awaryjna
- ✅ System podsumowań (raport sekcyjny, 2x dziennie)
- ✅ Moduł WhatsApp (wysyłanie powiadomień + cykliczne podsumowania)
- ✅ Baza delegacji (zapis + odczyt)
- ✅ Dashboard WWW (basic - lista przypomnień + raporty)
- ✅ Statyczna baza delegatów (manual setup)

**OUT OF SCOPE** (Phase 2+):
- ❌ Proces Inicjalizacji (uczenie się stylu prezesa)
- ❌ Dwukierunkowa komunikacja WhatsApp (4 intencje)
- ❌ Auto-uczenie bazy delegatów
- ❌ Walidacja spamu na podstawie historii
- ❌ Advanced analytics i reporty
- ❌ Multi-user support (więcej niż 1 prezes)

---

### **Key User Flows**

#### **Flow 1: Email Pilny → Powiadomienie**

```
1. Email pobrany (09:45)
2. AI klasyfikuje jako potencjalnie pilny (temat: "URGENT", nadawca: CEO)
3. System pobiera kontekst pilności z bazy (CEO = VIP, zawsze pilne)
4. Finalna walidacja: PILNY ✓
5. Email przeniesiony do folderu "Ważne"
6. Tag: "pilny"
7. Log zapisany w bazie
8. Powiadomienie dodane do kolejki WhatsApp
9. [ASYNC] Powiadomienie wysłane na WhatsApp (09:45:15)
10. Prezes widzi: "🔥 PILNY: Email od CEO - Spotkanie zarządu - potwierdzenie [Link]"
11. Prezes klika link → otwiera email w skrzynce → odpowiada
```

#### **Flow 2: Delegacja Podstawowa → Przypomnienie**

```
1. Email pobrany: "Proszę o przygotowanie raportu Q4 do 20.11"
2. AI klasyfikuje: Delegacja
3. Zadanie wyodrębnione: "Raport Q4, deadline: 20.11"
4. Lista delegatów pobrana z bazy
5. Delegat zidentyfikowany: Jan Kowalski (kompetencje: "raporty finansowe")
6. Email delegacji wygenerowany i wysłany: "Witaj Jan, proszę o przygotowanie raportu Q4 do 20.11. [Szczegóły]"
7. Delegacja zapisana w bazie (deadline: 20.11, przypomnienie: 23.11 jeśli brak odpowiedzi)
8. Tag: "delegacja"
9. Log zapisany
---
[Po 3 dniach, 23.11, brak odpowiedzi od Jana]
---
10. System sprawdza deadline'y (cronjob, 08:00)
11. Wykrywa: Delegacja do Jana przeterminowana o 3 dni
12. Przypomnienie dodane do kolejki
---
[O 10:00 - Cykliczne podsumowanie]
---
13. Raport dzienny generowany
14. Sekcja PRZYPOMNIENIA: "🔴 Przeterminowane: Zadanie dla Kowalski - Raport Q4 - opóźnienie: 3 dni [Wyślij przypomnienie]"
15. Raport wysłany na WhatsApp
16. Prezes klika [Wyślij przypomnienie]
17. System wysyła email przypomnienia do Jana
18. Status delegacji zaktualizowany w bazie
```

#### **Flow 3: Spotkanie z Konfliktem → Propozycja**

```
1. Email pobrany: "Czy możemy się spotkać 16.11 o 14:00?"
2. AI klasyfikuje: Spotkanie
3. Kalendarz sprawdzony
4. Konflikt wykryty (16.11, 14:00 zajęte)
5. System szuka wolnych terminów (najbliższe 3-5 dni)
6. Znalezione: 17.11 10:00, 17.11 15:00, 18.11 14:00
7. Propozycja wygenerowana: "Niestety 16.11 o 14:00 jestem zajęty. Proponuję: 1) 17.11, 10:00, 2) 17.11, 15:00, 3) 18.11, 14:00. Który termin Ci pasuje?"
8. Email wysłany
9. Tag: "spotkanie"
10. Log zapisany
---
[W dziennym raporcie o 10:00]
---
11. Sekcja WYMAGA AKCJI: "Spotkanie z Smith - konflikt terminów - propozycja wysłana, czekam na odpowiedź"
```

</prd_planning_summary>

---

### <unresolved_issues>

#### **HS1: VIP - Mechanizm Re-analizy z Wyższym Priorytetem**

**Problem**: Nie jest jasne, jak dokładnie działa flow dla emaili z whitelisty.

**Pytania do rozstrzygnięcia**:
1. Czy email VIP wraca do etapu analizy/klasyfikacji (DE2) z **innym kontekstem**?
2. Czy może VIP to **modifier**, a nie osobna kategoria?
   - Email może być: "VIP + Delegacja" lub "VIP + Pilny" jednocześnie
   - VIP zmienia tylko **progi decyzyjne** (np. nigdy nie trafia do spamu, wyższy próg pilności)
3. Jak technicznie zaimplementować "łagodniejsze kryteria"?
   - Inny prompt dla AI?
   - Scoring/threshold adjustment?
   - Whitelist bypass określonych kategorii?

**Rekomendacja**: VIP jako modifier (opcja 2) wydaje się prostsza i bardziej elastyczna. Email może mieć VIP tag + normalną kategorię.

---

#### **HS2: Struktura Raportu Sekcyjnego - Szczegóły Formatowania**

**Problem**: Potrzebujemy doprecyzować format raportu wysyłanego na WhatsApp i WWW.

**Pytania do rozstrzygnięcia**:
1. **Głębokość podsumowań emaili informacyjnych**:
   - 2-3 zdania?
   - Bullet points z kluczowymi faktami?
   - Tylko tytuł + link do pełnej treści?

2. **Przypomnienia - ile pokazywać "w trakcie"**:
   - Tylko zbliżające się (deadline w ciągu 2 dni)?
   - Wszystkie aktywne?
   - Top 5 najbliższych?

3. **Czy prezes chce widzieć spam w raporcie**:
   - Prawdopodobnie NIE, ale warto potwierdzić
   - Może sekcja "📉 Zignorowane (spam): 15 emaili" bez szczegółów?

4. **Formatowanie dla WhatsApp vs WWW**:
   - WhatsApp: skrócona wersja (tylko najważniejsze)
   - WWW: pełna wersja z attachments, pełne treści, history
   - Czy różne sekcje mają być collapsible na WWW?

**Prototyp raportu został zaproponowany w sekcji <prd_planning_summary>**, ale wymaga feedback od użytkownika.

---

#### **HS3: Rozpoznawanie Intencji od Prezesa - Pełna Lista**

**Problem**: Zidentyfikowano 4 główne intencje, ale prawdopodobnie będzie ich więcej.

**Pytania do rozstrzygnięcia**:
1. **Czy są jeszcze inne intencje poza 4 głównymi**?
   - "Pokaż draft emaili do akceptacji"?
   - "Zaktualizuj deadline delegacji"?
   - "Anuluj delegację"?
   - "Dodaj osobę do whitelisty/bazy delegatów"?
   - "Zmień priorytet emaila"?
   - "Przenieś email do innego folderu"?

2. **Jak rozróżniać podobne intencje**?
   - "Pokaż przypomnienia" vs "Wyślij przypomnienia"
   - "Szukaj emaili od Kowalskiego" vs "Wyślij email do Kowalskiego"
   - Czy system pyta o doprecyzowanie, czy próbuje zgadnąć z kontekstu?

3. **Czy prezes może używać skrótów/slang**?
   - "Wyślij przypomnienie Kowalskiemu" zamiast pełnego zdania
   - "Lista zadań dziś"
   - "Co z tym raportem Q4?"

**Rekomendacja**: Start z 4 intencjami w MVP, ale architektura powinna być extensible (plugin system dla intencji).

---

#### **HS4: Konwersacja Dwukierunkowa - Zarządzanie Stanem**

**Problem**: Jak zarządzać stanem wieloetapowej konwersacji prezesa z systemem przez WhatsApp?

**Pytania do rozstrzygnięcia**:
1. **Gdzie przechowywać stan konwersacji**?
   - Opcja A: W pamięci sesji WhatsApp (może się zgubić)
   - Opcja B: W bazie danych (tabela "konwersacje" z session_id, state, context)
   - Opcja C: Context window LLM (cała historia w prompt)
   - **Rekomendacja eksperta**: Opcja B (baza) + C (LLM) - baza jako backup, LLM dla elastyczności

2. **Timeout konwersacji**?
   - Jeśli prezes nie odpowie przez X minut (15? 30?), co się dzieje?
   - Draft trafia automatycznie do "wymaga akcji"?
   - System pyta: "Czy chcesz kontynuować później?"
   - Czy konwersacja może być wznowiona?

3. **Czy prezes może prowadzić kilka konwersacji równolegle**?
   - Np. dyktuje email do Kowalskiego, ale w międzyczasie pyta o przypomnienia
   - Jak system wie, do której konwersacji należy odpowiedź?
   - Czy każda intencja tworzy osobną "sesję"?
   - Czy system pokazuje "breadcrumbs": "Tworzysz email do Kowalskiego. [Anuluj] [Kontynuuj]"

4. **Error handling w konwersacji**?
   - Co jeśli prezes powie coś niezrozumiałego?
   - System pyta: "Nie rozumiem, czy możesz doprecyzować?"
   - Ile razy system może pytać zanim "się podda"?

**Rekomendacja**: To jest OUT OF SCOPE dla MVP (Phase 2). W MVP tylko wysyłanie powiadomień + raporty (jednokierunkowe).

---

#### **HS5: Parsing Osoby/Tematu z Tekstu - NLP & Matching**

**Problem**: Jak rozpoznawać osoby i tematy z naturalnego języka prezesa?

**Pytania do rozstrzygnięcia**:

1. **Rozpoznawanie osób**:
   - Matching po nazwisku w bazie delegatów?
   - Fuzzy matching ("Kowalski" = "Jan Kowalski" = "kowalski@firma.pl" = "Kowalski z finansów")?
   - Co jeśli jest kilku Kowalskich w firmie?
     - System pyta: "Którego Kowalskiego? 1) Jan Kowalski (Finanse), 2) Piotr Kowalski (IT)"
   - Czy system pamięta częste skróty prezesa? (np. "JK" = Jan Kowalski)

2. **Rozpoznawanie tematów**:
   - Keyword matching w subject/body emaili? (proste, ale niedokładne)
   - Semantic search z embeddings? (dokładniejsze, ale droższe)
   - Predefiniowane tagi/projekty w bazie?
   - Kombinacja: keyword search + semantic search dla top 10 wyników

3. **Rozpoznawanie zakresu czasu**:
   - "ostatnie 3 dni" = parsing NLP (dateparser library)
   - Predefiniowane: "dziś", "wczoraj", "ten tydzień", "ostatni miesiąc"
   - Co jeśli prezes powie "od poniedziałku"? 
     - Czy system zakłada "ostatni poniedziałek" czy "najbliższy przyszły"?
     - Pytanie doprecyzowujące?

4. **Kombinowane query**:
   - "Co pisał Kowalski o raporcie Q4 w ostatnim tygodniu?"
   - Jak parsować: osoba + temat + czas w jednym zdaniu?
   - Czy używamy structured output (JSON) z LLM do ekstrakcji parametrów?

**Rekomendacja**: To jest OUT OF SCOPE dla MVP. W Phase 2 użyć LLM z structured output do ekstrakcji parametrów + semantic search dla emaili.

---

#### **HS6: Proces Inicjalizacji - Uczenie Się Stylu Prezesa**

**Problem**: Nie został jeszcze szczegółowo omówiony proces uczenia się stylu prezesa z historii emaili.

**Pytania do rozstrzygnięcia**:
1. **Co dokładnie system uczy się**?
   - Ton (formalny/nieformalny, bezpośredni/dyplomatyczny)
   - Długość odpowiedzi (zwięzłe/obszerne)
   - Często używane frazy ("Dziękuję za...", "Proszę o...")
   - Struktura emaili (nagłówek, body, zakończenie)
   - Preferowane formy adresowania ("Pan/Pani", "Ty", "Wy")

2. **Jak dużo historii trzeba**?
   - Minimum: 100 emaili? 500? 1000?
   - Czy system potrzebuje emaili **wysłanych przez prezesa**, czy też otrzymane?
   - Czy uwzględniamy tylko odpowiedzi, czy też emaile inicjujące?

3. **Proces techniczny**:
   - Fine-tuning modelu LLM (GPT-3.5/4)? Kosztowne, ale dokładne.
   - Few-shot prompting z przykładami z historii? Tańsze, prostsze.
   - Retrieval-Augmented Generation (RAG): dla każdego draftu pobierz podobne historyczne emaile jako przykłady?

4. **Jak często odświeżać model**?
   - Jednorazowo podczas onboardingu?
   - Regularnie (co miesiąc/kwartał) na podstawie nowych emaili?
   - On-demand gdy prezes zaakceptuje/odrzuci sugestię systemu (reinforcement learning)?

5. **Eventy procesu inicjalizacji**:
   - DE_INIT_1: Konto email połączone
   - DE_INIT_2: Historia emaili zaimportowana
   - DE_INIT_3: Emaile wstępnie przefiltrowane (tylko wysłane przez prezesa)
   - DE_INIT_4: Model stylu wygenerowany
   - DE_INIT_5: Model zwalidowany (przez próbkę)
   - DE_INIT_6: Model zaakceptowany przez prezesa
   - DE_INIT_7: System gotowy do pracy

**Rekomendacja**: To jest OUT OF SCOPE dla MVP. W Phase 1 używamy generic templates dla delegacji/potwierdzeń spotkań. W Phase 2 dodajemy personalizację.

---

#### **HS7: Struktura Bazy Danych - Doprecyzowanie**

**Problem**: Zaproponowano strukturę tabel, ale wymaga potwierdzenia i doprecyzowania

**Pytania do rozstrzygnięcia**:

1. **Tabela `emails` - dodatkowe pola**:
   ```sql
   CREATE TABLE emails (
     id UUID PRIMARY KEY,
     email_id VARCHAR(255) UNIQUE, -- ID z serwera email
     thread_id VARCHAR(255), -- dla grupowania konwersacji
     from_email VARCHAR(255),
     from_name VARCHAR(255),
     to_email VARCHAR(255),
     to_name VARCHAR(255),
     subject TEXT,
     body TEXT,
     html_body TEXT,
     attachments JSONB, -- [{name, size, type, url}]
     received_at TIMESTAMP,
     processed_at TIMESTAMP,
     
     -- Klasyfikacja
     kategoria VARCHAR(50), -- spam/delegacja/pilny/spotkanie/informacyjny/awaryjna
     tagi TEXT[], -- array: ['vip', 'pilny', 'delegacja']
     folder VARCHAR(100), -- według hierarchii
     confidence_score FLOAT, -- 0-1, pewność klasyfikacji AI
     
     -- AI Processing
     podsumowanie TEXT, -- AI summary
     intencja TEXT, -- extracted intent
     entities JSONB, -- extracted: osoby, daty, kwoty, etc.
     
     -- Status
     status VARCHAR(50), -- processed/pending/error/requires_action
     error_message TEXT,
     
     -- Metadata
     is_vip BOOLEAN DEFAULT FALSE,
     is_read BOOLEAN DEFAULT FALSE,
     priority INTEGER DEFAULT 0, -- 0-10 dla sortowania
     
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   );
   
   CREATE INDEX idx_emails_kategoria ON emails(kategoria);
   CREATE INDEX idx_emails_received_at ON emails(received_at);
   CREATE INDEX idx_emails_status ON emails(status);
   CREATE INDEX idx_emails_thread_id ON emails(thread_id);
   ```

   **Pytanie**: Czy ta struktura pokrywa wszystkie use case'y?

2. **Tabela `delegacje` - relacje i statusy**:
   ```sql
   CREATE TABLE delegacje (
     id UUID PRIMARY KEY,
     email_id UUID REFERENCES emails(id),
     
     -- Delegat
     delegat_name VARCHAR(255),
     delegat_email VARCHAR(255),
     delegat_id UUID, -- FK do tabeli delegaci (jeśli istnieje)
     
     -- Zadanie
     tytul TEXT,
     opis TEXT,
     deadline DATE,
     priorytet VARCHAR(20), -- low/medium/high/urgent
     
     -- Status tracking
     status VARCHAR(50), -- wyslane/czeka_na_odpowiedz/przeterminowane/zakonczone/anulowane
     data_wyslania TIMESTAMP,
     data_odpowiedzi TIMESTAMP,
     data_zakonczenia TIMESTAMP,
     
     -- Przypomnienia
     przypomnienie_po_dniach INTEGER DEFAULT 3,
     data_ostatniego_przypomnienia TIMESTAMP,
     liczba_przypomnien INTEGER DEFAULT 0,
     
     -- Draft (dla delegacji wymagających doprecyzowania)
     is_draft BOOLEAN DEFAULT FALSE,
     draft_email_body TEXT,
     wymaga_akcji TEXT, -- co trzeba doprecyzować
     
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   );
   
   CREATE INDEX idx_delegacje_deadline ON delegacje(deadline);
   CREATE INDEX idx_delegacje_status ON delegacje(status);
   CREATE INDEX idx_delegacje_delegat_email ON delegacje(delegat_email);
   ```

   **Pytanie**: Czy potrzebujemy osobnej tabeli `delegaci` z bazą osób i kompetencji?

3. **Tabela `delegaci` (baza osób)**:
   ```sql
   CREATE TABLE delegaci (
     id UUID PRIMARY KEY,
     imie VARCHAR(100),
     nazwisko VARCHAR(100),
     email VARCHAR(255) UNIQUE,
     stanowisko VARCHAR(255),
     dzial VARCHAR(100),
     kompetencje TEXT[], -- ['raporty finansowe', 'analizy', 'prezentacje']
     opis TEXT,
     
     -- Metadata
     is_active BOOLEAN DEFAULT TRUE,
     ostatnia_delegacja TIMESTAMP,
     liczba_delegacji INTEGER DEFAULT 0,
     sredni_czas_reakcji INTERVAL, -- średni czas do odpowiedzi
     
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   );
   
   CREATE INDEX idx_delegaci_email ON delegaci(email);
   CREATE INDEX idx_delegaci_dzial ON delegaci(dzial);
   ```

4. **Tabela `whitelista`**:
   ```sql
   CREATE TABLE whitelista (
     id UUID PRIMARY KEY,
     email VARCHAR(255) UNIQUE,
     nazwa VARCHAR(255),
     kategoria VARCHAR(50), -- ceo/board/shareholder/partner/vip
     opis TEXT,
     zawsze_pilne BOOLEAN DEFAULT FALSE, -- force priority
     
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   );
   ```

5. **Tabela `kontekst_pilnosci`** (reguły dla określania pilności):
   ```sql
   CREATE TABLE kontekst_pilnosci (
     id UUID PRIMARY KEY,
     nazwa VARCHAR(255),
     typ VARCHAR(50), -- keyword/sender/subject_pattern/deadline
     wartosc TEXT, -- np. "URGENT", "ceo@firma.pl", "deadline za X dni"
     priorytet INTEGER, -- wyższy = pilniejsze
     opis TEXT,
     is_active BOOLEAN DEFAULT TRUE,
     
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   );
   ```

6. **Tabela `logi`** (audit trail):
   ```sql
   CREATE TABLE logi (
     id UUID PRIMARY KEY,
     email_id UUID REFERENCES emails(id),
     akcja VARCHAR(100), -- np. 'email_sklasyfikowany', 'delegacja_wyslana', 'powiadomienie_wyslane'
     szczegoly JSONB, -- pełny kontekst akcji
     user_id UUID, -- kto wywołał (system/prezes/asystentka)
     timestamp TIMESTAMP DEFAULT NOW()
   );
   
   CREATE INDEX idx_logi_email_id ON logi(email_id);
   CREATE INDEX idx_logi_akcja ON logi(akcja);
   CREATE INDEX idx_logi_timestamp ON logi(timestamp);
   ```

7. **Tabela `konwersacje_whatsapp`** (dla dwukierunkowej komunikacji - Phase 2):
   ```sql
   CREATE TABLE konwersacje_whatsapp (
     id UUID PRIMARY KEY,
     session_id VARCHAR(255) UNIQUE,
     user_phone VARCHAR(20), -- numer telefonu prezesa
     intencja VARCHAR(50), -- wyslij_email/lista_przypomnien/szukaj/wyslij_przypomnienie
     state VARCHAR(50), -- started/awaiting_input/draft_generated/confirmed/cancelled
     context JSONB, -- cały kontekst konwersacji
     last_message_at TIMESTAMP,
     timeout_at TIMESTAMP, -- kiedy konwersacja wygasa
     
     created_at TIMESTAMP DEFAULT NOW(),
     updated_at TIMESTAMP DEFAULT NOW()
   );
   ```

**Rekomendacja**: Ta struktura powinna pokryć MVP + dać bazę na Phase 2. Wymaga potwierdzenia przez użytkownika.

---

#### **HS8: Error Handling - Szczegółowy Flow**

**Problem**: Decyzja "błędami nie przejmujemy się, osobny error handler" jest zbyt ogólna dla produkcji.

**Pytania do rozstrzygnięcia**:

1. **Typy błędów do obsłużenia**:
   - **Błędy połączenia** (email server down, WhatsApp API timeout)
   - **Błędy AI** (API rate limit, hallucinations, low confidence score)
   - **Błędy logiki biznesowej** (brak delegata, konflikt kalendarza bez wolnych terminów)
   - **Błędy danych** (invalid email format, brak obowiązkowych pól)

2. **Strategia retry**:
   - Ile razy ponawiać nieudaną akcję? (3x? 5x?)
   - Jaki backoff? (exponential: 1s, 2s, 4s, 8s...)
   - Po ilu nieudanych próbach email trafia do kategorii AWARYJNA?

3. **Alerting**:
   - Czy prezes/asystentka dostaje powiadomienie o błędach?
   - Jakie błędy są krytyczne (immediate alert)?
   - Jakie można zgrupować w dziennym raporcie?

4. **Dead Letter Queue**:
   - Gdzie trafiają emaile, których system nie mógł przetworzyć?
   - Czy jest proces manualnego przeprocesowania?

5. **Monitoring i logging**:
   - Jakie metryki zbieramy? (error rate, latency, throughput)
   - Gdzie logi? (CloudWatch, Datadog, własna baza)
   - Czy są alerty dla anomalii? (spike w error rate)

**Rekomendacja**: Dla MVP wystarczy prosty error handler z retry (3x) + kategoria AWARYJNA. W Phase 2 dodać monitoring i alerting.

---

#### **HS9: Kalendarz - Integracja i Logika Rezerwacji**

**Problem**: Nie określono szczegółów integracji z kalendarzem.

**Pytania do rozstrzygnięcia**:

1. **Typ kalendarza**:
   - Google Calendar?
   - Microsoft Outlook/Exchange?
   - Oba (multi-provider)?

2. **Logika sprawdzania dostępności**:
   - Jak długie spotkanie zakładamy domyślnie? (30 min? 60 min?)
   - Czy system czyta czas trwania z emaila? ("spotkajmy się na godzinę")
   - Czy uwzględnia czas dojazdu między spotkaniami? (buffer 15 min?)

3. **Jak system rozpoznaje propozycję spotkania w emailu**?
   - Parsing daty/czasu z tekstu ("czy możemy się spotkać 16.11 o 14:00")
   - Co jeśli data jest niejednoznaczna? ("spotkajmy się w przyszły wtorek" - który?)
   - Co jeśli nie ma konkretnej daty? ("spotkajmy się w przyszłym tygodniu")

4. **Automatyczna rezerwacja - zgoda prezesa**:
   - Czy system rezerwuje bez pytania?
   - Czy prezes dostaje potwierdzenie: "Zarezerwowałem spotkanie ze Smith na 16.11, 14:00. [Anuluj]"?

5. **Konflikt kalendarza - ile alternatyw**?
   - Jak długi horyzont szukania? (najbliższe 3 dni? tydzień? dwa?)
   - Czy system preferuje określone godziny? (np. 10:00, 14:00, 16:00 zamiast 10:17)
   - Czy uwzględnia preferencje prezesa? (np. "nie umawiaj spotkań przed 9:00 ani po 17:00")

**Rekomendacja**: Start z Google Calendar (najpopularniejszy). Założenia: spotkania 60 min, automatyczna rezerwacja bez pytania, 3 alternatywy w przypadku konfliktu.

---

#### **HS10: Bezpieczeństwo i Privacy**

**Problem**: Nie omówiono kwestii bezpieczeństwa przy pracy z wrażliwymi danymi (emaile prezesa).

**Pytania do rozstrzygnięcia**:

1. **Gdzie przechowywane są dane**?
   - Cloud (AWS/GCP/Azure)?
   - On-premise?
   - Hybrid?
   - Jaka lokalizacja geograficzna? (GDPR compliance dla EU)

2. **Encryption**:
   - Data at rest: czy baza danych jest zaszyfrowana?
   - Data in transit: HTTPS/TLS dla wszystkich połączeń?
   - Czy hasła/tokeny w secrets manager (AWS Secrets Manager, HashiCorp Vault)?

3. **Access control**:
   - Kto ma dostęp do danych prezesa? (tylko prezes + asystentka?)
   - Czy są role i uprawnienia? (admin, user, readonly)
   - Czy jest audit log kto i kiedy odczytał email?

4. **AI Provider - privacy concerns**:
   - OpenAI/Anthropic - czy dane emaili trafiają do treningu modelu?
   - Czy używamy "zero-retention" API?
   - Czy potrzebny jest self-hosted LLM dla maksymalnej prywatności?

5. **Compliance**:
   - GDPR (dla EU)?
   - HIPAA (jeśli healthcare)?
   - SOC 2?

6. **Data retention**:
   - Jak długo przechowujemy emaile w bazie?
   - Czy są automatyczne usuwanie po X miesiącach?
   - Czy prezes może zażądać usunięcia danych (right to be forgotten)?

**Rekomendacja**: Dla MVP focus na podstawy: encryption, access control, zero-retention API dla AI. W Phase 2 compliance certifications.

---

#### **HS11: Skalowanie i Performance**

**Problem**: Nie określono wymagań wydajnościowych i scenariuszy skalowania.

**Pytania do rozstrzygnięcia**:

1. **Ile emaili dziennie**?
   - MVP: 1 prezes, ~100-200 emaili/dzień?
   - Scale: 10 prezesów, ~2000 emaili/dzień?
   - Enterprise: 100 prezesów, ~20,000 emaili/dzień?

2. **Latency requirements**:
   - Cykl przetwarzania: <30s na email (OK dla MVP)
   - Powiadomienie pilne: <5min od otrzymania (OK)
   - Raport dzienny: <60s generowanie (OK)
   - WhatsApp response: <10s (challenging dla LLM)

3. **Concurrent processing**:
   - Czy emaile są procesowane synchronicznie (jeden po drugim)?
   - Czy równolegle (worker pool)?
   - Jaka kolejka? (Redis, RabbitMQ, AWS SQS)

4. **Rate limits**:
   - AI API: OpenAI/Anthropic mają limity requests/min
   - Email API: Gmail API ma quota limits
   - WhatsApp API: rate limits na wysyłkę
   - Jak system radzi sobie z throttling?

5. **Caching**:
   - Czy wyniki AI są cache'owane? (podobne emaile)
   - Czy lista delegatów jest w cache (Redis)?
   - Czy kontekst pilności jest w cache?

**Rekomendacja**: MVP: single-threaded processing (wystarczy). Phase 2: worker queue + caching.

---

#### **HS12: Testowanie i Quality Assurance**

**Problem**: Jak testować system oparty na AI, gdzie output nie jest deterministyczny?

**Pytania do rozstrzygnięcia**:

1. **Unit testing**:
   - Jak testować funkcje używające AI?
   - Czy mockujemy API calls?
   - Czy używamy fixed test dataset?

2. **Integration testing**:
   - Jak testować flow end-to-end?
   - Czy potrzebne jest testowe konto email?
   - Czy potrzebne jest testowe konto WhatsApp?

3. **AI output validation**:
   - Jak sprawdzić czy klasyfikacja jest poprawna?
   - Czy używamy labeled dataset (ground truth)?
   - Jaką dokładność uznajemy za akceptowalną? (85%? 90%?)

4. **Regression testing**:
   - Gdy zmieniamy prompt, jak sprawdzić czy nie zepsuliśmy innych przypadków?
   - Czy potrzebny jest test suite z typowymi emailami?

5. **User acceptance testing (UAT)**:
   - Czy prezes testuje system na prawdziwych emailach przed launch?
   - Jak długi okres UAT? (1 tydzień? 2 tygodnie?)
   - Jakie są kryteria sukcesu UAT?

**Rekomendacja**: Dla MVP: manual UAT z prezesem (2 tygodnie). Phase 2: automated test suite z labeled dataset.

---

#### **HS13: Onboarding Prezesa**

**Problem**: Jak prezesa wdrożyć do systemu? Jakie są kroki?

**Pytania do rozstrzygnięcia**:

1. **Setup checklist**:
   - Połączenie konta email (OAuth flow)
   - Połączenie kalendarza (OAuth flow)
   - Połączenie WhatsApp (QR code? numer telefonu?)
   - Import bazy delegatów (CSV upload? Manual entry?)
   - Konfiguracja whitelisty (CSV upload? Manual entry?)
   - Konfiguracja kontekstu pilności (default rules + custom)
   - Ustawienie harmonogramu raportów (10:00 i 14:00? inne?)

2. **Training period**:
   - Czy system startuje w "dry-run mode"? (pokazuje co BY zrobił, ale nie robi)
   - Jak długi training period? (1 tydzień?)
   - Czy prezes może korygować klasyfikacje? (feedback loop)

3. **Documentation**:
   - Czy prezes dostaje user manual?
   - Czy są tutorial videos?
   - Czy jest onboarding call z supportem?

4. **Sukces onboardingu**:
   - Jakie kryteria oznaczają "prezes jest gotowy"?
   - Czy musi skonfigurować wszystkie moduły?
   - Czy musi przetestować wszystkie intencje WhatsApp?

**Rekomendacja**: Guided onboarding wizard + 1 tydzień dry-run mode + feedback loop.

---

#### **HS14: Proces Inicjalizacji - Brakujące Events**

**Problem**: Proces inicjalizacji (uczenie się stylu prezesa) został zidentyfikowany jako osobny flow, ale nie został rozpisany na events.

**Rekomendacja**: Rozpisać w osobnej sesji Event Stormingu gdy będzie implementowany (Phase 2). Tymczasowo w PRD:

**Process Initialization - High-Level Flow**:
1. Prezes podłącza konto email
2. System importuje historię emaili (sent by prezes, ostatnie 6 miesięcy)
3. System filtruje emaile (tylko odpowiedzi, min. 50 znaków)
4. System analizuje wzorce (ton, struktura, frazy)
5. System generuje model stylu (few-shot examples lub fine-tuning)
6. Prezes waliduje próbki (10 przykładowych draftów)
7. Prezes akceptuje model → system ready

**Eventy** (do rozwinięcia w Phase 2):
- DE_INIT_1: Konto email połączone
- DE_INIT_2: Historia emaili zaimportowana
- DE_INIT_3: Emaile przefiltrowane
- DE_INIT_4: Analiza wzorców zakończona
- DE_INIT_5: Model stylu wygenerowany
- DE_INIT_6: Próbki wygenerowane
- DE_INIT_7: Próbki zaakceptowane przez prezesa
- DE_INIT_8: Model zatwierdzony
- DE_INIT_9: System gotowy do pracy

---

#### **HS15: Multi-Tenant Architecture (Future)**

**Problem**: Obecny design zakłada 1 prezesa. Jak skalować na wielu użytkowników?

**Pytania do rozstrzygnięcia** (dla Phase 3+):
1. Czy każdy prezes ma osobną bazę danych?
2. Czy wspólna baza z tenant_id?
3. Jak izolować dane między prezesami?
4. Czy asystentki mogą mieć dostęp do wielu prezesów?
5. Czy billing jest per-prezes czy per-firma?

**Rekomendacja**: Out of scope dla MVP. Single-tenant wystarczy.

---

### **Next Steps & Recommendations**

#### **Immediate Actions (Pre-Development)**

1. **Potwierdzenie struktury bazy danych** (HS7):
   - Review zaproponowanych tabel
   - Dodanie/usunięcie pól według potrzeb
   - Approval przed rozpoczęciem implementacji

2. **Prototyp raportu sekcyjnego** (HS2):
   - Stworzenie mockupu w Figma/Sketch
   - Przejście z prezesem (UAT prototype)
   - Iteracja na podstawie feedbacku

3. **Wybór AI provider i calendar API**:
   - OpenAI vs Anthropic vs self-hosted LLM
   - Google Calendar vs Microsoft Exchange
   - Decyzja o zero-retention policy

4. **Security & compliance assessment**:
   - Gdzie będą hostowane dane?
   - Jaka encryption?
   - Czy potrzebne external audit?

#### **MVP Development Priority**

**Phase 1.1 - Core Processing (Miesiąc 1)**:
- Email pobieranie (cron job)
- Klasyfikacja AI (5 kategorii podstawowych)
- Akcje podstawowe (przenoszenie, tagowanie, logging)
- Baza danych (setup)

**Phase 1.2 - Delegacje (Miesiąc 2)**:
- Baza delegatów (manual entry)
- Delegacja podstawowa (auto-send)
- Delegacja doprecyzowanie (draft)
- System przypomnień (cron)

**Phase 1.3 - Podsumowania (Miesiąc 2-3)**:
- Raport sekcyjny (generator)
- WhatsApp integration (wysyłanie)
- Harmonogram (2x dziennie)

**Phase 1.4 - Dashboard WWW (Miesiąc 3)**:
- Lista przypomnień
- Widok raportów
- Basic stats

**Phase 1.5 - UAT & Polish (Miesiąc 4)**:
- 2 tygodnie UAT z prezesem
- Bug fixes
- Performance tuning
- Launch! 🚀

#### **Phase 2 Features (Post-MVP)**

- Proces Inicjalizacji (uczenie stylu)
- Dwukierunkowa komunikacja WhatsApp (4 intencje)
- Semantic search (embeddings)
- Auto-learning baza delegatów
- Advanced analytics

#### **Success Metrics to Track from Day 1**

1. **Accuracy klasyfikacji** (manual labeling przez prezesa)
2. **Czas przetwarzania** (avg latency per email)
3. **Stosunek auto/manual** (ile emaili obsłużonych automatycznie)
4. **Adoption rate** (czy prezes codziennie sprawdza raporty)
5. **Error rate** (ile emaili trafia do kategorii AWARYJNA)

---

</unresolved_issues>

</conversation_summary>

---

## **Summary**

Przeprowadzona sesja Event Stormingu odkryła kompleksowy system automatyzacji emaili dla executive'ów, składający się z:

- **30+ Domain Events** rozłożonych na 6 głównych kategorii przetwarzania
- **4 moduły integracyjne** (Email, WhatsApp, Calendar, Database)
- **2 osobne procesy** (Operacyjny + Inicjalizacji)
- **15 Hot Spotów** wymagających doprecyzowania przed/podczas implementacji

System jest **dobrze zdefiniowany na poziomie MVP**, z jasnym zakresem Phase 1 i roadmapą na Phase 2+.

**Największe ryzyka**:
1. Accuracy AI (czy 85% wystarczy?)
2. Dwukierunkowa komunikacja WhatsApp (złożoność state management)
3. Security/privacy (wrażliwe dane prezesa)

**Biggest wins**:
1. Jasna hierarchia priorytetów (pilny > VIP > delegacja...)
2. Raport sekcyjny (actionable format)
3. Closed-loop delegacji (przypomnienia)

**Ready for PRD creation!** 🎉
