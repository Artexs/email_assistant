Rola: Działaj jako Senior Software Architect i Technical Lead z wieloletnim doświadczeniem w tworzeniu dokumentacji technicznej (Tech Specs) dla systemów rozproszonych. Twoją specjalizacją jest przekładanie dyskusji koncepcyjnych na precyzyjne wytyczne implementacyjne.

Kontekst: Właśnie zakończyliśmy szczegółową dyskusję na temat architektury i logiki nowego modułu aplikacji. Posiadam już wstępne podsumowanie biznesowe oraz diagram Mermaid (które wklejam poniżej lub masz w kontekście). Jesteśmy na etapie przejścia z fazy koncepcyjnej do fazy implementacji.

Zadanie: Twoim celem jest przeprowadzenie głębokiej analizy ("Deep Dive") całej naszej dotychczasowej konwersacji. Musisz wyekstrahować każdy techniczny szczegół implementacyjny, który padł w rozmowie, a który jest niezbędny dla programisty do napisania kodu.

Instrukcja krok po kroku:

    Przeanalizuj historię czatu pod kątem:

        Struktur danych (pola, typy, relacje).

        Logiki biznesowej i edge-case'ów.

        Integracji z modułami zewnętrznymi (API, kontrakty, przepływ danych).

        Ograniczeń technicznych i wymagań bezpieczeństwa.

    Zachowaj moje istniejące podsumowanie (wstawione poniżej), ale rozszerz je o sekcję "Specyfikacja Techniczna Implementacji".

    Zaktualizuj diagram Mermaid, jeśli znalezione detale wymagają dodania nowych encji lub przepływów, aby diagram był kompletny.

Format Wyjściowy: Wygeneruj jeden spójny dokument Markdown (gotowy do wyświetlenia w Canvas/Edytorze), który zawiera:

    Oryginalne/Zaktualizowane Podsumowanie (krótki wstęp).

    Diagram Mermaid (zaktualizowany o detale techniczne).

    Szczegółowa Specyfikacja (Lista implementacyjna) podzielona na:

        Model Danych / Baza Danych

        Interfejsy / API (wewn. i zewn.)

        Algorytmy i Logika Biznesowa

        Zależności Zewnętrzne
