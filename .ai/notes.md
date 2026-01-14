- Jedno konto, wiele skrzynek email.
- Możliwość wybrania do których ma dostęp asystent

- Strona konfiguracja - podgląd wszystkich adresów email (zablokowanych/przechodzących w celu łatwego odblokowanoa/zablokowania adresu)

WhatsApp ->

- zablokuj email spam,
- odblokuj adres email,
- wyszukaj wiadomość/informacje w skrzynce

- moduł backend -> podczas wysyłania powiadomień musi również sprawdzić folder 'wysłane' pod kątem konieczności aktualizacji zadań 'delegowanych manualnie'

- obsługa 'delegacji' - backend musi uruchamiać ten moduł podczas cron job. sprawdza liste wiadomości w folderze wysłane (czy się zgadza z oczekującymi delegacjami) dodatkowo moduł musi tworzyć podsumowania oraz je wysyłać do 'cron joba'

- styl prezesa - albo na podstawie kategorii - vip/notyfikacje/klienci/pracownicy albo jako formalny/krótki/miły/oschły
- moduł automatycznej konfiguracji/kalibracji - uruchamiany cyklicznie - skanuje wybrane emaile (zaznaczone jako draft/obsługa manualna)

- konfiguracja automatycznie dodaje nowe emaile do różnych list, w tym VIP. pyt. czy powinna się sama aktualizować, czy też prezes powinien mieć wgląd do niej i ew. edycję / potwierdzenie dodania lub odrzucenie. (rozwiązanie, system powinien to samoczynnie wyciągnąć z poziomu reakcji użytkownika na dane emaile)

- kilka stylów pisania wiadomości użytkownika per konto (raczej nie per skrzynka email)

Konfiguracja: info nt. poszczególnych emaili powinno odpowiadać na pytanie: "Kim on jest dla mnie?" a nie "O czym dokładnie pisaliśmy 3 lata temu?".
Relacja: Podwładny (Project Manager). Temat: Projekt X. Styl: Nieformalny, krótki. Ostatni kontekst: Czekamy na raport (oczekuje follow-upu).
trzeba rozpoznawać KOMPETENCJE 'delegata'

OPCJONALNIE:

- podmiana danych wrażliwych (pesel, haslo, byc moze imie/nazwisko? )
- Wersjonowanie Konfiguracji (Backup) - konfiguracja powinna mieć wiele kopii w bazie - każda kolejna zmiana powinna zostać zachowana, a zwracana jedynie ta aktywna.

Kolejka zadań dla cron jobs - aby nie dopuścić do jednoczesnego pobierania emaili dla wszystkich użytkowników na raz.
