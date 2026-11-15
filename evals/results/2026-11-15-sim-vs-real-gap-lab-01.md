# Sim vs real gap

- measure: final category, no threshold (both sides)
- sim: lab-01 v1 (holdout), 2026-11-14, prompt classifier-v2, model gpt-6-luna
- real: 138 labelled mails, 2026-11-15
- verdict "gap": the two 95 % Wilson precision intervals do not overlap; "too few real labels": real tp + fp < 30

| category | sim precision | sim interval | sim recall | real precision | real interval | real recall | real n (tp + fp) | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| notification | 99.6% | [0.9760, 0.9992] | 98.7% | 96.3% | [0.8746, 0.9898] | 82.5% | 54 | no gap |
| spam | 85.0% | [0.8033, 0.8877] | 99.6% | 85.9% | [0.7649, 0.9194] | 91.8% | 78 | no gap |
