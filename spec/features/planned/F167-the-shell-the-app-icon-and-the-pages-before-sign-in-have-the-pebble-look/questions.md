# F167 questions for the owner

Each item is a default that the plan took. No item changes the stages. The decision ids are in [`plan.md`](plan.md) § Input.

1. **[important: user-visible] The login brand panel texts (D11).** Default: en "Your mail, sorted. You decide what goes out." / "The assistant sorts your mail and writes drafts. Nothing is sent until you approve it."; pl "Twoja poczta, uporządkowana. Ty decydujesz, co wychodzi." / "Asystent porządkuje pocztę i przygotowuje szkice. Nic nie wychodzi, dopóki tego nie zatwierdzisz." Claim source: `docs/legal/claims.md` C047. Rejected: the mockup's "Your inbox, already sorted." (not true in shadow mode) and its stacked fake mail cards (fake data, PB-7). Undo: change the two keys.
2. **[important: user-visible] The browser colour (D6).** Default: `theme-color` teal `#0a7568` in the light scheme, the dark background `#0d1513` in the dark scheme; manifest `theme_color` teal, `background_color` `#f3f6f5`. Other option: teal in both schemes (a bright mint bar `#3fd1b9` over a dark page). Undo: two meta values.
3. **[minor] No "You stay in charge" card in the sidebar (D8).** The mockup card is new promise text ("Every move has an Undo for 7 days") that no claim row backs. Default: the sidebar foot shows the help link and the user menu only.
4. **[minor] The phone header keeps the menu button, not the mockup's avatar (D1).** The menu holds the pages that do not fit in the tab bar; an avatar would hide them behind a person icon.
5. **[minor] The setup page from an invite gets the same split frame as login (D10).** The forgot-password page stays a single card.
6. **[minor] A new 180 px `apple-touch-icon.png` with a full teal square (D5).** Today iOS takes the 192 px icon and paints its transparent corners black.
7. **[minor] The signed-in `main` has no max width (D7).** Each page sets the width of its own content. The page tickets (approvals, delegations, onboarding and settings) plan in parallel and need to know this.
