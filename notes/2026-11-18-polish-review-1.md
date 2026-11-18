# Polish review 1: F110 stage 13, F110 stage 14, F115 stage 11

Scope: the Polish panel texts `trust_*` (autonomy card), `rep_*`, `ob_channel_*`, `ob_report_*`, `title_report` (report page and
onboarding steps), `rs_*`, `switch_reply_drafts`, `sig_title` (style card), and the Polish sentences of `styleFromForm`
(`packages/core/src/replies/style-form.ts`). Reference: the other Polish texts in `apps/web/src/i18n/pl.ts` and
`packages/core/src/texts/notices.ts`. No English text, key or logic changed.

## Changed (18 texts)

| key | old | new | reason |
| --- | --- | --- | --- |
| trust_proof_go | Dowód: {percent}% na {cases} przypadkach testowych | Dowód: {percent} % na {cases} przypadkach testowych | The panel writes "{x} %" with a space everywhere (gate_go, stats_rate, act_confidence). |
| trust_proof_go_provisional | Dowód: {percent}% na … (wstępny) | Dowód: {percent} % na … (wstępny) | Same as above. |
| trust_proof_no_go | Nie udowodniono ({percent}%) | Nie udowodniono ({percent} %) | Same as above. |
| trust_proof_no_go_provisional | Nie udowodniono ({percent}%) (wstępny wynik) | Nie udowodniono ({percent} %) (wstępny wynik) | Same as above. |
| trust_mail_fail | Twoja poczta: ukryłoby to wiadomości, które były Ci potrzebne ({moved} z {acted}) | Twoja poczta: automat ukryłby wiadomości, które były Ci potrzebne ({moved} z {acted}) | "ukryłoby to" has no clear subject; the card calls the feature "automat". |
| trust_paused_corrections | Wstrzymano: w ciągu 7 dni poprawiono 2 z jego przeniesień | Wstrzymano: w ciągu 7 dni poprawiono 2 przeniesienia automatu | "jego" is a calque of "its" and has no antecedent in the line. Count "2" and "7 dni" kept. |
| trust_paused_important_hidden | Wstrzymano: przeniósł wiadomość, która była Ci potrzebna | Wstrzymano: automat przeniósł wiadomość, która była Ci potrzebna | The verb had no subject. |
| trust_paused_evidence_changed | Wstrzymano: nowe wyniki testów już go nie uzasadniają | Wstrzymano: nowe wyniki testów już nie przemawiają za automatem | "go" has no antecedent in the card line (the Telegram notice has one: "Automatyczne przenoszenie … zostało wstrzymane"). |
| trust_paused_history_fail | Wstrzymano: sprawdzenie ostatnich 30 dni wykryło wiadomości, które były Ci potrzebne | Wstrzymano: sprawdzenie poczty z ostatnich 30 dni wykryło wiadomości, które były Ci potrzebne | "sprawdzenie ostatnich 30 dni" is incomplete; the notice and the report say "poczty z ostatnich 30 dni". |
| rep_read_only | Sprawdzanie przeczytało wiadomości z ostatnich 30 dni w folderze INBOX, tylko do odczytu. Niczego nie zmieniło. | Podczas sprawdzania asystent tylko odczytał wiadomości z ostatnich 30 dni w folderze INBOX. Niczego nie zmienił. | A process noun ("Sprawdzanie") as the one who reads is unnatural; ", tylko do odczytu" was a tacked-on calque of "read-only". |
| rep_progress | Sprawdzam ostatnie 30 dni… ({checked} z najwyżej {max} wiadomości) | Sprawdzam pocztę z ostatnich 30 dni… ({checked} z najwyżej {max} wiadomości) | One checks mail, not days; matches ob_report_open. First person kept. |
| rep_nothing | Na razie nic nie jest zalecane. Powody są w liniach powyżej. | Na razie nic nie jest zalecane. Powody znajdziesz w wierszach powyżej. | "linia" for a text line is a calque; the panel says "wiersz" (anyway_text_quiet). |
| rep_review_suggest | Chcesz sam sprawdzić 10 decyzji? To nieobowiązkowe. | Chcesz samodzielnie sprawdzić 10 decyzji? To nieobowiązkowe. | "sam" assumes a man; "samodzielnie" has no gender. |
| rs_form_title | Wypełnij styl pisania z krótkiego formularza | Ustaw styl pisania w krótkim formularzu | "wypełnić coś z formularza" is a calque of "fill in from a form". |
| rs_apply_help | Zastosuj zastępuje styl pisania powyżej. Nic nie zostanie zapisane, dopóki nie wybierzesz Zapisz. | Przycisk „Zastosuj” zastępuje styl pisania powyżej. Nic nie zostanie zapisane, dopóki nie wybierzesz „Zapisz”. | A bare button name as a subject and as an object does not read as Polish; the panel quotes UI names with „” (lset_needs_sent). |
| rs_saved_toast | Nazwa, podpis i styl pisania zapisane. | Zapisano nazwę, podpis i styl pisania. | Panel toasts use "Zapisano …" (lset_wait_toast). |
| rs_preview_help | Podgląd pisze odpowiedź na stałą przykładową wiadomość z wartościami z pól powyżej, także z tymi, których nie zapisano. | Podgląd tworzy odpowiedź na stałą przykładową wiadomość. Używa wartości z pól powyżej, także tych, których nie zapisano. | "wiadomość z wartościami" read as if the sample mail held the values; two sentences remove the ambiguity. |
| rs_preview_busy | Podgląd tej skrzynki już trwa. Poczekaj na jego koniec. | Podgląd tej skrzynki już trwa. Poczekaj, aż się zakończy. | "Poczekaj na jego koniec" is stiff. |

Pins updated: `apps/web/src/i18n/reply-style.test.ts` PL_TEXTS (rs_form_title, rs_apply_help, rs_saved_toast, rs_preview_help,
rs_preview_busy). No other test or e2e spec pins these Polish texts (grep of the three specs, trust-card.test.tsx, report-view.test.tsx).

## Judged correct and left

- trust_proof_none, trust_proof_no_go_plain, trust_mail_pass, trust_mail_few, trust_mail_unchecked, trust_mail_unclear,
  trust_paused_model_switch, trust_paused_other, trust_block_* (6), trust_report_link.
- title_report, rep_off, rep_no_mailbox, rep_load_error, rep_intro, rep_starting, rep_checked, rep_capped, rep_counts
  ("Zostałyby przeniesione" kept), rep_auto_on, rep_recommended, rep_not_recommended (one word "niezalecane" is correct),
  rep_turn_on, rep_turned_on, rep_mode_assist, rep_mode_shadow, rep_all_on, rep_owner_only, rep_check_again,
  rep_check_started, rep_check_running, rep_review_link, rep_nr_* (7).
- ob_channel_title, ob_channel_mail, ob_report_title ("Zobacz, co bym zrobił": first person as in the English),
  ob_report_wait, ob_report_open (third person as in the English), ob_report_done, ob_report_link.
- switch_reply_drafts, sig_title, rs_switch_oauth, rs_title, rs_help, rs_name_label, rs_signature_label, rs_style_label,
  rs_in_use, rs_style_help, rs_form_address, rs_address_* (3, gender agrees with "forma"), rs_form_greeting,
  rs_form_sign_off, rs_form_length, rs_length_* (2, agree with "długość"), rs_apply, rs_err_* (3), rs_preview,
  rs_preview_title, rs_preview_note, rs_preview_llm_off, rs_preview_failed, rs_org_note, rs_org_old, rs_org_link.
- styleFromForm Polish sentences (all 7): no change. They are instructions to the model in the imperative, which is correct.

## Left, not sure a change is better

- trust_anyway_intro "Automat odrzucono z tych powodów:": correct grammar, but "odrzucono" sounds as if a person refused it.
  An alternative is "Automat nie przeszedł sprawdzenia z tych powodów:". Left, because the dialog lists also non-check reasons.
- rs_switch_help "Przygotowuje szkic odpowiedzi na pocztę, która wymaga Twojej odpowiedzi.": "odpowiedzi" twice. Left,
  because "wymaga odpowiedzi" is the name of the category and ties the switch to it.
- rs_preview_cap and rs_preview_limit "Spróbuj jutro." vs rs_preview_failed "Spróbuj ponownie.": both natural; left.
- styleFromForm formal: "per Pan lub Pani": dictionaries write "per pan"; capitals are usual in letters. Left.
- rs_preview "Podgląd" (a button) and "tryb podglądu" (shadow mode) share a word. In the style card the context is clear. Left.
- Panel "Zalecane"/"Włącz zalecane" vs Telegram notice "Polecane do włączenia" (packages/core/src/texts/notices.ts): out of
  scope here; a later review can align the notice.

## Found, outside the scope (logic, not text)

- `formatPercent` (apps/web/src/lib/gate-text.ts) prints a decimal point ("99.1"). Polish uses a comma ("99,1"). This affects
  trust_proof_* and the older gate_* texts. A fix needs locale-aware formatting, which is a logic change.
