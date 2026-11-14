# Owner audit of lab-01 v1

30 cases: 30 random, 0 contested.
Judge each mail as a mail. Then set its line in audit/v1-verdicts.json to "ok" or "wrong: <category>".
Categories: urgent, needs_reply, delegation, info, notification, spam.

## b-del-0028

- part: holdout (random)
- slot category: delegation
- urgency source: none
- hard cases: none
- brief: a task in faktury: asks the executive to have Rekrutacje i obsada magazynow handled by the team
- expected delegate: ksiegowa
- expected points: none

Mail as the checker sees it:

- from: Rafal Kwiecinski <rafal.kwiecinski@kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Faktury agencji rekrutacyjnej za grudzień
- attachments: none

~~~~
Cześć Wiktorze,

przy okazji zamykania grudnia wróciła do mnie sprawa rozliczeń z agencją, która prowadziła dla nas rekrutację pracowników na magazyny w Poznaniu i w Lesznie. Agencja wystawiła trzy faktury, ale w żadnej z nich nie zgadza się liczba obsadzonych stanowisk z tym, co mamy w naszej ewidencji kadrowej. Według moich danych w grudniu rozpoczęło pracę dwunastu nowych magazynierów, a faktury obejmują czternaście osób.

Nie chciałbym zajmować Twojego czasu szczegółami, bo to sprawa typowo rozliczeniowa. Proszę więc, żebyś przekazał ją naszej księgowości: niech Magdalena zestawi faktury z listą, którą wyślę jej z działu kadr, wstrzyma płatność za dwie osoby, których nie możemy potwierdzić, i napisze do agencji z prośbą o wyjaśnienie lub notę korygującą.

Agencja ma w umowie czternaście dni na odpowiedź, więc nie ma presji czasowej. Gdyby okazało się, że różnica dotyczy czegoś więcej niż kilku osób, na pewno to zgłoszę.

Przy tej okazji przypominam, że w styczniu czeka nas kolejna rekrutacja sezonowa i chciałbym, żebyśmy od początku mieli jasne zasady fakturowania: osobna pozycja za każdą obsadzoną osobę, data rozpoczęcia pracy w opisie i numer zamówienia z naszego systemu. Magdalena może od razu zaproponować agencji taki wzór faktury, wtedy w przyszłości uniknęlibyśmy podobnych rozbieżności i kolejnych wymian korespondencji między naszymi działami.

Dziękuję, że to przekażesz dalej.
~~~~

## b-del-0130

- part: holdout (random)
- slot category: delegation
- urgency source: none
- hard cases: none
- brief: a task in faktury: Oliver Pemberton wants someone to take care of Eksport i odprawy celne
- expected delegate: ksiegowa
- expected points: none

Mail as the checker sees it:

- from: Oliver Pemberton <oliver.pemberton@kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: transit docs - invoice
- attachments: none

~~~~
hi Wiktor,

the Hamburg forwarder billed the transit documents twice, once on the old rate and once on the new one. Can you ask accounting to check both invoices against the rate agreement and request a credit note for the overcharge?

The sum is not big but I'd rather have it fixed before the month closes. No need to come back to me, just let Magdalena handle it.

Cheers, Oliver | Head of Export | Kordelan Distribution
~~~~

## b-inf-0163

- part: holdout (random)
- slot category: info
- urgency source: none
- hard cases: none
- brief: Oliver Pemberton reports a status on Eksport i odprawy celne for the executive's awareness
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Oliver Pemberton <oliver.pemberton@kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Export desk - January wrap-up and how February looks
- attachments: none

~~~~
Wiktor,

wrapping up January from the export desk, in case you want the overview. It is a bit long, but there is nothing here that needs your attention.

Volumes: we shipped 214 loads on export lanes, 9 percent more than in December. The Nordic lanes took about half of that, followed by Germany and the Baltic states. Our on-time record was 96 percent, which is the best monthly figure since summer.

Customs: apart from two short holds in Hamburg, everything cleared within a working day. The new pre-notification system for chilled food is working properly. Our broker partner handled it without problems.

Customers: Nordic Foods is happy, and Karin has said so twice in writing. A Danish importer asked for a quote on a new weekly lane. Piotr is preparing it, and I will tell you if it grows into something bigger.

February: demand looks steady, with a small peak around the middle of the month for chilled goods. We have enough trailers, and Halina confirmed the driver schedule. The only thing on my radar is the possible port strike in Gdynia, but at the moment it is only a rumour.

That is it from me.

Cheers, Oliver | Head of Export | Kordelan Distribution
~~~~

## b-inf-0173

- part: dev (random)
- slot category: info
- urgency source: none
- hard cases: none
- brief: shares plain information about Wiadomosci branzowe i rynek frachtow; no question and no request
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Magazyn Logistyka Dzis <redakcja@logistyka-dzis.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Logistyka Dzis: rynek magazynowy w Polsce
- attachments: none

~~~~
Podaż nowoczesnych powierzchni magazynowych w Polsce wzrosła w ubiegłym roku o 11 proc. Najwięcej nowych obiektów oddano w regionach łódzkim i wielkopolskim.

Według raportu doradców nieruchomości czynsze za magazyny w największych węzłach pozostały stabilne, a poziom pustostanów wynosi 5,3 proc. Autorzy raportu spodziewają się, że w tym roku popyt utrzymają firmy handlu internetowego.

Kolejne wydanie w przyszły piątek. W kolejnym numerze porównamy stawki za metr kwadratowy w największych hubach logistycznych i przedstawimy prognozy na drugą połowę roku.
~~~~

## b-not-0069

- part: holdout (random)
- slot category: notification
- urgency source: none
- hard cases: none
- brief: a system message about System magazynowy i awarie ERP, sent by System ERP Kordelan, with no personal text
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: System ERP Kordelan <noreply@erp-kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: ERP: raport rozbieżności inwentaryzacji cyklicznej
- attachments: none

~~~~
System ERP Kordelan | Raport automatyczny

Inwentaryzacja cykliczna sektora C w magazynie w Poznaniu została zamknięta 14.01.2027. Przeliczono 612 lokalizacji. Zgodność ze stanem w systemie: 99,3 procent. Rozbieżności wykryto w 4 lokalizacjach, z różnicą od 1 do 3 sztuk na pozycję. Wszystkie różnice zapisano jako korekty w module magazynowym zgodnie z regułą tolerancji.

Pełna lista korekt jest dostępna w module raportów. Wiadomość została wygenerowana automatycznie, nie odpowiadaj na ten adres.
~~~~

## b-not-0140

- part: holdout (random)
- slot category: notification
- urgency source: none
- hard cases: none
- brief: an automated message from Powiadomienia Bankowe about Faktury i platnosci; no person writes it
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Powiadomienia Bankowe <noreply@bank-aurum.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Potwierdzenie przelewu własnego między rachunkami
- attachments: none

~~~~
Aurum Bank | Powiadomienie o operacji

Zrealizowano przelew własny między rachunkami firmowymi. Rachunek obciążany: PL00-TEST-4410. Rachunek uznawany: PL00-TEST-4411, rachunek rezerwy podatkowej. Kwota: 25 000,00 PLN. Data realizacji: 15.01.2027. Tytuł: rezerwa na podatek VAT za grudzień. Status: zrealizowano.

Saldo rachunku obciążanego po operacji: 336 630,25 PLN. Przelewy własne między rachunkami firmowymi są realizowane natychmiast i nie podlegają opłacie. Potwierdzenie operacji w formie dokumentu znajduje się w historii operacji w bankowości internetowej. Wiadomość wygenerowana automatycznie. Prosimy na nią nie odpowiadać.
~~~~

## b-not-0141

- part: holdout (random)
- slot category: notification
- urgency source: none
- hard cases: none
- brief: a system message about Faktury i platnosci, sent by Powiadomienia Bankowe, with no personal text
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Powiadomienia Bankowe <noreply@bank-aurum.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Zmiana adresu korespondencyjnego rachunku
- attachments: none

~~~~
Aurum Bank | Adres korespondencyjny rachunku PL00-TEST-4410 został zmieniony 15.01.2027. Wiadomość automatyczna.
~~~~

## b-rep-0079

- part: holdout (random)
- slot category: needs_reply
- urgency source: none
- hard cases: none
- brief: asks the executive a direct question about Karty paliwowe i ceny paliw and waits for an answer
- expected delegate: none
- expected points: 
  - Accept the new 21-day terms with a 1 percent early-payment discount, or keep 30 days
  - Answer in writing by the end of the month

Mail as the checker sees it:

- from: Ewelina Marszalek <ewelina.marszalek@paliwa-flota.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Card payment terms: question for you
- attachments: none

~~~~
Dear Mr Szalewski,

our finance team has changed the payment terms for fuel card invoices for all large customers. The new standard is 21 days instead of 30, with a discount of one percent for payment within 10 days.

Your account is among those where the change would apply from March. I would like to ask whether you accept the new terms, or whether you prefer to keep the current 30 days without the discount.

Both options are possible. Please let me know in writing by the end of the month.

Ewelina Marszalek
~~~~

## b-rep-0138

- part: holdout (random)
- slot category: needs_reply
- urgency source: none
- hard cases: none
- brief: asks the executive a direct question about Posiedzenie rady nadzorczej i budzet and waits for an answer
- expected delegate: none
- expected points: 
  - Say whether the three indicators (operating margin, delivery punctuality, complaint level) are right and measurable
  - Name any indicator that needs a clearer definition
  - Say whether the larger variable share risks short-term decisions
  - Answer in writing by 28.01.2027

Mail as the checker sees it:

- from: Zbigniew Orlowicz <z.orlowicz@rada-kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Wynagrodzenie zarządu na 2027: stanowisko rady i pytania
- attachments: none

~~~~
Panie Prezesie,

komitet wynagrodzeń rady przygotował projekt zasad wynagradzania zarządu na rok 2027. Zanim przedstawimy go całej radzie, chcę poznać Pańskie stanowisko, ponieważ zmiany dotyczą bezpośrednio Pana i pozostałych członków zarządu.

Projekt zakłada utrzymanie wynagrodzenia podstawowego bez zmian i zwiększenie udziału premii zmiennej z 30 do 40 procent całości. Premia byłaby uzależniona od trzech wskaźników: marży operacyjnej, terminowości dostaw i poziomu reklamacji. Każdy z nich miałby wagę jednej trzeciej.

Chciałbym wiedzieć, czy takie wskaźniki są Pana zdaniem właściwe i mierzalne. Czy któryś z nich wymaga zmiany lub doprecyzowania definicji? W szczególności poziom reklamacji bywa trudny do jednoznacznego zmierzenia, bo zależy od zgłoszeń klientów.

Proszę także o opinię, czy zarząd widzi ryzyko, że zwiększona część zmienna zachęci do krótkoterminowych decyzji kosztem długoterminowych relacji z klientami.

Odpowiedź w formie pisemnej proszę przesłać do 28.01.2027. Komitet zbierze się następnego dnia, a ja chciałbym uwzględnić Pana uwagi w jego pracach. Proszę też o dyskrecję w sprawie tych dokumentów. Jeśli uzna Pan, że potrzebna jest rozmowa, jestem do dyspozycji w piątek rano. Chcę, aby ostateczna wersja została przyjęta bez zaskoczeń dla żadnej ze stron, a Pana uwagi traktuję jako ważną część tego procesu.

Z powazaniem | Zbigniew Orlowicz | Przewodniczacy Rady Nadzorczej
~~~~

## b-rep-0180

- part: dev (random)
- slot category: needs_reply
- urgency source: none
- hard cases: none
- brief: asks the executive a direct question about Eksport i odprawy celne and waits for an answer
- expected delegate: none
- expected points: 
  - Czy zostajemy przy obecnym agencie celnym na drugi rok umowy, czy zgadzamy się na trzymiesięczny okres próbny z innym agentem
  - Czy zmiana agenta wiąże się z ryzykiem, zwłaszcza dla certyfikatów żywności
  - Odpowiedź pisemna prezesa

Mail as the checker sees it:

- from: Karin Lindqvist <karin.lindqvist@nordicfoods-trade.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Question on the customs broker for the next contract year
- attachments: none

~~~~
Dear Mr Szalewski,

I am writing to you directly with a question that our team cannot answer for you. At the end of January, our framework agreement with Kordelan enters its second year, and with it the arrangement under which your customs broker clears all our shipments through the port of Gdynia.

Over the last months we have had a good experience, and the clearance times have fallen from about 26 hours to 11. At the same time, we were offered an alternative by another broker, who promises a lower price per clearance, and our finance department would like us to at least consider it. Before we start any talks with them, I would like to know your position.

Would you prefer that we keep your current broker for the second year, accepting a small increase in price, or do you agree that we invite the other broker for a trial period of three months? We would of course make sure that your shipments are not delayed in the process, and we would coordinate everything with your export department.

I would also like to ask whether you see any risk in a change that we may not be aware of, for example due to the certificates that the current broker prepares for our food products. This is important to us, because our quality department has strict rules.

A written reply from you personally would be helpful, as we want to make this decision together and not on the basis of assumptions. A few sentences are enough. Thank you very much for your time and for the cooperation over the past year.
~~~~

## b-rep-0196

- part: dev (random)
- slot category: needs_reply
- urgency source: none
- hard cases: none
- brief: asks the executive a direct question about Zakup naczep i serwis floty and waits for an answer
- expected delegate: none
- expected points: 
  - Wybór warsztatu serwisującego naczepy: Poznań albo Łódź
  - Decyzja do środy

Mail as the checker sees it:

- from: Halina Strzemecka <halina.strzemecka@kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Serwis naczep: który warsztat?
- attachments: none

~~~~
Cześć Wiktor,

którą ofertę serwisu wybieramy, warsztat w Poznaniu czy ten w Łodzi? Potrzebuję Twojej decyzji do środy.

Pozdrawiam | Halina Strzemecka | Dyrektor Operacyjny | Kordelan Dystrybucja
~~~~

## b-spa-0061

- part: holdout (random)
- slot category: spam
- urgency source: none
- hard cases: none
- brief: an unsolicited promo from Targi Magazynowe Expo that offers something unrelated to the executive's work
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Targi Magazynowe Expo <oferty@targi-magazynowe.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Pakiet reklamowy w katalogu targowym
- attachments: none

~~~~
Szanowni Państwo, w katalogu Targów Magazynowych Expo zostało ostatnie wolne miejsce na reklamę na okładce! Dla firm, które zdecydują się do piątku, przygotowaliśmy rabat 40 procent oraz bezpłatne umieszczenie logo na stronie wydarzenia. Katalog trafi do ponad dwudziestu tysięcy odwiedzających, a do tego do prasy branżowej i partnerów handlowych.

Odpowiedzcie na tę wiadomość, a nasz doradca przygotuje projekt reklamy bez żadnych opłat. Liczba miejsc jest ograniczona, więc nie czekajcie!
~~~~

## b-spa-0171

- part: dev (random)
- slot category: spam
- urgency source: none
- hard cases: none
- brief: Paliwa Flota Billing pushes a discount or an offer that nobody asked for
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Paliwa Flota Billing <billing@paliwa-fiota.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Exclusive Fleet Club: your VIP upgrade is ready
- attachments: none

~~~~
Dear fleet manager,

As a thank-you for your loyalty, Paliwa-Flota invites you to join our new Fleet Club. Members enjoy free car-wash vouchers, discounts on tyres from selected partners, a private concierge line and a gift package delivered to your office. Membership is normally 299 EUR per year, but your company qualifies for a free upgrade this month.

To activate the VIP status, log in to your account at http://paliwa-fiota.test/club and confirm the company details and the card numbers you would like to include in the program. The form takes less than two minutes. Please complete it within the next 24 hours, because the invitation expires automatically and we cannot reissue it.

This message is not connected with any invoice, and no payment is required. It is simply a special offer for our best customers.

As a member you will also receive a quarterly newsletter with fuel-saving tips, an invitation to our annual drivers' day at a partner race track, and priority support on weekends. Several hundred companies have already joined, and we would like your fleet to be among them.

We hope to see you in the Fleet Club soon.

Paliwa-Flota Billing Department
~~~~

## b-spa-0256

- part: holdout (random)
- slot category: spam
- urgency source: none
- hard cases: none
- brief: an unsolicited promo from Targi Magazynowe Expo that offers something unrelated to the executive's work
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Targi Magazynowe Expo <oferty@targi-magazynowe.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Exhibitor invitation: Warehouse Expo, autumn edition – early bird prices
- attachments: none

~~~~
Dear Sir or Madam,

Warehouse Expo is the biggest meeting of the warehousing and transport industry in the region, and the autumn edition is already open for exhibitors. Early bird prices are valid only for the first fifty firms that sign up, and we have already received more than thirty applications this week.

What do you get as an exhibitor?

- a stand of your choice from 9 to 36 m2 in hall A or B
- your logo on the website and in the printed guide for 9,000 visitors
- a speaking slot on the product stage for the first ten Gold partners
- a place at the exhibitors' banquet on the first evening
- a free pass to the conference for two persons from your team

Our fair is known for fast deals: last year more than half of the exhibitors told us that they signed at least one contract during the three days of the event. We cannot promise the same for you, but we promise a lot of contacts with serious buyers from Poland, the Baltic states and Scandinavia.

To keep the early bird price, please answer this message by Friday. We prepare the stand plan and the contract in one working day, and you only need to send us your company name, the size of the stand and your preferred hall. Our advisers wait for your call or your reply and they gladly show you the hall plan with the free places.

Do not miss this offer, because after Friday the standard price list applies!
~~~~

## b-urg-0052

- part: holdout (random)
- slot category: urgent
- urgency source: text
- hard cases: none
- brief: about Eksport i odprawy celne: the sender needs the executive to act today and says so plainly
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Daniel Hargreaves <daniel.hargreaves@baltic-freight-partners.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Export lane – decision today
- attachments: none

~~~~
Dear Mr Szalewski,

the carrier for the Baltic export lane asks for your decision today: accept the new rate or lose the slot. Please answer today.

Kind regards | Daniel Hargreaves | Managing Partner | Baltic Freight Partners
~~~~

## b-urg-0124

- part: holdout (random)
- slot category: urgent
- urgency source: text
- hard cases: none
- brief: about Umowy i cenniki sprzedazy: the sender needs the executive to act today and says so plainly
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Tomasz Brzezinski <tomasz.brzezinski@meblodrew.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Cennik sprzedaży – podpis dziś
- attachments: none

~~~~
Szanowny Panie Prezesie,

proszę o podpisanie dziś umowy o cenniku sprzedaży na rok 2027. Produkcja ruszy w poniedziałek, a bez Pana podpisu nie mogę zamówić materiałów.

Ceny zostały uzgodnione z Pańskim koordynatorem sprzedaży, ale umowa wymaga podpisu prezesa. Proszę o odesłanie skanu do końca dnia. Jeśli wolą Państwo podpisać dokument na papierze, mogę wysłać kuriera do biura jeszcze dzisiaj.

Z powazaniem | Tomasz Brzezinski | Dyrektor Zakupow | Meblodrew
~~~~

## h-vip-05

- part: holdout (random)
- slot category: needs_reply
- urgency source: none
- hard cases: vip_looks_like_spam
- brief: from a VIP, but looks like a promo or newsletter
- expected delegate: none
- expected points: 
  - Say whether the discount of 15 percent on the second half of the fee was agreed

Mail as the checker sees it:

- from: Zbigniew Orlowicz <z.orlowicz@rada-kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Special price for you: the new auditor's invoice
- attachments: none

~~~~
Wiktor,

the subject sounds like a promo, I know, but it is just the auditor's invoice. The auditor sent a new invoice with a strange discount of 15 percent on the second half of the fee, and I do not know whether we agreed on it. Can you tell me whether the discount is right? I do not want to pay a wrong amount, and the sender asked me to confirm by the end of the month.

If you do not remember it, ask the accountant to check the engagement letter and let me know what it says. Whatever the answer is, I just need a clear yes or no from the management board.
~~~~

## w-1-100

- part: week (random)
- slot category: info
- urgency source: none
- hard cases: none
- brief: Rafal Kwiecinski reports a status on Rekrutacje i obsada magazynow for the executive's awareness
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Rafal Kwiecinski <rafal.kwiecinski@kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Rekrutacje - status agencji
- attachments: none

~~~~
Dzień dobry Wiktorze,

agencja potwierdziła sześć osób do Gdyni od 1.02.2027. Informuję dla wiadomości, bez potrzeby reakcji.

Z wyrazami szacunku | Rafal Kwiecinski | Dyrektor ds. Personalnych
~~~~

## w-1-117

- part: week (random)
- slot category: notification
- urgency source: none
- hard cases: none
- brief: a system message about Karty paliwowe i ceny paliw, sent by Magazyn Logistyka Dzis, with no personal text
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Magazyn Logistyka Dzis <redakcja@logistyka-dzis.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Zmiana harmonogramu wysyłki tematu: karty paliwowe
- attachments: none

~~~~
Automatyczne powiadomienie z systemu wysyłki Logistyka Dzis.

Od 1.02.2027 artykuły z tematu "karty paliwowe" będą wysyłane w zbiorczej wiadomości raz w tygodniu, w piątek o 07:00, zamiast po każdej publikacji. Zmiana dotyczy wszystkich prenumeratorów, którzy mają włączone alerty tematyczne.

Częstotliwość alertów możesz zmienić w panelu prenumeraty, w zakładce Powiadomienia. Jeśli chcesz nadal otrzymywać alerty po każdej publikacji, wybierz opcję natychmiastowych powiadomień i zapisz ustawienia.

Redakcja Logistyka Dzis | wypisz sie z listy
~~~~

## w-2-083

- part: week (random)
- slot category: spam
- urgency source: none
- hard cases: phishing_urgent_push
- brief: fake payment demand or account lock that pushes for action now
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Paliwa Flota Billing <billing@paliwa-fiota.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Blokada konta flotowego za 2 godziny
- attachments: none

~~~~
Szanowni Państwo,

wykryliśmy próbę nieautoryzowanego dostępu do konta flotowego Państwa firmy. Aby zapobiec utracie środków, konto zostanie zablokowane za dwie godziny, a wszystkie karty kierowców przestaną działać na stacjach.

Aby anulować blokadę, odpowiedz teraz na tę wiadomość i podaj numer karty głównej oraz dane do logowania do panelu klienta. Brak odpowiedzi w ciągu dwóch godzin oznacza potwierdzenie blokady oraz opłatę za odblokowanie w wysokości 1 200 zł.

Paliwa-Flota Billing Department
~~~~

## w-3-011

- part: week (random)
- slot category: info
- urgency source: none
- hard cases: none
- brief: Halina Strzemecka reports a status on Zakup naczep i serwis floty for the executive's awareness
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Halina Strzemecka <halina.strzemecka@kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Naczepy: stan zamówienia i serwis w styczniu
- attachments: none

~~~~
Cześć Wiktorze,

przesyłam krótkie podsumowanie stanu floty naczep na koniec stycznia. Zamówienie na trzy naczepy chłodnicze jest nadal zaplanowane do odbioru 4.03, a producent potwierdził, że agregaty chłodnicze są już w drodze do fabryki.

W serwisie floty w styczniu wykonaliśmy 11 przeglądów, z czego dziewięć zakończyło się bez usterek. Dwie naczepy wymagały wymiany klocków hamulcowych, a obie wróciły do pracy w ciągu dwóch dni. Dwie naczepy zastępcze z wynajmu działają bez zastrzeżeń.

Piszę tylko po to, żebyś miał aktualny obraz sytuacji. Kolejne podsumowanie przygotuję na początku marca.

Pozdrawiam | Halina Strzemecka | Dyrektor Operacyjny | Kordelan Dystrybucja
~~~~

## w-3-018

- part: week (random)
- slot category: info
- urgency source: none
- hard cases: none
- brief: shares plain information about Wiadomosci branzowe i rynek frachtow; no question and no request
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Magazyn Logistyka Dzis <redakcja@logistyka-dzis.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Rynek frachtów: stawki bez zmian
- attachments: none

~~~~
Rynek frachtów w skrócie

Stawki za przewóz ładunków całopojazdowych na trasach krajowych nie zmieniły się w ostatnim tygodniu. Na trasach do Niemiec utrzymuje się lekka przewaga ofert nad popytem.

Redakcja Logistyka Dzis | wypisz sie z listy
~~~~

## w-3-040

- part: week (random)
- slot category: spam
- urgency source: none
- hard cases: none
- brief: an unsolicited promo from Paliwa Flota Billing that offers something unrelated to the executive's work
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Paliwa Flota Billing <billing@paliwa-fiota.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Kawa gratis na stacjach przy tankowaniu kartą
- attachments: none

~~~~
Szanowni Państwo,

Paliwa Flota Billing zaprasza kierowców Państwa firmy na darmową kawę! Każdy kierowca, który zatankuje na dowolnej stacji naszej sieci kartą flotową, dostaje kawę lub herbatę gratis, a dodatkowo losuje nagrody w naszej loterii.

Promocja trwa przez cały luty, a udział w niej nie wymaga żadnych dodatkowych zgłoszeń. Wystarczy, że kierowca pokaże przy kasie kartę. Lista stacji biorących udział w promocji jest dostępna u naszego doradcy, a nagrody w loterii wysyłamy kurierem do firm. Zapraszamy do udziału i życzymy dobrej drogi!
~~~~

## w-4-133

- part: week (random)
- slot category: needs_reply
- urgency source: none
- hard cases: none
- brief: asks the executive a direct question about Terminy dostaw i okna rozladunku and waits for an answer
- expected delegate: none
- expected points: 
  - Czy Kordelan może zrealizować dostawę 20 palet w dwóch transzach po 10 palet, 12.02 i 13.02, w oknie 6:00-10:00

Mail as the checker sees it:

- from: Tomasz Brzezinski <tomasz.brzezinski@meblodrew.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Dostawa płyt w dwóch transzach - pytanie
- attachments: none

~~~~
Szanowny Panie Prezesie,

zamówiliśmy 20 palet płyt meblowych na 12.02.2027. Nasza rampa nie przyjmie wszystkich w jednym oknie, więc zastanawiamy się nad podziałem dostawy. Czy Kordelan może zrealizować ją w dwóch transzach po 10 palet, 12.02 i 13.02, w oknie od 6:00 do 10:00? Chcemy w ten sposób uniknąć kolejki przy rampie i przestojów w produkcji. Proszę o odpowiedź, bo od tego zależy nasz plan produkcji na ten tydzień.

Z powazaniem | Tomasz Brzezinski | Dyrektor Zakupow | Meblodrew
~~~~

## w-5-022

- part: week (random)
- slot category: spam
- urgency source: none
- hard cases: none
- brief: an unsolicited promo from Targi Magazynowe Expo that offers something unrelated to the executive's work
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Targi Magazynowe Expo <oferty@targi-magazynowe.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Targi Turystyczne Morze i Góry - wystaw się u nas!
- attachments: none

~~~~
Szanowni Państwo,

serdecznie zapraszamy do udziału w Targach Turystycznych Morze i Góry, które odbędą się w marcu w Gdańsku. Wydarzenie przyciąga co roku ponad 15 tysięcy gości, w tym właścicieli pensjonatów, biur podróży i firm organizujących wyjazdy integracyjne. To idealne miejsce, aby zaprezentować usługi, o których nikt jeszcze nie słyszał!

Co oferujemy wystawcom, którzy zgłoszą się do końca lutego:
- rabat 35% na standardowe stoisko o powierzchni 9 metrów kwadratowych
- bezpłatny wpis do katalogu drukowanego i do aplikacji mobilnej
- dwa bilety na uroczystą kolację dla wystawców
- baner reklamowy przy wejściu do hali, o wartości 900 EUR
- pierwszeństwo przy wyborze lokalizacji stoiska

Do tej pory zgłosiło się już 230 firm, a stoiska w najlepszych miejscach znikają w kilka dni. Wystarczy odpowiedzieć na tę wiadomość, podając nazwę firmy i wielkość stoiska, a nasz doradca przygotuje umowę jeszcze tego samego dnia. Przyjmujemy też zamówienia na reklamę w materiałach targowych oraz na pakiety gadżetów dla gości, takich jak torby, długopisy i kubki z logo firmy, z dostawą prosto do Państwa biura.

Nie przegap tej okazji i zarezerwuj miejsce dla swojej firmy jeszcze dziś, zanim zabraknie wolnych stoisk!

Zespol Targi Magazynowe Expo | Dzial Handlowy
~~~~

## w-5-059

- part: week (random)
- slot category: urgent
- urgency source: vip
- hard cases: none
- brief: a short request about Przetarg sieci Zielona Hurtownia from an important person; no deadline words
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Genowefa Jastrzebska <g.jastrzebska@hurtownia-zielona.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Przetarg - proszę o telefon przed 13:00
- attachments: none

~~~~
Panie Wiktorze,

komisja przetargowa zbiera się dziś o 14:00 i chce usłyszeć od Pana potwierdzenie cen. Proszę zadzwonić do mnie przed 13:00, bo bez tego Państwa oferta wypada z oceny.

Genowefa Jastrzębska
~~~~

## w-5-060

- part: week (random)
- slot category: spam
- urgency source: none
- hard cases: none
- brief: an unsolicited promo from Targi Magazynowe Expo that offers something unrelated to the executive's work
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Targi Magazynowe Expo <oferty@targi-magazynowe.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Targi Hodowlane - rabat dla firm z Pomorza
- attachments: none

~~~~
Zapraszamy na Targi Hodowlane!

Szanowni Państwo, w kwietniu w Bydgoszczy odbędą się Targi Hodowlane z pokazami maszyn rolniczych, pasz i wyposażenia ferm. Firmy z województwa pomorskiego mogą wystawić się z rabatem 20% na stoisko, a trzy pierwsze zgłoszenia dostają bezpłatne miejsce parkingowe dla ciężarówki wystawowej.

Wystarczy odpowiedzieć na tę wiadomość z nazwą firmy i liczbą metrów stoiska. Nasz doradca zadzwoni do Państwa jeszcze dziś i przedstawi szczegółowy plan hali oraz pełną listę wystawców zgłoszonych do tej pory.
~~~~

## w-5-068

- part: week (random)
- slot category: notification
- urgency source: none
- hard cases: none
- brief: a system message about Wiadomosci branzowe i rynek frachtow, sent by Supply Chain Weekly, with no personal text
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Supply Chain Weekly <digest@supplychain-weekly.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Email address verified
- attachments: none

~~~~
Verification complete

Your email address was verified on 29.01.2027. Your reader account is active.

Supply Chain Weekly | Unsubscribe | Manage preferences
~~~~

## w-6-042

- part: week (random)
- slot category: notification
- urgency source: none
- hard cases: none
- brief: an automated message from Supply Chain Weekly about Wiadomosci branzowe i rynek frachtow; no person writes it
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Supply Chain Weekly <digest@supplychain-weekly.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Your Supply Chain Weekly subscription was renewed
- attachments: none

~~~~
Receipt: your annual subscription to Supply Chain Weekly was renewed on 30.01.2027. Amount charged: EUR 79.00. An invoice is available in your account.

Supply Chain Weekly | Unsubscribe | Manage preferences
~~~~

## w-7-038

- part: week (random)
- slot category: urgent
- urgency source: vip
- hard cases: none
- brief: a short request about Posiedzenie rady nadzorczej i budzet from an important person; no deadline words
- expected delegate: none
- expected points: none

Mail as the checker sees it:

- from: Zbigniew Orlowicz <z.orlowicz@rada-kordelan.test>
- to: wiktor.szalewski@kordelan.test
- cc: none
- subject: Budget figures for the audit committee package
- attachments: none

~~~~
Dear Mr Szalewski,

the secretary of the board sends the audit committee package to all members at 23:00 tonight. The package must contain the final budget figures, and only you can confirm them.

Please send me your confirmation of the figures before 22:00 tonight. Without it, the package leaves incomplete, and the committee cannot review the budget before Monday's meeting. I will be available by e-mail until the package is sent.
~~~~
