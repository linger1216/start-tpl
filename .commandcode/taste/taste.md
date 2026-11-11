# Taste
See [taste/taste.md](taste/taste.md)

- For code-review requests, use the user's locally installed `ocr` (OpenCodeReview) CLI as the review tool (e.g. `ocr review --audience agent --effort high --background "<context of the change>"`), not only built-in review agents. Confidence: 0.6
- For temporary/emergency features, pick the simplest sufficient mechanism and skip elaborate configuration machinery — e.g. external share-token guests simply get admin-level data access instead of a per-token permission-config UI (「这里只是临时应急, 不是业务常态」). Confidence: 0.7
