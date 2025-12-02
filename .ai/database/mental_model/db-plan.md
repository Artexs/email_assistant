# Plan Schematu Bazy Danych - Moduł Mental Model

Ten dokument zawiera szczegółowy projekt schematu bazy danych dla modułu Mental Model oraz podstawowych tabel systemowych, oparty na PostgreSQL i dostosowany do stacku technologicznego (Supabase).

## 1. Lista Tabel

### 1.1. `users` (Public)
Centralna tabela użytkowników, powiązana z systemem uwierzytelniania (np. `auth.users` w Supabase).

| Kolumna | Typ Danych | Ograniczenia | Opis |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, `REFERENCES auth.users(id)` | Unikalny identyfikator użytkownika (powiązany z Auth). |
| `email` | `TEXT` | `NOT NULL`, `UNIQUE` | Adres email logowania użytkownika. |
| `full_name` | `TEXT` | | Imię i nazwisko użytkownika. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data utworzenia konta. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data ostatniej aktualizacji. |

### 1.2. `mailboxes`
Reprezentuje skrzynki pocztowe podpięte przez użytkownika (np. konta Gmail). Użytkownik może mieć wiele skrzynek.

| Kolumna | Typ Danych | Ograniczenia | Opis |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` | Unikalny identyfikator skrzynki. |
| `user_id` | `UUID` | `NOT NULL`, `REFERENCES users(id) ON DELETE CASCADE` | Właściciel skrzynki. |
| `email` | `TEXT` | `NOT NULL` | Adres email skrzynki (np. prezes@firma.com). |
| `is_active` | `BOOLEAN` | `DEFAULT TRUE` | Czy skrzynka jest aktywna w systemie. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data dodania skrzynki. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data ostatniej aktualizacji. |

**Ograniczenia złożone:**
- `UNIQUE(user_id, email)`: Zapobiega dodaniu tej samej skrzynki dwa razy dla jednego użytkownika.

### 1.3. `secrets`
Przechowuje wrażliwe dane uwierzytelniające (tokeny, hasła aplikacji) dla usług zewnętrznych. Oddzielona od `mailboxes` dla bezpieczeństwa.

| Kolumna | Typ Danych | Ograniczenia | Opis |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` | Unikalny identyfikator sekretu. |
| `user_id` | `UUID` | `NOT NULL`, `REFERENCES users(id) ON DELETE CASCADE` | Właściciel sekretu (powiązanie z użytkownikiem, nie skrzynką). |
| `service_name` | `TEXT` | `NOT NULL` | Nazwa serwisu (np. 'GMAIL', 'OPENAI') lub email id (np. 'kowalski@gmail.com'). |
| `credentials` | `JSONB` | `NOT NULL` | Zaszyfrowane lub ustrukturyzowane dane (np. `{access_token, refresh_token}`). |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data utworzenia. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data ostatniej aktualizacji. |

### 1.4. `categories` (Mental Model)
Definiuje grupy kontaktów i style komunikacji (np. VIP, Zespół, Spam).

| Kolumna | Typ Danych | Ograniczenia | Opis |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` | Unikalny identyfikator kategorii. |
| `mailbox_id` | `UUID` | `NOT NULL`, `REFERENCES mailboxes(id) ON DELETE CASCADE` | Skrzynka, do której należy kategoria. |
| `name` | `TEXT` | `NOT NULL` | Nazwa kategorii (np. 'VIP'). |
| `base_style_prompt` | `TEXT` | | Instrukcja stylu dla LLM (np. "Pisz krótko i formalnie"). |
| `generated_style_prompt` | `TEXT` | | Ulepszony prompt stylu dla LLM (np. "Pisz krótko i formalnie, ale nie zbyt formelnie"). |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data utworzenia. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data ostatniej aktualizacji. |

### 1.5. `contacts` (Mental Model)
Baza wiedzy o nadawcach. Przechowuje informacje o kontaktach, ich wadze i historii interakcji.

| Kolumna | Typ Danych | Ograniczenia | Opis |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` | Unikalny identyfikator kontaktu. |
| `mailbox_id` | `UUID` | `NOT NULL`, `REFERENCES mailboxes(id) ON DELETE CASCADE` | Skrzynka, w której kontakt występuje. |
| `category_id` | `UUID` | `REFERENCES categories(id) ON DELETE SET NULL` | Przypisana kategoria (styl). |
| `email` | `TEXT` | `NOT NULL` | Adres email kontaktu. |
| `display_name` | `TEXT` | | Wyświetlana nazwa kontaktu. |
| `trust_score` | `INTEGER` | `DEFAULT 0` | Wskaźnik zaufania (-100 do 100). |
| `last_interaction_at` | `TIMESTAMPTZ` | | Data ostatniej interakcji. |
| `draft_audit` | `JSONB` | `DEFAULT '[]'::jsonb` | Log zmian w draftach (do nauki stylu). |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data utworzenia. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data ostatniej aktualizacji. |

**Ograniczenia złożone:**
- `UNIQUE(mailbox_id, email)`: Unikalny kontakt w ramach jednej skrzynki.

### 1.6. `delegates` (Mental Model)
Lista osób, do których można delegować zadania.

| Kolumna | Typ Danych | Ograniczenia | Opis |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | `PRIMARY KEY`, `DEFAULT gen_random_uuid()` | Unikalny identyfikator delegata. |
| `mailbox_id` | `UUID` | `NOT NULL`, `REFERENCES mailboxes(id) ON DELETE CASCADE` | Skrzynka, z której odbywa się delegacja. |
| `email` | `TEXT` | `NOT NULL` | Adres email delegata. |
| `display_name` | `TEXT` | | Nazwa delegata. |
| `competence_tags` | `TEXT[]` | `DEFAULT '{}'` | Tagi kompetencji (np. ['faktury', 'hr']). |
| `active` | `BOOLEAN` | `DEFAULT TRUE` | Czy delegat jest aktywny. |
| `draft_audit` | `JSONB` | `DEFAULT '[]'::jsonb` | Log zmian w draftach delegacji. |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data utworzenia. |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()` | Data ostatniej aktualizacji. |

**Ograniczenia złożone:**
- `UNIQUE(mailbox_id, email)`: Unikalny delegat w ramach jednej skrzynki.

---

## 2. Relacje (Podsumowanie)

- **users (1) -> (N) mailboxes**: Jeden użytkownik może mieć wiele skrzynek pocztowych.
- **users (1) -> (N) secrets**: Sekrety są przypisane do użytkownika, co pozwala na ich ponowne użycie lub łatwiejsze zarządzanie.
- **mailboxes (1) -> (N) categories**: Kategorie są specyficzne dla danej skrzynki (różne skrzynki mogą mieć różne definicje VIP).
- **mailboxes (1) -> (N) contacts**: Kontakty są izolowane per skrzynka.
- **mailboxes (1) -> (N) delegates**: Delegaci są definiowani w kontekście skrzynki.
- **categories (1) -> (N) contacts**: Kontakt należy do jednej kategorii (stylu).

---

## 3. Indeksy

Dla zapewnienia wydajności zapytań należy utworzyć następujące indeksy:

1.  **mailboxes**:
    - `CREATE INDEX idx_mailboxes_user_id ON mailboxes(user_id);`

2.  **secrets**:
    - `CREATE INDEX idx_secrets_user_id ON secrets(user_id);`

3.  **categories**:
    - `CREATE INDEX idx_categories_mailbox_id ON categories(mailbox_id);`

4.  **contacts**:
    - `CREATE INDEX idx_contacts_mailbox_id ON contacts(mailbox_id);`
    - `CREATE INDEX idx_contacts_email ON contacts(email);` (Szybkie wyszukiwanie po emailu)
    - `CREATE INDEX idx_contacts_category_id ON contacts(category_id);`

5.  **delegates**:
    - `CREATE INDEX idx_delegates_mailbox_id ON delegates(mailbox_id);`
    - `CREATE INDEX idx_delegates_email ON delegates(email);`
    - `CREATE INDEX idx_delegates_competence_tags ON delegates USING GIN (competence_tags);` (Wydajne wyszukiwanie po tagach)

---

## 4. Zasady Row Level Security (RLS)

Wszystkie tabele muszą mieć włączone RLS (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).

### 4.1. `users`, `mailboxes`, `secrets`
Dostęp tylko dla właściciela rekordu.
- **Polityka**: `auth.uid() = user_id`

### 4.2. `categories`, `contacts`, `delegates`
Dostęp dla użytkownika będącego właścicielem skrzynki, do której należy rekord.
- **Polityka (SELECT, INSERT, UPDATE, DELETE)**:
  ```sql
  EXISTS (
    SELECT 1 FROM mailboxes
    WHERE mailboxes.id = mailbox_id
    AND mailboxes.user_id = auth.uid()
  )
  ```

---

## 5. Dodatkowe Uwagi

1.  **JSONB dla `draft_audit`**:
    - Struktura JSONB pozwala na elastyczne przechowywanie historii zmian bez konieczności tworzenia osobnej tabeli z milionami wierszy dla każdej drobnej edycji.
    - Sugerowana struktura obiektu w tablicy: `{ "timestamp": "...", "original_draft": "...", "final_sent": "...", "diff_summary": "..." }`.

2.  **Separacja `secrets`**:
    - Tabela `secrets` powinna być traktowana ze szczególną ostrożnością. W środowisku produkcyjnym warto rozważyć szyfrowanie kolumny `credentials` (np. pgcrypto) lub użycie zewnętrznego Vaulta, jeśli Supabase Vault nie jest używany.

3.  **Normalizacja**:
    - Schemat jest znormalizowany (3NF). Powtarzające się dane (np. style) są wydzielone do `categories`.

4.  **Skalowalność**:
    - Użycie UUID jako kluczy głównych ułatwia migrację danych i sharding w przyszłości.
    - Indeksy na kluczach obcych i polach często wyszukiwanych (email) zapewnią wydajność przy rosnącej liczbie maili.
