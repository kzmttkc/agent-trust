# Facilitator gate — pre-settlement trust check

Reference adapter for x402 facilitators: one `fetch` to Vouch before you
settle, fail-closed by default.

```bash
VOUCH_API_KEY=vk_... node index.mjs 0xPayeeAddress
# exit 0 = settle, exit 1 = hold
```

Or import it:

```js
import { gateSettlement } from "./index.mjs";
const { settle, reason, score } = await gateSettlement(payee);
if (!settle) return refuse(reason);
```

Design notes:

- **Fail-closed.** If Vouch is unreachable the payment is held (`FAIL_OPEN=1`
  to invert — your risk).
- **WARN halts auto-settlement.** Route WARN to a manual queue if you have one.
- Pair with the [watchlist API](/docs/api) to be notified when a previously
  ALLOWed payee's verdict changes between settlements.

Zero dependencies, Node 18+.
