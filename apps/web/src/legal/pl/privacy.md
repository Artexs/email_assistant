Ta strona opisuje, co asystent poczty robi z danymi osobowymi. Opisuje ustawienia z dnia wersji podanej wyżej. Tabele z danymi, które przechowujemy, i z usługami, które dostają dane, znajdują się pod tekstem.

## Kto odpowiada

- Organizacja, która podłącza swoje skrzynki, jest administratorem swojej poczty. Ona decyduje, jakie wiadomości czyta asystent i po co.
- \<provider name> prowadzi usługę dla organizacji. W odniesieniu do poczty \<provider name> jest podmiotem przetwarzającym i działa na polecenie organizacji.
- W odniesieniu do danych kont członków (logowanie, sesje, zgody) \<provider name> jest administratorem.
- Kontakt: \<contact>. Adres: \<address>.

## Jakie dane

Tabela „Co przechowujemy” na końcu strony podaje każdy rodzaj danych, kogo dotyczy, po co go trzymamy i jak długo.

- **Poczta.** Asystent przechowuje wiadomości z podłączonych skrzynek: treść, temat, adresy i dane z nagłówków (nazwa nadawcy, Reply-To, Return-Path, wyniki sprawdzania spamu i uwierzytelnienia, dane listy, nazwy i rozmiary załączników, hosty linków). Są to także dane osób, które nie są członkami: nadawców i adresatów tych wiadomości.
- **Wysłana poczta.** Asystent może czytać folder Wysłane skrzynki. Nigdy go nie zmienia. Ta funkcja jest domyślnie wyłączona. Działa tylko wtedy, gdy operator włączy ją dla organizacji, a członek włączy przełącznik „Śledź moją wysłaną pocztę” dla skrzynki.
- **Wyniki AI.** AI zapisuje dla każdej wiadomości krótkie uzasadnienie, wyciągnięte pola, podsumowania i treść szkiców. System je przechowuje.
- **Członkowie.** System przechowuje imię i nazwisko, adres e-mail, język, hasło (jako skrót), sesje (urządzenie, adres sieciowy i ostatni dzień użycia), opcjonalny drugi składnik, wersję regulaminu, którą członek zaakceptował, oraz czat Telegrama, który członek powiązał.
- **Sekret skrzynki.** Hasło lub token skrzynki jest przechowywane w postaci zaszyfrowanej.
- **Co zrobił system.** Dziennik audytu zapisuje, kto co i kiedy zdecydował. Zawiera identyfikatory, kody i liczby, nigdy treść wiadomości.
- **Zachowane identyfikatory techniczne.** Gdy treść wiadomości zostanie wyczyszczona, wiersz zostaje. Wiersz zachowuje nagłówek Message-ID, klucz deduplikacji, klucz wątku i skrót treści. Synchronizacja poczty znajduje wiadomości po tych identyfikatorach, a liczniki i dziennik audytu nadal działają.
- **Logi.** Logi serwera zawierają identyfikatory, liczby, kody i czasy. Nie zawierają treści wiadomości, adresów ani haseł.

## Cel i podstawa

Asystent używa danych w tych celach. Dla każdego celu podstawa prawna nie jest jeszcze potwierdzona.

- **Sortowanie:** aby przypisać każdej wiadomości kategorię z krótkim uzasadnieniem. Podstawa prawna: \<to confirm: legal basis>.
- **Działania:** aby przenosić wiadomości, oznaczać je flagą lub jako przeczytane, gdy pozwalają na to tryb i przełączniki skrzynki. Nowa skrzynka zaczyna w trybie podglądu, w którym asystent niczego nie zmienia. Podstawa prawna: \<to confirm: legal basis>.
- **Szkice:** aby napisać szkic zlecenia lub pytania. System wysyła szkic dopiero po zatwierdzeniu przez właściciela. Podstawa prawna: \<to confirm: legal basis>.
- **Podsumowania i powiadomienia:** aby poinformować członka o pilnej poczcie, problemach i szkicach, które czekają. Trafiają do Telegrama, dopiero gdy członek powiąże Telegram i wyrazi zgodę na dane, które tam trafiają. System zapisuje zgodę. Podstawa prawna: \<to confirm: legal basis>.
- **Przypomnienia dla wykonawców:** aby przypomnieć wykonawcy o zleceniu. Przypomnienie to szkic, który wymaga takiego samego zatwierdzenia. Podstawa prawna: \<to confirm: legal basis>.
- **Bezpieczeństwo:** aby zablokować konto po nieudanych logowaniach i prowadzić dziennik audytu. Podstawa prawna: \<to confirm: legal basis>.
- **Pomiar:** aby liczyć tygodniowe wskaźniki i koszt AI dla każdej skrzynki. Podstawa prawna: \<to confirm: legal basis>.

## Jak długo

- Raz dziennie działa zadanie, które czyści zapisane teksty każdej organizacji. Tabela „Co przechowujemy” podaje okres dla każdego rodzaju danych. Wiersze zostają, więc liczniki i dziennik audytu nadal działają.
- Każdej nocy serwer robi kopię zapasową całej bazy danych. Kopia zawiera dane z chwili jej utworzenia, także teksty, które zadanie wyczyściło później, i dane, które ktoś usunął później. Kopie na serwerze są domyślnie trzymane 7 dni. Kopie w zewnętrznym magazynie są trzymane \<backup retention>.
- Asystent nigdy nie usuwa wiadomości z Twojej skrzynki. Szkice i foldery, które utworzył asystent, zostają w skrzynce.
- Telegram przechowuje wiadomości, dopóki nie usuniesz ich z czatu.

## Kto otrzymuje dane

- Tabela „Podmioty przetwarzające” na końcu strony podaje każdą zewnętrzną usługę, która dostaje dane, co dostaje, gdzie działa i kiedy jest używana. Druga tabela podaje usługi, które nie dostają danych osobowych.
- **Model AI.** Ta instalacja używa OpenAI. Asystent wysyła treść, temat i nadawcę wiadomości, listę wykonawców oraz do trzech wcześniejszych wiadomości z tego samego wątku jako kontekst. Nie wysyła wiadomości starszych niż 7 dni. Według płatnych warunków API, które obowiązują w tej usłudze, OpenAI nie trenuje modeli na danych z API. Asystent prosi OpenAI, aby nie przechowywało danych (`store: false`). OpenAI przechowuje logi nadużyć do 30 dni. OpenAI nie ma w tym zastosowaniu lokalizacji w UE. Warunki sprawdzono ostatnio: \<to confirm: OpenAI terms check date>. Instalacja może zamiast tego używać Google Gemini. Kolumna „Używana, gdy” podaje warunek.
- **Telegram.** Telegram dostaje tylko to, co podaje tekst zgody w panelu, po zgodzie członka: nadawcę i temat wiadomości, nazwy (lub typy plików) i rozmiary załączników, krótkie uzasadnienie lub podsumowanie AI, treść szkiców czekających na zatwierdzenie wraz z cytowaną częścią oryginalnej wiadomości, imiona i nazwiska wykonawców oraz adresy skrzynek. Jeśli członek włączy otwarte sprawy, Telegram dostaje też to, na kogo członek czeka, krótki opis tego, o co poprosił lub co obiecał, termin, temat oraz szkice przypomnień z ich adresatami. Czaty z botem nie są szyfrowane metodą end-to-end.
- **Przekazywanie poza EOG.** OpenAI nie ma w tym zastosowaniu lokalizacji w UE, a Telegram może przetwarzać dane poza Europejskim Obszarem Gospodarczym. Mechanizm przekazania: \<to confirm: transfer mechanism>.
- **Kopia zapasowa.** Kopia jest szyfrowana narzędziem `age`, zanim opuści serwer. Klucza do jej odszyfrowania nie ma na serwerze.
- **Dostawca poczty.** Gdy właściciel zatwierdza szkic, wiadomość wychodzi ze skrzynki właściciela przez dostawcę poczty tej skrzynki.

## AI i decyzje

- AI sortuje pocztę, pisze krótkie uzasadnienia i podsumowania oraz szkice zleceń i pytań.
- Asystent nigdy nie wysyła wiadomości sam. Wysłanie wymaga zatwierdzenia przez właściciela dokładnego tekstu, w Telegramie lub w panelu. Bez zatwierdzenia wysyłka wygasa po 48 godzinach.
- AI nie może wybrać adresata. System bierze adresatów z wiadomości i z wykonawców, których dodała organizacja.
- Nowa skrzynka jest w trybie podglądu: nic się w niej nie zmienia. W trybie asysty przeniesienie następuje tylko dla kategorii, którą właściciel ustawił jako automatyczną i która przeszła bramkę jakości.
- Każde automatyczne przeniesienie ma powód w dzienniku audytu. Członek może je cofnąć przez 7 dni przyciskiem Cofnij, w Telegramie lub w panelu.
- Asystent tylko sortuje, oznacza, przenosi i pisze szkice. Czy to jest decyzja wywołująca skutki prawne: \<to confirm: assessment of automated decisions>.

## Twoje prawa

**Członkowie.**

- **Dostęp i eksport.** Napisz na \<contact>. Operator tworzy zaszyfrowany plik z danymi organizacji. Plik nie zawiera skrótów haseł, sekretów skrzynek, tokenów ani sesji.
- **Usunięcie.** Właściciel może usunąć organizację w karcie Konto, gdy operator to włączył. W przeciwnym razie napisz na \<contact>, a operator ją usunie. Usunięcie od razu kasuje skrzynki, wiadomości, wyniki, reguły, powiązania z Telegramem, dziennik audytu i konta członków. Kopie zapasowe zachowują wiersze, dopóki nie wygasną. Po przywróceniu kopii operator usuwa je ponownie.
- **Po usunięciu** zmień hasło każdej skrzynki u dostawcy poczty, bo asystent je znał.
- **Poprawienie danych i sprzeciw.** Napisz na \<contact>.

**Osoby, które nie są członkami** (na przykład nadawca wiadomości).

- Zwróć się do organizacji, której skrzynka dostała wiadomość. Organizacja jest administratorem.
- Na pisemne polecenie organizacji operator może znaleźć dane osoby. Może też je usunąć: system kasuje wiadomości tej osoby, usuwa adres z wierszy, które zostają, czyści zapisane podsumowania, które mogą wymieniać wiadomość, i zachowuje znacznik usunięcia (skrót identyfikatora wiadomości), aby wiadomość nie wróciła przy następnej synchronizacji.
- Niektóre rzeczy zostają. Wiadomości Telegrama, które już dotarły, zostają w czacie, dopóki członek ich nie usunie. Skrzynka zachowuje swoje wiadomości. Wykonawcy i reguły nadawców z tym adresem są wypisywane dla organizacji, a organizacja je zmienia.

**Termin i skarga.** Odpowiedź na wniosek przychodzi w ciągu jednego miesiąca (art. 12 ust. 3 RODO). Możesz złożyć skargę do organu nadzorczego. W Polsce jest to UODO.

## Bezpieczeństwo

- **Sekrety skrzynek** są szyfrowane algorytmem AES-256-GCM. Klucz jest poza bazą danych. Serwer odszyfrowuje sekret tylko w pamięci. Sekret nigdy nie trafia do logów, do aplikacji webowej ani do Telegrama. Używaj hasła aplikacji, gdy dostawca je oferuje, bo zapisany sekret otwiera całą skrzynkę.
- **Połączenia.** Serwer zawsze sprawdza certyfikaty serwerów poczty (TLS).
- **Panel.** Panel jest dostępny tylko przez Tailscale, dla członków sieci prywatnej. Nie ma publicznego adresu.
- **Kopie zapasowe** są szyfrowane przed wysłaniem.
- **Logowanie.** Dziesięć nieudanych logowań w 15 minut blokuje konto na 15 minut. Nowe hasło jest sprawdzane w bazie znanych wycieków, a z serwera wychodzi tylko 5 znaków jego skrótu. Członek może włączyć drugi składnik (TOTP).
- **Rozdzielenie.** Każda organizacja widzi tylko swoje dane. Kod filtruje każde zapytanie według organizacji, a baza danych dodaje zabezpieczenie na poziomie wierszy jako drugą barierę.
- **Logi** nie zawierają treści wiadomości.

## Zmiany

Wersja tego tekstu jest na górze strony. Gdy tekst się zmienia, zmienia się wersja. Po następnym logowaniu każdy członek widzi okno i musi zaakceptować nową wersję. System zapisuje wersję i czas akceptacji.
