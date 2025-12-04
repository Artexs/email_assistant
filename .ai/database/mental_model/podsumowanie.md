<conversation_summary>

Architektura Multi-Mailbox: System obsługuje wielu użytkowników, z których każdy może posiadać wiele skrzynek pocztowych. Najmniejszą jednostką logiczną dla danych (kontakty, delegaci, kategorie) jest pojedyncza skrzynka (mailbox_id).
Separacja Kontaktów i Delegatów: Utworzenie dwóch niezależnych tabel: contacts (do analizy stylu i wagi) oraz delegates (do delegowania zadań). Obie tabele są powiązane z mailbox_id.
Zarządzanie Sekretami: Wrażliwe dane (tokeny, hasła) będą przechowywane w osobnej tabeli secrets, powiązanej bezpośrednio z user_id (a nie mailbox_id), co upraszcza zarządzanie uwierzytelnianiem na poziomie użytkownika.
Audit Draftów: Historia zmian w draftach (draft_audit) będzie przechowywana jako pole typu JSONB bezpośrednio w tabelach contacts oraz delegates.
Brak Personalizacji Indywidualnej: W MVP styl komunikacji jest definiowany wyłącznie na poziomie kategorii (categories), bez możliwości nadpisywania stylu dla pojedynczych kontaktów (style_override pominięte).
Wyłączenie Zadań z Mental Model: Tabela delegation_tasks została wyłączona z zakresu modułu Mental Model.
Brak Bazy Wektorowej: Rezygnacja z integracji bazy wektorowej i few_shot_examples w tabeli kategorii na etapie MVP.
<matched_recommendations>

Utworzenie osobnej tabeli secrets do przechowywania danych uwierzytelniających (zmodyfikowane: powiązanie z user_id).
Zastosowanie struktury JSONB dla pola draft_audit (tablica obiektów z historią zmian) w tabelach contacts i delegates.
Powiązanie tabeli categories z mailbox_id i uwzględnienie pola base_style_prompt.
Zastosowanie typu TEXT[] dla pola competence_tags w tabeli delegates.
Dodanie flagi active (BOOLEAN) w tabeli delegates.
Zastosowanie ograniczenia unikalności (UNIQUE constraint) dla par (mailbox_id, email).
Uwzględnienie pól display_name, last_interaction_at oraz wskaźnika jakości (trust_score) w tabeli contacts. </matched_recommendations>
<database_planning_summary>

Główne Wymagania
Schemat bazy danych został zaprojektowany dla architektury multi-tenant, gdzie użytkownik (users) posiada wiele skrzynek (mailboxes). Moduł Mental Model operuje na poziomie skrzynki, przechowując niezależne zestawy kontaktów, delegatów i kategorii. Bezpieczeństwo opiera się na separacji sekretów i Row Level Security (RLS).

Kluczowe Encje i Relacje
users: Tabela główna użytkowników.
Relacja 1:N do secrets (przechowywanie tokenów API, haseł - powiązane z użytkownikiem).
Relacja 1:N do mailboxes.
mailboxes: Skrzynki pocztowe (jednostka logiczna).
Pola: id (UUID), user_id (FK), email, is_active. (Pole provider pominięte w MVP).
categories: Definicje stylów komunikacji (np. VIP, Zespół).
Relacja N:1 do mailboxes.
Pola: name, base_style_prompt, description_target, description_generated.
contacts: Baza wiedzy o nadawcach (Mental Model).
Relacja N:1 do mailboxes.
Relacja N:1 do categories.
Pola: email, display_name, trust_score (waga/jakość), last_interaction_at, draft_audit (JSONB).
delegates: Lista operacyjna do delegowania zadań.
Relacja N:1 do mailboxes.
Pola: email, competence_tags (TEXT[]), active, draft_audit (JSONB).
Bezpieczeństwo i Skalowalność
Sekrety: Wydzielone do osobnej tabeli, co ułatwia rotację kluczy i zwiększa bezpieczeństwo.
Skalowalność: Struktura oparta na UUID i relacjach do mailbox_id pozwala na łatwe dodawanie nowych skrzynek i użytkowników bez zmian w schemacie.
Wydajność: JSONB dla historii draftów pozwala na elastyczność bez tworzenia milionów wierszy w osobnej tabeli logów dla każdej drobnej zmiany. </database_planning_summary>
<unresolved_issues>

Szczegóły implementacji secrets: Należy doprecyzować, jak rozróżniać sekrety dla różnych usług (np. pole service_type lub provider_id) w kontekście powiązania tylko z user_id, gdy użytkownik może mieć wiele kont tego samego typu (np. dwa konta Gmail).
Provider skrzynki: Pole provider w tabeli mailboxes zostało pominięte w MVP, co może wymagać uzupełnienia przy dodawaniu obsługi innych dostawców niż domyślny. </unresolved_issues> </conversation_summary>
