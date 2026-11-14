---
title: "Stage 2 epics: what is done, what waits, what opens what"
chrome: title
width: wide
---

[Five of the 28 Stage 2 epics are closed](#status-f095-close-the-mvp) and two more are built and deployed. Most of the rest wait for four epics: the [offline lab](#f097), [Astro 7](#f101), [act from the panel](#f102) and [read sent](#f104). One owner decision opens the biggest group: [spend about $0.40 on the first lab report](#spend).

## The chain that holds the others

```figure
id: flow
layout: flow
grid: [5, 3]
nodes:
  spend: { label: "Owner OK: $0.40", at: [0, 0], kind: actor, focal: true, about: "F097 stage 21 runs real Gemini calls. The plan caps each run at $1 and expects about $0.40 in total. A real-money step stops the coordinator until you agree." }
  f097:  { label: "F097 Offline lab", at: [1, 0], sub: "20 of 22 stages", about: "Stage 21 is the first report with real calls, stage 22 is the gap report. When both land, the lab epic is closed and seven epics can be planned." }
  f101:  { label: "F101 Astro 7", at: [0, 1], sub: "plan refresh running", about: "Moves the panel to Astro 7. Four stages. Act-from-the-panel and the docs site both need it." }
  f102:  { label: "F102 Act from panel", at: [1, 1], sub: "about 20 stages", about: "Lets the user act on mail from the panel. It is on hold until Astro 7 lands. Earn-trust, reply drafts and open loops all need it." }
  f110:  { label: "F110 Earn trust", at: [2, 1], sub: "about 25 stages", about: "Needs act-from-the-panel and the lab. Phone channel, sender context and public pages need it." }
  f104:  { label: "F104 Read sent", at: [1, 2], sub: "12 stages", about: "Refresh running. Reads the Sent folder. Reply drafts, open loops, sender context and style learning need it." }
  f115:  { label: "F115 Reply drafts", at: [3, 2], sub: "about 17 stages", about: "Needs the lab, act-from-the-panel and read sent. Style learning needs it too." }
  f118:  { label: "F118 Phone channel", at: [3, 1], sub: "about 14 stages", about: "Needs act-from-the-panel and earn-trust. It adds the phone app view and push." }
edges:
  - spend -> f097
  - f097 -> f110
  - f101 -> f102
  - f102 -> f110
  - f110 -> f118
  - f102 -> f115
  - f104 -> f115
  - f097 -> f115
caveat: Only the longest chain is drawn. Each card on the last board names what it needs.
```

## The 13 epics that are closed, live or have a plan

[F105](#status-f105-identity-a-two-factor) and [F106](#status-f106-account-data) are built and live on the VPS. They close after [24 hours of watch](#status-f106-account-data). [F119](#status-f119-identity-b-company-sign-in) is in build, not closed.

```kanban
id: status
columns:
  - { label: Closed, about: "Landed and moved to done." }
  - { label: Deployed, about: "All stages landed and deployed. Waiting 24 hours of watch before the close." }
  - { label: In build, about: "A worker or a review is running on a stage." }
  - { label: Plan ready, about: "The plan exists. A refresh or a needed epic comes first." }
cards:
  - { label: "F095 Close the MVP", column: Closed, tags: [E1], about: "10 of 10 stages. Closed on 15 Nov." }
  - { label: "F096 Log rotation", column: Closed, tags: [E8], about: "1 of 1." }
  - { label: "F098 Polish UI", column: Closed, tags: [E7], about: "13 of 13." }
  - { label: "F099 Platform controls", column: Closed, tags: [E7], about: "15 of 15." }
  - { label: "F100 Measure", column: Closed, tags: [E3], about: "19 of 19. Its flags and first weekly report wait for the F105 deploy step." }
  - { label: "F105 Identity A (two-factor)", column: Deployed, tags: [E7], about: "15 of 15. Live on the VPS. Your phone step U1 is open." }
  - { label: "F106 Account data", column: Deployed, tags: [E7], about: "12 of 12. Live on the VPS." }
  - { label: "F097 Offline lab", column: In build, tags: [E2], about: "20 of 22 stages. Stage 21 waits for the spend OK." }
  - { label: "F119 Identity B (company sign-in)", column: In build, tags: [E7], about: "3 of 16 stages. Stage 04 is running." }
  - { label: "F101 Panel to Astro 7", column: Plan ready, tags: [E10], about: "0 of 4. Plan refresh running." }
  - { label: "F103 Logs", column: Plan ready, tags: [E8], about: "0 of 19. Plan refresh running." }
  - { label: "F104 Read Sent", column: Plan ready, tags: [E5], about: "0 of 12. Plan refresh running." }
  - { label: "F107 Papers and cost", column: Plan ready, tags: [E7], about: "0 of 8. Builds after F106 closes." }
```

## When each waiting epic can start

The order rule says: plan a ticket only after the tickets it needs have landed, then build, then plan the next one. The planner limit is three at once. Builders have no limit, but stages of one ticket run in order, and only one migration or `bun.lock` change runs at a time.

```kanban
id: waves
columns:
  - { label: Now, about: "No open need. A planner or builder can start when a slot is free." }
  - { label: After the lab closes, about: "Needs F097, which waits for the spend OK and two more stages." }
  - { label: After Astro 7, about: "Needs F101: four stages after its refresh." }
  - { label: "After logs, panel actions and read sent", about: "Needs F103, F102 or F104 to land first. F102 needs F101, and F103 and F104 need their builds." }
  - { label: Last, about: "Needs trust, live lab, papers or alerts first." }
cards:
  - { label: "F117 Mailbox OAuth", column: Now, tags: [plan], about: "Plan can start as soon as a planner slot is free. Three planners run now (F101, F103, F104 refresh)." }
  - { label: "F107 Papers and cost", column: Now, tags: [build], blocked: "after F106 closes, about 20:40 UTC on 15 Nov", about: "Plan is ready." }
  - { label: "F101 / F103 / F104 builds", column: Now, tags: [build], blocked: "after their plan refresh", about: "Refresh jobs are running." }
  - { label: "F109 Improve", column: After the lab closes, tags: [plan], about: "Needs F097 only." }
  - { label: "F111 Private model option", column: After the lab closes, tags: [plan], about: "Needs F097 only." }
  - { label: "F113 Live lab", column: After the lab closes, tags: [plan], about: "Needs F097 only." }
  - { label: "F102 Act from the panel", column: After Astro 7, tags: [plan], about: "Needs F101." }
  - { label: "F112 Docs site", column: After Astro 7, tags: [plan], about: "Needs F101." }
  - { label: "F114 Alerts and releases", column: "After logs, panel actions and read sent", tags: [plan], about: "Needs F103 (logs) to land." }
  - { label: "F110 Earn trust", column: "After logs, panel actions and read sent", tags: [plan], about: "Needs F102 and F097." }
  - { label: "F115 Reply drafts", column: "After logs, panel actions and read sent", tags: [plan], about: "Needs F097, F102, F104." }
  - { label: "F116 Open loops", column: "After logs, panel actions and read sent", tags: [plan], about: "Needs F097, F102, F104." }
  - { label: "F108 Production on the VPS", column: Last, tags: [plan], about: "Needs F107 and the F114 restore drill." }
  - { label: "F118 Phone channel", column: Last, tags: [plan], about: "Needs F110." }
  - { label: "F120 Sender context", column: Last, tags: [plan], about: "Needs F104 and F110." }
  - { label: "F121 Public pages and demo", column: Last, tags: [plan], about: "Needs F113, F110, F107, F114." }
  - { label: "F122 Style from Sent", column: Last, tags: [plan], about: "Needs F115." }
```
