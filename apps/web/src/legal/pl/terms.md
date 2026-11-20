Ten regulamin mówi, jak działa usługa i czego możesz się po niej spodziewać. Opisuje ustawienia z dnia wersji podanej wyżej.

## Usługa

- Usługa to asystent poczty. Czyta wiadomości ze skrzynek, które podłączy organizacja. Przypisuje każdej wiadomości kategorię z krótkim uzasadnieniem. Podsumowuje wiadomości i wątki, pomaga zlecać zadania, filtruje spam i pisze szkice odpowiedzi i przypomnień.
- Szkic wychodzi dopiero po zatwierdzeniu przez właściciela organizacji.
- Usługa działa na prywatnym serwerze wyłącznie dla jej właściciela. Prowadzi ją \<provider name>. Kontakt: \<contact>. Adres: \<address>.
- Polityka prywatności i umowa powierzenia przetwarzania danych to osobne strony. Linki do obu znajdziesz na stronie logowania i w karcie Konto.

## Konta

- Nie ma rejestracji. Operator (osoba, która prowadzi serwer) tworzy organizację i jej pierwszego właściciela. Członek jest właścicielem albo asystentem.
- Nowy członek otwiera link do ustawienia konta. Link działa jeden raz. Członek akceptuje regulamin i ustawia hasło o długości od 12 do 128 znaków. System sprawdza nowe hasło w bazie znanych wycieków.
- Dziesięć nieudanych logowań w 15 minut blokuje konto na 15 minut.
- Członek może włączyć drugi składnik (TOTP). Jeśli operator skonfigurował logowanie kontem firmowym dla organizacji, członkowie mogą logować się tym kontem.
- Sesja trwa do 30 dni. Członek może zakończyć wszystkie sesje albo wszystkie pozostałe sesje w karcie Konto.

## Stan planu

- Każda organizacja ma jeden stan planu: `trial`, `active` albo `suspended`. Zmienia go operator. Zakończony okres próbny nie zmienia stanu sam.
- Organizacja ma limit liczby skrzynek. Limit ustawia operator.
- Gdy organizacja jest `suspended`, asystent jest dla niej wstrzymany. Nie czyta nowej poczty, nie sortuje wiadomości i nie wysyła podsumowań. Polecenia w Telegramie, oprócz pomocy, odpowiadają tylko, że konto jest wstrzymane. Po wznowieniu wiadomości, które przyszły ponad 24 godziny przed wznowieniem, nie są sortowane.
- Członek wstrzymanej organizacji nadal może czytać panel i akceptować regulamin. Może też wybrać język, a właściciel może usunąć organizację.
- Ten regulamin nie podaje ceny ani warunków płatności.

## Twoja skrzynka

- Usługa przechowuje hasło skrzynki w postaci zaszyfrowanej. Używaj hasła aplikacji, gdy dostawca poczty je oferuje. Zapisany sekret otwiera całą skrzynkę.
- Nowa skrzynka jest w trybie podglądu. W trybie podglądu asystent niczego nie zmienia w skrzynce i tylko zgłasza, co by zrobił. Jedynym wyjątkiem jest poczta z raportem, o którą poprosił członek.
- W trybie asystenta asystent może przenosić wiadomości, oznaczać je flagą, oznaczać jako przeczytane i zapisywać szkice w folderze szkiców skrzynki. Przeniesienie lub oznaczenie jako przeczytane następuje tylko dla kategorii, którą właściciel ustawił jako automatyczną i która przeszła bramkę jakości. Wiadomości, co do których asystent nie jest pewny, są przenoszone tylko wtedy, gdy właściciel włączy osobny przełącznik.
- Asystent nigdy nie wysyła wiadomości bez właściciela. Właściciel dotyka Wyślij przy dokładnym tekście, w Telegramie lub w panelu. Bez dotknięcia wysyłka wygasa po 48 godzinach (szkic odpowiedzi: po 7 dniach).
- Asystent nigdy nie usuwa wiadomości z Twojej skrzynki.
- Gdy organizacja zostanie usunięta, szkice i foldery, które utworzył asystent, zostają w skrzynce. Usuwa je właściciel.

## Wyniki AI

- AI może się mylić. Może przypisać wiadomość do złej kategorii, napisać błędne podsumowanie albo szkic, który nie pasuje.
- Właściciel czyta każdy szkic, zanim go zatwierdzi. Asystent nigdy nie wysyła szkicu sam.
- Każdą automatyczną zmianę wiadomości można cofnąć przyciskiem Cofnij przez 7 dni, w Telegramie lub w panelu. Przyciski opinii informują usługę, że wynik był zły.

## Dostępność

- Usługa nie ma poziomu usług. Nie obowiązuje żadna obietnica dostępności ani czasu reakcji.
- Serwer robi jedną kopię zapasową bazy danych każdej nocy.
- Panel jest dostępny tylko w prywatnej sieci właściciela (Tailscale). Nie ma publicznego adresu.

## Zakończenie i usunięcie

- Właściciel może usunąć organizację w karcie Konto, gdy operator to włączył. W przeciwnym razie napisz na \<contact>, a operator ją usunie. Usunięcie od razu kasuje skrzynki, wiadomości, wyniki, reguły, powiązania z Telegramem, urządzenia push, dziennik audytu i konta członków.
- Kopie zapasowe zachowują wiersze, dopóki nie wygasną. Po przywróceniu kopii operator usuwa organizację ponownie.
- Po usunięciu zmień hasło każdej skrzynki u dostawcy poczty, bo asystent je znał.
- Na prośbę operator tworzy zaszyfrowany eksport danych organizacji. Eksport nie zawiera skrótów haseł, sekretów skrzynek, tokenów ani sesji.

## Odpowiedzialność i prawo

- Odpowiedzialność: \<to confirm: liability>.
- Prawo właściwe i sąd: \<to confirm: governing law>.

## Zmiany

Wersja tego regulaminu jest na górze strony. Gdy tekst się zmienia, zmienia się wersja. Po następnym logowaniu każdy członek widzi okno i musi zaakceptować nową wersję. System zapisuje wersję i czas akceptacji.
