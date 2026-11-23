# F169 questions for the owner

None blocks a stage. Each has a default that the plan uses.

- **Q1 [minor] Remove a sender rule: Undo or a question first?** The ticket allows either. Today a remove deletes at once with no Undo and no question. Default (plan D17, stage 07): delete at once, as today, and the toast offers Undo for 10 s; Undo adds the same rule again. Reason: the product promises Undo for changes, and a question slows the common case. Undo: change stage 07 to a confirm dialog before the delete.
- **Q2 [minor] Polish wording of the rule sentence.** Default (stage 06): "Nadawcę {pattern} traktuj {scope} zawsze jako {kind}", with "VIP", "zaufanego", "zablokowanego" and "we wszystkich skrzynkach", "w skrzynce {address}". A native speaker may prefer other words; a change is a text edit in `pl-settings.ts`, the order rule stays.
- **Q3 [minor] Column counts.** Default (D5): a column shows the count of the rows it loaded, with `+` while more pages exist. The API has no total per status; a true total is a later API ticket.
