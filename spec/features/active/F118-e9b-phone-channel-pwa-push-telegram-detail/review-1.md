# F118 stage 01 review (Opus 5.5, PASS 5cafe6d6)

Model: Opus 5.5 (crypto plus server request to a browser-chosen address). No BLOCKING. RFC 8291 vector matches byte for byte, independent WebCrypto decrypt 35/35, 38 mutations (35 killed), 86 sender probes, 35 endpoint refusals, redirects not followed, no cookies, no key text in any log or error, no new dependency, no real push service called. `test:int:ci` not run by the reviewer (no DB; stage touches none).

Fixed in a small repair (no re-review, mechanical): N1 (`push:keys` must print the three env lines WITHOUT the `[push-keys] ` prefix: Bun's .env loader drops a prefixed line and Web Push stays silently off; the explanatory text may keep the prefix), TG1 (a test that forces a short private scalar (31 and 30 bytes) and checks the 32-byte padding in `generateVapidKeyPair`; mutation M35), TG2 (a test with a large or endless 201 body that proves the body is cancelled and not read; mutation M38).

Carry-over:
- Stage 03: N4 (`decodeBase64Url` refuses padded base64url; browsers send unpadded; the device API must not add padding and must not strip it silently without a test).
- Stage 08: N2 (Bun's global `fetch` honours `HTTPS_PROXY`; the production fetch is wired in stage 08: decide there whether to pin or ignore the proxy and write the decision down), N3 (push host DNS is not pinned; accepted by plan D19/Q6), N5 (400/401/403/413 map to `refused`, so a rejected VAPID key never deletes devices: keep), N6 (comment "Never throws" is wrong for non-validated errors: fix the comment when touching the file).
- TG3 (`uaPublic[0] !== 0x04` check is defence in depth): accepted.
