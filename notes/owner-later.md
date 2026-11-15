# Owner: things to do later

Plain list for the owner. Each item says what to do, why, and what waits for it. The coordinator adds items; the owner removes an item when it is done (or tells the coordinator).

## 1. Run the private model on your PC (F111 owner step O2)

- **Why:** stage 05 of F111 measures how well two own models (Bielik 11B and Gemma 3 12B) sort mail. It needs your GPU. Without it, the guide `docs/own-model.md` has no numbers.
- **What to do (about 15 minutes, then the agent runs about 2 hours):**
  1. In a terminal: `sudo pacman -S ollama-rocm` (the AMD GPU build of Ollama; your RX 6950 XT).
  2. Check that about 16 GB of disk are free in your home folder: `df -h ~`.
  3. Tell the coordinator: "ollama-rocm is in, run F111 stage 05".
- **Other option:** say "rent a GPU" instead. Cost: at most $5.
- **What waits:** only F111 stage 05. Everything else of F111 is built (stage 07, the EU option, waits for OpenAI's answer: a separate item).
- **Added:** 2026-11-15.
