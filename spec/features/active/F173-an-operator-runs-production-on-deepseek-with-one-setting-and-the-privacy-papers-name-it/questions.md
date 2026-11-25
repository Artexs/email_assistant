# F173 questions (defaults taken, owner to confirm)

1. [important: user-visible] The privacy page names all possible AI providers ("OpenAI, DeepSeek or Google Gemini", with the "Used when" column), not "This install uses DeepSeek". Reason: the VPS switches later, and only when the classifier passes its gate. Alternative: name DeepSeek as the install's provider in the release that switches the VPS. (P2)
2. [important: privacy] The papers do not say whether DeepSeek trains on or keeps API data. They hold a visible placeholder until the owner reads the DeepSeek terms (owner step O1). The DeepSeek pages read on 2026-11-26 state storage in China and no API data-use rule. (P4)
3. [important: privacy] Location "People's Republic of China", as the DeepSeek privacy policy lists it (the ticket default for the region answer). (P3)
4. [important: privacy] The DPIA gets a new risk R11 for the transfer to China (medium, high), and R1 covers only OpenAI and Gemini. (P5)
5. [important: user-visible] Every member accepts the terms again at the next sign-in on the release that carries stage 01. (P7)
6. [important: money] The gate runs spend at most $8 on the DeepSeek key: `--budget-usd 2` per run, one rerun at 4. (P10)
7. [important: production] A failed gate changes no code: classifier fail keeps the VPS on OpenAI; drafter fail keeps `reply_drafts` off; extractor fail keeps `open_loops` off; `style_from_sent` stays off. (P9)
8. [minor] The drafter gate run uses the tool's default judge (DeepSeek strong tier), not the OpenAI judge of the earlier gate files. (P8)
9. [important: rule-exception] `spec/vision.md` says "EU location before any outside user's mail". DeepSeek processes in China. Default: the plan follows the owner decision of 2026-11-26 for the home VPS (owner and test organizations only) and adds no block; the vision rule still applies before any outside user's mail reaches DeepSeek. The owner may want to amend the vision line.
