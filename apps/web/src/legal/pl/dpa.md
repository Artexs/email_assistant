Ta umowa dotyczy poczty, którą organizacja przekazuje usłudze. Wylicza punkty art. 28 ust. 3 RODO. Organizacja jest administratorem. \<provider name> jest podmiotem przetwarzającym. Strona opisuje ustawienia z dnia wersji podanej wyżej.

## Strony i przedmiot

- **Administrator:** \<organization name>, organizacja, która podłącza swoje skrzynki do usługi.
- **Podmiot przetwarzający:** \<provider name>. Adres: \<address>. Kontakt: \<contact>.
- **Przedmiot:** podmiot przetwarzający przetwarza pocztę podłączonych skrzynek na potrzeby usługi, w imieniu administratora.
- **Czas trwania:** czas istnienia organizacji w usłudze. Kończy się zakończeniem opisanym w punkcie 10.

## Charakter i cel

Podmiot przetwarzający przetwarza pocztę wyłącznie po to, aby realizować dla administratora te funkcje:

- **Sortowanie:** aby przypisać każdej wiadomości kategorię z krótkim uzasadnieniem.
- **Działania:** aby przenosić wiadomości, oznaczać je flagą lub jako przeczytane, gdy pozwalają na to tryb i przełączniki każdej skrzynki.
- **Szkice:** aby pisać szkice odpowiedzi i pytań oraz, po kliknięciu przez właściciela, sugerowany styl pisania na podstawie własnej wysłanej poczty. Szkic jest wysyłany dopiero po zatwierdzeniu przez właściciela.
- **Podsumowania:** aby informować członków o pilnej poczcie, problemach i szkicach, które czekają, w Telegramie lub w powiadomieniu push na zarejestrowanym telefonie albo w przeglądarce. Gdy włączony jest raport pocztą, także wiadomością, którą podmiot przetwarzający wkłada do skrzynki INBOX skrzynki wybranej przez członka.
- **Otwarte sprawy:** aby znaleźć we własnej wysłanej poczcie skrzynki to, o co prosił lub co obiecał członek, i mu o tym przypomnieć. Działa to tylko przy włączonej funkcji.
- **Newslettery:** aby znaleźć newslettery i, gdy właściciel dotknie Wypisz, wysłać jedno żądanie pod link, który napisał newsletter, aby nadawca usunął skrzynkę z listy. Działa to tylko przy włączonej funkcji.
- **Przypomnienia dla wykonawców:** aby przypomnieć wykonawcy o zleceniu, szkicem, który wymaga takiego samego zatwierdzenia.

## Dane i osoby

- Rodzaje danych podaje tabela „Co przechowujemy” w [polityce prywatności](/legal/pl/privacy). Tabela pokazuje cel i okres przechowywania każdego rodzaju.
- Osoby, których dane dotyczą, to członkowie organizacji oraz osoby, które wysyłają lub odbierają pocztę podłączonych skrzynek.

## Polecenia

- Podmiot przetwarzający działa wyłącznie na udokumentowane polecenia administratora.
- Poleceniami są ustawienia, które administrator wprowadza w panelu (skrzynki, tryby, przełączniki, kategorie, reguły i wykonawcy) oraz pisemne prośby właściciela organizacji, na przykład prośba o eksport, usunięcie albo znalezienie lub usunięcie danych jednej osoby.

## Poufność

- Podmiot przetwarzający daje dostęp do danych administratora wyłącznie operatorowi, czyli osobie, która prowadzi serwer. Członkowie organizacji widzą tylko dane własnej organizacji.
- Personel: \<to confirm: staff>.

## Środki bezpieczeństwa

Załącznik 1. Podmiot przetwarzający stosuje te środki:

- Sekrety skrzynek są szyfrowane algorytmem AES-256-GCM. Klucz jest poza bazą danych. Serwer odszyfrowuje sekret tylko w pamięci. Sekret nigdy nie trafia do logów, do aplikacji webowej ani do Telegrama.
- Serwer zawsze sprawdza certyfikaty serwerów poczty (TLS).
- Panel jest dostępny tylko przez Tailscale, dla członków sieci prywatnej. Nie ma publicznego adresu.
- Kopie zapasowe są szyfrowane narzędziem `age` przed wysłaniem. Klucza do ich odszyfrowania nie ma na serwerze.
- Dziesięć nieudanych logowań w 15 minut blokuje konto na 15 minut. Nowe hasło jest sprawdzane w bazie znanych wycieków, a z serwera wychodzi tylko 5 znaków jego skrótu. Członek może włączyć drugi składnik (TOTP).
- Każda organizacja widzi tylko swoje dane. Kod filtruje każde zapytanie według organizacji, a dla żądań z panelu baza danych dodaje zabezpieczenie na poziomie wierszy jako drugą barierę.
- Logi zawierają identyfikatory, liczby, kody i czasy. Nie zawierają treści wiadomości, adresów ani haseł.

## Podprocesorzy

- Administrator udziela podmiotowi przetwarzającemu ogólnej pisemnej zgody na korzystanie z podprocesorów z Załącznika 2. Załącznik 2 to tabela na końcu tej strony. Podaje każdą usługę, jakie dane dostaje, gdzie działa i kiedy jest używana.
- Gdy Załącznik 2 dostaje nowy wiersz, zmienia się wersja tego tekstu. Każdy członek widzi wtedy okno przy następnym logowaniu.
- Termin na sprzeciw wobec nowego podprocesora: \<to confirm: objection period>.
- Obowiązki każdego podprocesora (art. 28 ust. 4 RODO): \<to confirm: sub-processor contracts>.

## Pomoc przy żądaniach

- Podmiot przetwarzający informuje administratora o żądaniu, które otrzyma od osoby, której dane dotyczą. Nie odpowiada na to żądanie sam, chyba że administrator go do tego upoważni.
- Na pisemne polecenie właściciela organizacji podmiot przetwarzający znajduje dane jednej osoby i je usuwa. Informuje administratora, jakie dane znalazł, aby administrator mógł odpowiedzieć.
- Administrator odpowiada na żądanie w ciągu jednego miesiąca (art. 12 ust. 3 RODO).
- Pomoc w obowiązkach administratora dotyczących bezpieczeństwa, zawiadamiania o naruszeniach i oceny skutków (art. 32–36 RODO): \<to confirm: help with Articles 32 to 36>.

## Naruszenia

- Podmiot przetwarzający informuje administratora bez zbędnej zwłoki po stwierdzeniu naruszenia ochrony danych osobowych.
- Podmiot przetwarzający stosuje własną procedurę postępowania przy naruszeniach.

## Zakończenie

- Gdy organizacja zostanie usunięta, usunięcie od razu kasuje jej dane: skrzynki, wiadomości, wyniki, reguły, powiązania z Telegramem, urządzenia push, dziennik audytu i konta członków.
- Na prośbę podmiot przetwarzający najpierw tworzy zaszyfrowany eksport danych.
- Kopie zapasowe zachowują wiersze, dopóki nie wygasną. Kopie na serwerze są domyślnie trzymane 7 dni. Kopie w zewnętrznym magazynie są trzymane \<backup retention>.
- Skrzynka administratora zachowuje swoje wiadomości. Szkice i foldery, które utworzył asystent, zostają w niej.

## Audyty

- Prawa administratora do audytu: \<to confirm: audit rights>.
- Informacje wykazujące zgodność z art. 28 RODO: \<to confirm: proof of compliance>.
