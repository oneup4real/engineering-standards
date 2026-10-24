# Abuse cases (T3 spec section)

One row per misuse. Each row becomes a test named in the last column, written before the implementation.
Think like the attacker: every write path, every actor, every state.

| # | Actor | Abuse | Expected defence | Test name |
|---|---|---|---|---|
| 1 | anonymous | calls the action directly without a token | rejected, no data in the response | `rejects anonymous call` |
| 2 | signed-in non-staff | acts on another user's record (IDOR) | rejected after server-side ownership re-read | `denies foreign record` |
| 3 | staff | uses the edit action to skip the approval step | transition rule enforced in the service | `edit cannot bypass approval` |
| 4 | any | stores script in a free-text field | stored escaped/sanitized, rendered inert | `sanitizes stored markup` |
| 5 | any | guesses or brute-forces a short code | long random token, rate limit, no enumeration | `limits token attempts` |
| 6 | any | sends oversized or malformed input | Zod bound, clear error, no partial write | `rejects out-of-bounds input` |
| 7 | any | repeats the request (double click, retry) | idempotent, one effect | `is idempotent` |
| 8 | any | sets client-supplied role, price, owner or recipient | ignored; resolved on the server | `ignores client-supplied price` |

Delete rows that do not apply; add rows for the domain (paid/approved mismatch, expired link, cancelled booking).
