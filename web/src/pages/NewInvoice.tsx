import { useState } from "react";
import { config } from "../lib/config";
import { formatUsd, toUnits } from "../lib/money";
import { parseInvoice } from "../lib/parseInvoice";
import { signedRequest, useWallet } from "../lib/wallet";
import { assistantCall, enableAssistant, loadAssistantKey } from "../lib/assistant";
import { Busy, CopyField, Qr, ShareButtons, errText, toast } from "../ui";

const UPFRONT = [0, 30, 50, 100];
const DAY_MS = 86_400_000;

const inDays = (d: string) => Math.max(1, Math.ceil((new Date(`${d}T23:59:00`).getTime() - Date.now()) / DAY_MS));
const dateIn = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

/** Prefill from "#/new?title=…&amount=…" (used by "Send the next stage"). */
function prefill() {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const num = (k: string, d: number) => (q.has(k) && isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  return {
    title: q.get("title") ?? "",
    amount: q.get("amount") ?? "",
    upfront: UPFRONT.includes(num("upfront", 0)) ? num("upfront", 0) : 0,
    review: num("review", 5),
    arbiter: q.get("arbiter") ?? "",
    isNextStage: q.has("title"),
  };
}

export function NewInvoice() {
  const { accountId, connect } = useWallet();
  const [pre] = useState(prefill);
  const [sentence, setSentence] = useState("");
  const [client, setClient] = useState("");
  const [amount, setAmount] = useState(pre.amount);
  const [title, setTitle] = useState(pre.title);
  const [due, setDue] = useState(dateIn(7));
  const [upfront, setUpfront] = useState(pre.upfront);
  const [review, setReview] = useState(pre.review);
  const [arbiter, setArbiter] = useState(pre.arbiter);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [assistantOn, setAssistantOn] = useState(() => (accountId ? !!loadAssistantKey(accountId) : false));

  if (!accountId) {
    return (
      <main className="wrap">
        <div className="card center stack">
          <h2>Sign in to create invoices</h2>
          <p className="muted">Use any NEAR wallet: HOT, Meteor, MyNearWallet, Intear and more. It's free: you don't need any crypto to send invoices, and your client won't need a wallet.</p>
          <button className="btn big" onClick={() => connect()}>Connect wallet</button>
        </div>
      </main>
    );
  }

  const fillFromSentence = () => {
    const p = parseInvoice(sentence);
    if (p.client) setClient(p.client);
    if (p.amount) setAmount(p.amount);
    if (p.title) setTitle(p.title);
    if (p.dueInDays) setDue(dateIn(p.dueInDays));
    if (p.upfrontPercent !== undefined) setUpfront(p.upfrontPercent);
    const found = [p.client && "client", p.amount && "amount", p.title && "job", p.dueInDays && "due date"].filter(Boolean);
    toast(found.length ? `Filled in: ${found.join(", ")}` : "I couldn't read that. Try: Bill Sarah $300 for a logo by Friday");
  };

  const units = toUnits(amount);
  const valid = !!units && title.trim().length > 0 && !!due;

  const submit = async () => {
    if (!units) return;
    setBusy(true);
    setError("");
    const args = {
      token: config.token,
      amount: units,
      title: title.trim(),
      due_in_days: inDays(due),
      review_days: review,
      arbiter: arbiter.trim() || null,
      upfront_percent: upfront,
    };
    try {
      let id: unknown;
      if (assistantOn && loadAssistantKey(accountId)) {
        id = await assistantCall(accountId, "create_invoice", args);
      } else {
        // Free for the freelancer: sign a message, PayPact pays the network fee.
        id = (await signedRequest("create_invoice", args)).invoice_id;
      }
      if (!id) throw new Error("The invoice was created, but its number didn't come back. Check My invoices.");
      setCreated(String(id));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const url = `${location.origin}${location.pathname}#/i/${created}`;
    const greeting = client ? `Hi ${client}, ` : "Hi, ";
    const upfrontNote = upfront > 0 ? ` (${upfront}% up front as agreed)` : "";
    const text = `${greeting}here's my invoice for ${title.trim()}: ${formatUsd(units!)}${upfrontNote}. You can pay with any crypto you have, and your payment is held safely until you approve the work:`;
    return (
      <main className="wrap">
        <div className="card center stack">
          <div className="celebrate">🎉</div>
          <h2>Invoice #{created} is ready</h2>
          <p className="muted">Send it to {client || "your client"}. You'll see "locked for you" the moment they pay.</p>
          <div className="center"><Qr text={url} /></div>
          <ShareButtons text={text} url={url} />
          <CopyField value={url} />
          <a className="btn ghost block" href={`#/i/${created}`}>Open invoice</a>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <h2 style={{ marginTop: 12 }}>{pre.isNextStage ? "Next stage" : "New invoice"}</h2>
      {pre.isNextStage && (
        <div className="card green small">
          Copied from your last invoice: job, amount and terms. Change anything, then send it to the same client.
        </div>
      )}

      <div className="card gold">
        <label htmlFor="sentence">Describe it in one sentence</label>
        <textarea
          id="sentence"
          placeholder="Bill Sarah $300 for the logo design by Friday, half upfront"
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={fillFromSentence} disabled={!sentence.trim()}>Fill it in for me</button>
          <span className="hint">Check the details below before sending.</span>
        </div>
      </div>

      <div className="card">
        <div className="grid2">
          <div className="field">
            <label htmlFor="client">Client's name</label>
            <input id="client" placeholder="Sarah" value={client} onChange={(e) => setClient(e.target.value)} />
            <div className="hint">Only used in your message to them.</div>
          </div>
          <div className="field">
            <label htmlFor="amount">Amount (USD)</label>
            <input id="amount" inputMode="decimal" placeholder="300" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="hint">Paid to you in {config.symbol}, a dollar stablecoin.</div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="title">What's it for?</label>
          <input id="title" maxLength={140} placeholder="Logo design" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="due">Work due by</label>
            <input id="due" type="date" min={dateIn(1)} value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="review">Client review window</label>
            <select id="review" value={review} onChange={(e) => setReview(Number(e.target.value))}>
              {[2, 3, 5, 7, 14].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            <div className="hint">If they don't respond in time, you're paid automatically.</div>
          </div>
        </div>
        <div className="field">
          <label>Paid up front</label>
          <div className="chips">
            {UPFRONT.map((p) => (
              <button key={p} className={`chip ${upfront === p ? "on" : ""}`} onClick={() => setUpfront(p)}>
                {p === 0 ? "Nothing, all protected" : p === 100 ? "100%, direct payment" : `${p}%`}
              </button>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {upfront === 0 && "Everything is held safely until the client approves. Clients trust this most."}
            {upfront > 0 && upfront < 100 && units && `${formatUsd((BigInt(units) * BigInt(upfront)) / 100n, { cents: true })} reaches you the moment they pay; the rest is held until they approve.`}
            {upfront === 100 && "You're paid in full immediately; nothing is held."}
          </div>
        </div>
        <details>
          <summary>Add a referee (optional)</summary>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="arbiter">Referee's NEAR account</label>
            <input id="arbiter" placeholder="trusted-friend.near" value={arbiter} onChange={(e) => setArbiter(e.target.value.toLowerCase())} />
            <div className="hint">If you and your client disagree, they decide how to split the held money. They can't take it themselves.</div>
          </div>
        </details>
      </div>

      <div className="card soft">
        <label className="row" style={{ fontWeight: 500 }}>
          <input
            type="checkbox"
            style={{ width: 20, height: 20 }}
            checked={assistantOn}
            onChange={async (e) => {
              if (e.target.checked && !loadAssistantKey(accountId)) {
                try {
                  await enableAssistant(accountId);
                  toast("Assistant on. It can create invoices, never move money.");
                } catch (err) {
                  setError(errText(err));
                  return;
                }
              }
              setAssistantOn(e.target.checked);
            }}
          />
          <span>
            <b>Let my assistant send invoices without any wallet pop-ups.</b>{" "}
            <span className="muted">It gets a key that can only create invoices and mark work delivered. NEAR refuses anything that moves money.</span>
          </span>
        </label>
      </div>

      {error && <p className="err">{error}</p>}
      <button className="btn big block" disabled={!valid || busy} onClick={submit}>
        <Busy busy={busy}>Create invoice{units ? ` for ${formatUsd(units, { cents: true })}` : ""}</Busy>
      </button>
      <p className="hint center" style={{ marginTop: 8 }}>Free. Your wallet just asks you to confirm; PayPact pays the network fee.</p>
    </main>
  );
}
