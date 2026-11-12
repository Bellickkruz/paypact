import { useState } from "react";
import { config } from "../lib/config";
import { formatUsd, toUnits } from "../lib/money";
import { parseInvoice } from "../lib/parseInvoice";
import { signedRequest, useWallet } from "../lib/wallet";
import { assistantCall, enableAssistant, loadAssistantKey } from "../lib/assistant";
import { Busy, CopyField, Qr, ShareButtons, errText, shortDate, toast } from "../ui";

const UPFRONT = [0, 30, 50, 100];
const MAX_MILESTONES = 12;
const PERIODS = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 60, label: "2 months" },
  { days: 90, label: "3 months" },
];

type Plan = "single" | "milestones" | "batches";
interface MilestoneRow { title: string; amount: string; due: string }

/** Split `total` units into `n` equal parts; any remainder goes to the last part. */
function equalParts(total: bigint, n: number): bigint[] {
  const each = total / BigInt(n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - each * BigInt(n - 1) : each));
}

const DAY_MS = 86_400_000;

const inDays = (d: string) => Math.max(1, Math.ceil((new Date(`${d}T23:59:00`).getTime() - Date.now()) / DAY_MS));
const dateIn = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

/** Prefill from "#/new?title=…&amount=…" (the home page sentence, or "Send the next stage"). */
function prefill() {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const num = (k: string, d: number) => (q.has(k) && isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  return {
    title: q.get("title") ?? "",
    amount: q.get("amount") ?? "",
    upfront: UPFRONT.includes(num("upfront", 0)) ? num("upfront", 0) : 0,
    review: num("review", 5),
    arbiter: q.get("arbiter") ?? "",
    client: q.get("client") ?? "",
    dueDays: Math.min(365, Math.max(1, num("due", 7))),
    isNextStage: q.get("stage") === "next",
  };
}

export function NewInvoice() {
  const { accountId, connect } = useWallet();
  const [pre] = useState(prefill);
  const [sentence, setSentence] = useState("");
  const [client, setClient] = useState(pre.client);
  const [amount, setAmount] = useState(pre.amount);
  const [title, setTitle] = useState(pre.title);
  const [due, setDue] = useState(dateIn(pre.dueDays));
  const [upfront, setUpfront] = useState(pre.upfront);
  const [review, setReview] = useState(pre.review);
  const [arbiter, setArbiter] = useState(pre.arbiter);
  const [plan, setPlan] = useState<Plan>("single");
  const [parts, setParts] = useState(4);
  const [periodDays, setPeriodDays] = useState(30);
  const [partName, setPartName] = useState("Part");
  const [rows, setRows] = useState<MilestoneRow[]>([
    { title: "", amount: "", due: dateIn(7) },
    { title: "", amount: "", due: dateIn(14) },
  ]);
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

  // The milestones this form would create (empty for a single payment).
  const milestones: { title: string; amount: string; due_in_days: number; dueLabel: string }[] =
    plan === "batches" && units
      ? equalParts(BigInt(units), parts).map((a, i) => {
          const days = Math.max(1, Math.ceil((periodDays * (i + 1)) / parts));
          return { title: `${partName.trim() || "Part"} ${i + 1} of ${parts}`, amount: a.toString(), due_in_days: days, dueLabel: dateIn(days) };
        })
      : plan === "milestones"
        ? rows.map((r) => ({ title: r.title.trim(), amount: toUnits(r.amount) ?? "", due_in_days: inDays(r.due), dueLabel: r.due }))
        : [];
  const projectTotal = milestones.reduce((s, m) => s + (m.amount ? BigInt(m.amount) : 0n), 0n);
  const datesInOrder = milestones.every((m, i) => i === 0 || m.due_in_days >= milestones[i - 1].due_in_days);
  const valid =
    title.trim().length > 0 &&
    (plan === "single"
      ? !!units && !!due
      : milestones.length >= 2 && milestones.every((m) => m.title && m.amount) && datesInOrder);

  const submit = async () => {
    if (plan !== "single") return submitProject();
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

  async function submitProject() {
    setBusy(true);
    setError("");
    try {
      // Free for the freelancer: sign a message, PayPact pays the network fee.
      const { invoice_id } = await signedRequest("create_project", {
        token: config.token,
        title: title.trim(),
        milestones: milestones.map(({ title, amount, due_in_days }) => ({ title, amount, due_in_days })),
        review_days: review,
        dispute_timeout_days: null,
        arbiter: arbiter.trim() || null,
      });
      if (!invoice_id) throw new Error("The project was created, but its number didn't come back. Check My invoices.");
      setCreated(String(invoice_id));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const url = `${location.origin}${location.pathname}#/i/${created}`;
    const greeting = client ? `Hi ${client}, ` : "Hi, ";
    const upfrontNote = upfront > 0 ? ` (${upfront}% up front as agreed)` : "";
    const text = plan === "single"
      ? `${greeting}here's my invoice for ${title.trim()}: ${formatUsd(units!)}${upfrontNote}. You can pay with any crypto you have, and your payment is held safely until you approve the work:`
      : `${greeting}here's the plan for ${title.trim()}: ${formatUsd(projectTotal)} in ${milestones.length} milestones. You pay once with any crypto you have; the money is held safely and each milestone is released only when you approve it:`;
    return (
      <main className="wrap">
        <div className="card center stack">
          <div className="celebrate">🎉</div>
          <h2>{plan === "single" ? `Invoice #${created} is ready` : `Project with ${milestones.length} milestones is ready`}</h2>
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
        <div className="field">
          <label>How will you be paid?</label>
          <div className="chips">
            <button className={`chip ${plan === "single" ? "on" : ""}`} onClick={() => setPlan("single")}>One payment</button>
            <button className={`chip ${plan === "batches" ? "on" : ""}`} onClick={() => setPlan("batches")}>Equal batches</button>
            <button className={`chip ${plan === "milestones" ? "on" : ""}`} onClick={() => setPlan("milestones")}>Milestones</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {plan === "single" && "One job, one delivery."}
            {plan === "batches" && "Same amount each time, e.g. 4 posts over a month: the client pays once and each part is released when they approve it."}
            {plan === "milestones" && "Different steps with their own price and date, e.g. design, build, launch. The client pays once; each milestone is released when they approve it."}
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="client">Client's name</label>
            <input id="client" placeholder="Sarah" value={client} onChange={(e) => setClient(e.target.value)} />
            <div className="hint">Only used in your message to them.</div>
          </div>
          {plan !== "milestones" && (
            <div className="field">
              <label htmlFor="amount">{plan === "batches" ? "Total amount (USD)" : "Amount (USD)"}</label>
              <input id="amount" inputMode="decimal" placeholder={plan === "batches" ? "1000" : "300"} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="hint">Paid to you in {config.symbol}, a dollar stablecoin.</div>
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="title">{plan === "single" ? "What's it for?" : "Project name"}</label>
          <input id="title" maxLength={plan === "single" ? 140 : 100} placeholder={plan === "single" ? "Logo design" : "Instagram posts for Bloom Café"} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {plan === "batches" && (
          <>
            <div className="field">
              <label>Number of parts</label>
              <div className="chips">
                {[2, 3, 4, 6, 8, 12].map((n) => (
                  <button key={n} className={`chip ${parts === n ? "on" : ""}`} onClick={() => setParts(n)}>{n}</button>
                ))}
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="period">Spread over</label>
                <select id="period" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))}>
                  {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="partname">Each part is a…</label>
                <input id="partname" maxLength={30} placeholder="Post" value={partName} onChange={(e) => setPartName(e.target.value)} />
              </div>
            </div>
          </>
        )}

        {plan === "milestones" && (
          <div className="field">
            <label>Milestones</label>
            <div className="stack">
              {rows.map((r, i) => (
                <div key={i} className="ms-row">
                  <span className="ms-num">{i + 1}</span>
                  <input aria-label={`Milestone ${i + 1} name`} placeholder={["Design", "Build pages", "Launch"][i] ?? `Milestone ${i + 1}`} maxLength={140}
                    value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  <input aria-label={`Milestone ${i + 1} amount`} inputMode="decimal" placeholder="$" className="ms-amt"
                    value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  <input aria-label={`Milestone ${i + 1} due date`} type="date" min={dateIn(1)} className="ms-date"
                    value={r.due} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
                  {rows.length > 2 && (
                    <button className="btn small ghost" aria-label="Remove milestone" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                  )}
                </div>
              ))}
            </div>
            {rows.length < MAX_MILESTONES && (
              <button className="btn small ghost" style={{ marginTop: 8 }}
                onClick={() => setRows([...rows, { title: "", amount: "", due: rows[rows.length - 1]?.due ?? dateIn(7) }])}>
                + Add milestone
              </button>
            )}
            {!datesInOrder && <div className="err small">Put the due dates in order: each milestone on or after the one before.</div>}
          </div>
        )}

        {plan !== "single" && milestones.length > 0 && projectTotal > 0n && (
          <div className="ms-preview">
            <b>The client pays {formatUsd(projectTotal, { cents: true })} once. You're paid:</b>
            {milestones.map((m, i) => (
              <div key={i} className="row" style={{ justifyContent: "space-between" }}>
                <span>{i + 1}. {m.title || `Milestone ${i + 1}`}</span>
                <span className="muted small">{m.amount ? formatUsd(m.amount, { cents: true }) : "—"} · {shortDate(new Date(`${m.dueLabel}T12:00:00`))}</span>
              </div>
            ))}
            <span className="hint">Each one is released when the client approves it, or automatically if they don't reply within the review window.</span>
          </div>
        )}

        <div className="grid2">
          {plan === "single" && (
            <div className="field">
              <label htmlFor="due">Work due by</label>
              <input id="due" type="date" min={dateIn(1)} value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="review">Client review window</label>
            <select id="review" value={review} onChange={(e) => setReview(Number(e.target.value))}>
              {[2, 3, 5, 7, 14].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            <div className="hint">If they don't respond in time, you're paid automatically.</div>
          </div>
        </div>
        {plan === "single" && <div className="field">
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
        </div>}
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
        <Busy busy={busy}>
          {plan === "single"
            ? `Create invoice${units ? ` for ${formatUsd(units, { cents: true })}` : ""}`
            : `Create project${projectTotal > 0n ? ` for ${formatUsd(projectTotal, { cents: true })}` : ""}`}
        </Busy>
      </button>
      <p className="hint center" style={{ marginTop: 8 }}>Free. Your wallet just asks you to confirm; PayPact pays the network fee.</p>
    </main>
  );
}
