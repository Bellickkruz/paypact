# PayPact

Escrowed invoice links on NEAR. A freelancer sends a link; the client pays with the crypto they already hold (on mainnet, any coin on any chain through NEAR Intents) without creating an account; a smart contract holds the money until the client approves the work, and refunds it if nothing is delivered. Bigger jobs can be split into milestones or equal batches: the client pays once, and each part is released when it is approved.

- **Live demo (NEAR testnet):** https://paypact-alpha.vercel.app
- **Contract:** [`pact2.paypact-dev-mwaweex6.testnet`](https://testnet.nearblocks.io/address/pact2.paypact-dev-mwaweex6.testnet) (Rust, near-sdk 5)
- **Tracks:** `realworld` (invoicing and stablecoin rails), `security` (AI assistant on a function-call key that cannot move money)
- **Other project by the same author:** [Market Radar](https://github.com/Bellickkruz/market-radar) ([live](https://market-radar-taupe.vercel.app)), an independent prediction-market finder with its own NEAR contract (see [Disclosure](#disclosure))

## The problem

Freelancers working across borders with clients they don't know have two bad options. Ask for payment up front and the client takes all the risk; start work first and the freelancer does. Platforms that hold money in escrow charge 10 to 20% and require both sides to sign up. Paying in crypto avoids those fees but adds new friction: the client must hold the right token on the right chain, and a payment can't be pulled back if the work never arrives.

## What PayPact does

1. The freelancer creates an invoice (amount in USD stablecoin, job title, due date, optional up-front percentage, review window, optional referee) and shares the link on WhatsApp, Telegram or X. Creating it is free: the freelancer signs a message and PayPact pays the network fee. For bigger jobs, the freelancer chooses a payment plan:
   - **Milestones:** 2 to 12 steps, each with its own name, amount and due date (for example design, build, launch).
   - **Equal batches:** a total split into equal parts spread over a period. For example, $1,000 for 4 posts over a month becomes 4 × $250, due weekly.
2. The client opens the link, sees the freelancer's on-chain track record and exactly what is paid now and what is held, and pays. No account or wallet is needed: the browser makes a private key that becomes the client's identity for this invoice.
3. The money is locked in the contract. Any agreed up-front share goes to the freelancer immediately. A project is paid **once**, in full, and every milestone is locked from that moment.
4. The freelancer marks the work delivered and attaches a link and note. Both are recorded on-chain with the delivery time.
5. The client approves and the freelancer is paid in seconds, or reports a problem, which freezes the money. A frozen invoice ends in an agreed split, a referee's decision, or a 50/50 split after a timeout. If the client stays silent, the money is released when the review window ends. If nothing is delivered by the due date (plus 2 days' grace), the client can take a refund.
6. The client rates the freelancer. Only a client who paid can rate, once (once per project, on its last milestone), and each rating is shown with the size of the job it came from.

In a project, steps 4 and 5 happen **per milestone**. Each milestone is delivered with its own proof and approved on its own, and only its share is released. A milestone that is not delivered by its own due date can be refunded on its own while the others continue.

## Try it in 2 minutes (no wallet needed)

All steps run on NEAR testnet with free test dollars (`tUSDC`). Timings are from runs against the live site.

| # | Do | See |
|---|----|-----|
| 0 | Open https://paypact-alpha.vercel.app. | The home page is the product. Example sentences type themselves into the composer, and a **3D invoice builds live beside them** (client, job, amount, due date, up-front split), stamped *Locked in escrow · NEAR* once there's an amount. Below it, **Live on NEAR testnet** reads the contract directly: money locked now, paid out, invoices created, and recent payments. Under that, a **What happens if…** table lists every outcome and what enforces it. |
| 1 | Tap **"▶ Try it as a client"** (under the composer). | An invoice from "Demo Designer" (a freelancer account PayPact plays for the demo), with an orange guide box: *Demo · step 1 of 4*. If the invoice has an up-front share, a box under the total shows what goes to the freelancer immediately and what is held. |
| 2 | Look at the **"On mainnet, pay with any crypto"** box. | Live NEAR Intents quotes for this invoice in USDC (Base, Solana), USDT (Tron), ETH, SOL and BTC, fees included, refreshed every 30 s. These are real `dry` quotes from the 1Click API; payment itself needs mainnet (see [Testnet and mainnet](#testnet-and-mainnet)). |
| 3 | Tap **"Pay $… (test money)"**. | About 5 s later: status *🔒 Paid & locked*, and an orange **"🔑 Save your control link"** box. |
| 4 | Tap **"Demo Designer delivers the work"**. | A **📦 Proof of delivery** box with the delivery time, an *On time* badge, the freelancer's note and a **View the delivered work ↗** link. |
| 5 | Tap **"Approve & release $…"**. | About 4 s later: *✅ Paid out*, and a rating form. |
| 6 | Pick stars, write a comment, tap **"Post rating"**. | *Step 4 of 4* is complete. Tap **"See Demo Designer's profile"**: the rating is listed with a *✓ Paid $… job* badge. |
| 7 | Back on the invoice, tap **"🧾 Receipt (PDF)"**, then **"Download PDF / Print"**. | A receipt with the amounts, dates, proof of delivery and contract address. |
| 8 | On any invoice, change the **🌐** menu to *Français*, *Español*, *Português*, *Deutsch* or *中文*. | The client side of the page (terms, amounts, buttons, dates) switches language. It opens in the browser's language by default. |
| 9 | Back on the home page, tap **"▶ Try a 4-post project paid in batches"**. | A $1,000 project with 4 milestones ("Post 1 of 4" … "Post 4 of 4", $250 each, due weekly), shown as a timeline. Pay once ($1,000). Then, for each post, tap **"Demo Designer delivers Post N of 4"** and **"Approve & release $250.00"**. **See:** a progress bar going from *$250 paid out · $750 locked* to *$1,000 paid out · $0 locked*, each milestone turning *✅ Paid out* with its proof. The project takes about 60 s. |
| 10 | Run `node scripts/check-invoice.mjs <number>` with the invoice number (Node 18+, no install). | The same invoice read straight from the contract: status, amounts, timestamps, proof link, rating, the client's public key and the freelancer's profile. |

### As a freelancer (needs a NEAR testnet wallet)

1. Have a NEAR testnet account in a wallet offered by the **Sign in** dialog (for example MyNearWallet at testnet.mynearwallet.com). PayPact itself needs **no NEAR** from it.
2. Tap **Sign in**, then **Create a free invoice**. Type a sentence such as *"Bill Sarah $300 for the logo by Friday, half upfront"* and tap the fill button: amount, title, due date and up-front share are filled in.
3. Tap create and sign the message in the wallet. **See:** a share screen with the link, a QR code and WhatsApp/Telegram/X buttons. Your account's NEAR balance is unchanged: the relayer paid the fee.
4. Open the link in a private window and pay as the client. Back in your window: *🔒 $… is locked for you*, with calendar buttons for the due date.
5. Add a link and a note, tap **"I've delivered the work"**, and sign. **See:** status *Delivered, in review*, with polite nudge messages to send to the client.
6. After the client approves: *🎉 You've been paid*, a share button, and **"➕ Send the next stage to this client"**, which opens a new invoice pre-filled from this one.
7. To try a project, choose **Equal batches** (for example total $1,000, 4 parts, over 1 month, each part a "Post") or **Milestones** (your own steps) on the create screen. **See:** a preview of every part with its amount and due date before you create it.

## How it works

```
 Freelancer (NEAR wallet)          Client (browser, no account)
        |  signs NEP-413 message          |  browser-generated ed25519 key
        v                                 v
  /api/relay (Vercel) ---- pays gas ----> PayPact contract (Rust) <---- ft_transfer_call
   verifies signatures                    holds the stablecoin           from NEAR Intents (mainnet)
   cannot move funds                      enforces every rule            or the test token (testnet)
```

**Contract** (`contract/src/lib.rs`)
- Invoice statuses: `AwaitingPayment → Funded → Delivered → Released`, plus `Disputed`, `Split`, `Refunded`, `Cancelled`.
- **Projects:** `create_project(title, milestones[{title, amount, due_in_days}], …)` creates 2–12 milestone invoices with consecutive ids, linked by `project`. One `ft_transfer_call` of the total to the first milestone funds them all. Each milestone then follows the normal lifecycle. A cancel cancels the whole project. A refund account applies to every milestone. A rating is allowed once, on the last milestone. `get_project(id)` returns the milestones in order.
- **Payment:** `ft_on_transfer` (NEP-141). The `msg` carries `{invoice_id, client_key, refund_to?}`. A wrong token, wrong amount or bad message is refunded in full. Any up-front share is paid out immediately.
- **Client actions** (`client_action`): approve, dispute, propose or accept a split, refund if undelivered, set a refund account, rate. Each is a message signed by the client's key over `{contract}|invoice:{id}|nonce:{n}|{action}`. The nonce makes every signature single-use, and anyone may submit it.
- **Freelancer actions:** `create_invoice`, `mark_delivered(link, note)`, `cancel_invoice`, `propose_split`, `accept_split`, `refund_client`.
- **Gasless variants:** `create_invoice_for` and `mark_delivered_for`, callable only by the relayer.
- **Timeouts:** anyone can call `release_after_review` once the review window has passed, and `resolve_stale_dispute` (50/50) once the dispute timeout has passed. `arbiter_resolve` is for the named referee.
- **Failed payouts** are kept as `owed_*` and can be retried with `retry_payout`.
- **Profiles** (`get_profile`) count deliveries (each milestone counts as one), earnings, on-time deliveries and disputes, and are only updated by real invoices.

**Who can do what**

| Actor | Can | Cannot |
|---|---|---|
| Freelancer (full-access key) | create, cancel, mark delivered, propose/accept split, refund the client | take held money without the client's approval or the timeout |
| Freelancer's AI assistant (function-call key, `create_invoice` and `mark_delivered` only) | draft invoices, mark work delivered | anything that moves money: those methods require 1 yoctoNEAR, and NEAR does not let function-call keys attach a deposit |
| Client (key made in the browser at payment) | approve, dispute, split, take an undelivered refund, rate | act on any other invoice; reuse a signature |
| Relayer (`/api/relay`) | pay gas; submit signed client actions; create or deliver for a freelancer who signed a NEP-413 message with a full-access key | forge a client signature (checked by the contract); move money (no money method accepts it) |
| Anyone | release after the review window; resolve a stale dispute 50/50 | anything else |

**Web app** (`web/`): Vite, React and TypeScript, hosted on Vercel.
- Wallets via `@hot-labs/near-connect`.
- Reads go through FastNEAR RPC.
- `api/relay.ts` verifies every signature before spending gas: ed25519 for client actions; NEP-413 plus a full-access key check for freelancers.
- On mainnet, `src/lib/intents.ts` asks the NEAR Intents 1Click API for a deposit address. It uses `EXACT_OUTPUT` for the invoice amount, the contract as recipient, and `customRecipientMsg` so the swap ends in `ft_transfer_call`. It then polls `/v0/status`.

**NEAR features used:**
- NEAR Intents (1Click API)
- NEP-141 `ft_transfer_call`
- function-call access keys as an on-chain spending limit for the AI assistant
- NEP-413 signed messages for gasless freelancer actions
- named sub-accounts

## Testnet and mainnet

| | Testnet (this submission) | Mainnet |
|---|---|---|
| Contract, escrow, disputes, ratings, profiles, gasless freelancer, AI key, proof of delivery, receipts, languages | live and tested | same code; not deployed yet |
| Client payment | free test token (`tUSDC`, mints on demand) through the relay's `demo_pay` | any coin on any supported chain through NEAR Intents 1Click into native USDC; code path in `AnyChainPay` |
| Any-crypto prices | live NEAR Intents `dry` quotes shown on every unpaid invoice | the same quotes, plus a real deposit address |
| "Try it as a client" demo freelancer | on (`demo-designer.paypact-dev-mwaweex6.testnet`) | off |

NEAR Intents has no testnet (hackathon FAQ Q-007), so the full any-crypto payment was not run end to end for this submission. The 1Click quote, deposit-address and status calls were exercised against mainnet. Delivery into the contract depends on `customRecipientMsg`, which 1Click documents as experimental.

## Run it yourself

Requirements: Rust with the `wasm32-unknown-unknown` target, [cargo-near](https://github.com/near/cargo-near) 0.23 and Node 20 or newer.

```bash
# 1. Contract: 43 unit tests (happy path, rejections, replay, timeouts, disputes,
#    arbiter, up-front payments, ratings, relayer limits, AI-key deposit refusal,
#    projects: one payment funds all milestones, release one by one, per-milestone refund)
cd contract && cargo test
cargo near build non-reproducible-wasm        # -> target/near/invoice_escrow.wasm

# 2. Whole flow on testnet with your own fresh contract and token
cd ../test-token && cargo near build non-reproducible-wasm
cd ../scripts && npm install
node e2e-testnet.mjs <path-to-key.json>       # {"account_id":"you.testnet","private_key":"ed25519:..."}
# Deploys the token and escrow under your account, then: create invoice -> pay ->
# AI key tries to take money (rejected by the network) -> AI key marks delivered ->
# client approves with a signed message -> freelancer paid.

# 3. Web app against the deployed testnet contract
cd ../web && npm install
cp .env.example .env.local                   # set RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY
npm run dev                                  # http://localhost:5173 (serves /api/relay too)
```

The relayer is any testnet account with a few NEAR. To make it the relayer of your own deployment, call `set_relayer` from the owner account with 1 yoctoNEAR attached.

## Repository layout

```
contract/            PayPact escrow contract (Rust); tests in src/tests.rs
test-token/          NEP-141 test stablecoin for testnet (public mint)
scripts/             e2e-testnet.mjs (full flow), check-invoice.mjs (read an invoice)
web/src/pages/       Home, NewInvoice, InvoicePage, ProfilePage, Dashboard, ReceiptPage
web/src/lib/         near.ts (reads), wallet.ts, clientKey.ts, intents.ts, relay.ts, i18n.ts, ...
web/api/relay.ts     gas relayer: client actions, gasless freelancer actions, testnet demo
web/public/          favicon, sample delivery page used by the demo
```

## Known limitations

- **The client's key lives in the browser.** If it is lost, the client can no longer approve or dispute, though the freelancer is still paid when the review window ends. The app prompts the client to send their private control link to themselves until they do.
- **The relayer is a single hosted service.** It can't move money, but if it is down, clients without a NEAR wallet can't submit actions. Signed actions are plain function calls, so anyone with a NEAR account can submit them.
- **Up-front money is not protected.** The up-front share goes straight to the freelancer by design, and the page states this before payment.
- **Ratings can be bought with real payments.** A freelancer could pay their own invoices. Every rating shows the job size, so this costs real money and is visible.
- **50/50 split after the dispute timeout.** When no referee is named, the split is mechanical, not a judgement.

## Roadmap

- Deploy on mainnet with a revenue fee on any-crypto payments, collected by NEAR Intents `appFees`. This is already wired behind `VITE_APP_FEE_RECIPIENT`; the freelancer still receives the exact invoice amount.
- An AI job checklist written from the freelancer's chat with the client and agreed before payment, and an AI-suggested fair split in disputes. The AI suggests; both parties accept with their own keys.
- PayPact for Teams: budgets that an AI agent spends within on-chain limits.

## Disclosure

- **Built during the hackathon.** All code in this repository was written from 2026-11-10, in the commits listed in `git log`. No pre-hackathon code is reused.
- **Second project.** The author also submits **Market Radar** (https://github.com/Bellickkruz/market-radar, live at https://market-radar-taupe.vercel.app). It finds the best odds across prediction markets, funds them through NEAR Intents, and runs its own Radar Pools contract on NEAR testnet. The two projects are independent, with separate contracts, accounts and deployments.
- **AI assistance.** The code was written with Claude Code (Anthropic) as a pair programmer, under the author's direction. The author reviewed and tested every change on testnet.
- **Third-party libraries:**
  - Contract: `near-sdk` 5.30; tests use `ed25519-dalek` and `rand`.
  - Web: `react` 19, `vite` 8, `near-api-js` 7, `@hot-labs/near-connect`, `@noble/curves`, `bs58`, `qrcode`.
  - External services: NEAR Intents 1Click API, FastNEAR RPC, Vercel hosting.

## License

MIT, see [LICENSE](LICENSE).
