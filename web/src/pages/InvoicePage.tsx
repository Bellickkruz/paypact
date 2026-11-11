import { useCallback, useEffect, useState } from "react";
import { config, displayName, isDemo } from "../lib/config";
import { formatUsd, nsToDate } from "../lib/money";
import { getInvoice, getProfile, heldAmount, type ClientAction, type Invoice, type Profile } from "../lib/near";
import { loadClientSecret, newClientSecret, paymentMsg, privateLink, publicKeyOf, saveClientSecret } from "../lib/clientKey";
import { relay, sendClientAction } from "../lib/relay";
import { PAY_OPTIONS, PREVIEW_OPTIONS, friendlyAmount, previewQuote, looksLikeAddress, quotePayment, swapStatus, type Quote, type SwapStatus } from "../lib/intents";
import { callContract, ONE_YOCTO, signedRequest, useWallet } from "../lib/wallet";
import { assistantCall, loadAssistantKey } from "../lib/assistant";
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from "../lib/calendar";
import { Busy, CopyField, NudgeButtons, Qr, ShareButtons, Stars, StatusBadge, Timeline, errText, shortDate, toast } from "../ui";

const DAY_MS = 86_400_000;
const FINAL = ["Released", "Refunded", "Split", "Cancelled"];

export function InvoicePage({ id }: { id: string }) {
  const { accountId, connect } = useWallet();
  const [inv, setInv] = useState<Invoice | null | undefined>(undefined);
  const [profile, setProfile] = useState<[Profile, number] | null>(null);
  const [secret, setSecret] = useState<string | null>(() => loadClientSecret(id));

  const refresh = useCallback(async () => {
    try {
      setInv(await getInvoice(id));
    } catch {
      /* keep the last state on a network blip */
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (inv?.freelancer) getProfile(inv.freelancer).then(setProfile).catch(() => {});
  }, [inv?.freelancer, inv?.status]);

  if (inv === undefined) return <main className="wrap"><div className="card center"><span className="spinner dark" /></div></main>;
  if (inv === null) return <main className="wrap"><div className="card center"><h2>Invoice not found</h2><p className="muted">Check the link and try again.</p></div></main>;

  const isFreelancer = accountId === inv.freelancer;
  const isClient = !!secret && !!inv.client_key && publicKeyOf(secret) === inv.client_key;
  const url = `${location.origin}${location.pathname}#/i/${id}`;

  return (
    <main className="wrap">
      {isDemo(inv.freelancer) && !isFreelancer && <DemoGuide inv={inv} isClient={isClient} refresh={refresh} />}
      <InvoiceSummary inv={inv} profile={profile} />
      {isFreelancer && <FreelancerPanel inv={inv} url={url} refresh={refresh} />}
      {!isFreelancer && inv.status === "AwaitingPayment" && (
        <PayPanel inv={inv} secret={secret} onSecret={setSecret} refresh={refresh} />
      )}
      {!isFreelancer && isClient && <ClientPanel inv={inv} secret={secret!} refresh={refresh} />}
      {!isFreelancer && !isClient && inv.status !== "AwaitingPayment" && (
        <div className="card soft center muted small">
          Paid this invoice on another device? Open the private link you saved when you paid.
          {!accountId && (
            <>
              {" "}Are you the freelancer? <a href="#" onClick={(e) => { e.preventDefault(); connect(); }}>Sign in</a>.
            </>
          )}
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- summary

function InvoiceSummary({ inv, profile }: { inv: Invoice; profile: [Profile, number] | null }) {
  const [p, avg] = profile ?? [null, 0];
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted small">Invoice #{inv.id}</span>
        <StatusBadge status={inv.status} />
      </div>
      <div className="amount">{formatUsd(inv.amount, { cents: true })}</div>
      <h3>{inv.title}</h3>
      <p className="muted small" style={{ marginBottom: 6 }}>
        From <a href={`#/p/${inv.freelancer}`}>{displayName(inv.freelancer)}</a> · due {shortDate(nsToDate(inv.due_at))}
      </p>
      <PaymentSplit inv={inv} />
      {p && (
        <a href={`#/p/${inv.freelancer}`} className="small" style={{ textDecoration: "none" }}>
          <Stars value={avg / 100} count={p.rating_count} />{" "}
          <span className="muted">· {p.completed} {p.completed === 1 ? "job" : "jobs"} completed
            {p.delivered > 0 && ` · ${Math.round((p.delivered_on_time / p.delivered) * 100)}% on time`}</span>
        </a>
      )}
      <Timeline inv={inv} />
      {inv.delivered_at && <DeliveryProof inv={inv} />}
    </div>
  );
}

/** Up front vs held, stated plainly next to the total so nobody is surprised after paying. */
function PaymentSplit({ inv }: { inv: Invoice }) {
  const up = BigInt(inv.upfront);
  if (up === 0n) return null;
  const paid = inv.status !== "AwaitingPayment" && inv.status !== "Cancelled";
  const upText = formatUsd(inv.upfront, { cents: true });
  if (up === BigInt(inv.amount)) {
    return (
      <div className="split-box">
        <div>💸 <b>Direct payment:</b> the full {upText} {paid ? "went" : "goes"} straight to the freelancer, as agreed. It is not held in escrow.</div>
      </div>
    );
  }
  return (
    <div className="split-box">
      <div>💸 <b>{upText}</b> {paid ? "paid to the freelancer immediately" : "goes to the freelancer immediately"} <span className="muted">(agreed up front)</span></div>
      <div>🔒 <b>{formatUsd(heldAmount(inv), { cents: true })}</b> held safely until you approve the work</div>
    </div>
  );
}

/** What was delivered and when, as recorded on-chain: the record a dispute is judged against. */
function DeliveryProof({ inv }: { inv: Invoice }) {
  const when = nsToDate(inv.delivered_at!);
  const onTime = BigInt(inv.delivered_at!) <= BigInt(inv.due_at);
  return (
    <div className="proof">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>📦 Proof of delivery</b>
        <span className={`badge ${onTime ? "ok" : "wait"}`}>{onTime ? "On time" : "Late"}</span>
      </div>
      <p className="small" style={{ margin: "6px 0" }}>
        Delivered {when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </p>
      {inv.delivery?.note && <p className="small" style={{ margin: "6px 0" }}>"{inv.delivery.note}"</p>}
      {inv.delivery?.link && (
        <a className="btn small ghost" href={inv.delivery.link} target="_blank" rel="noreferrer noopener">View the delivered work ↗</a>
      )}
      <p className="hint" style={{ marginTop: 6 }}>Recorded on NEAR at the moment of delivery. Nobody can change it afterwards, so a dispute is judged against it.</p>
    </div>
  );
}

// ---------------------------------------------------------------- "Try it now" demo

/** Walks a visitor through the client side of a demo invoice; the demo freelancer is played by PayPact. */
function DemoGuide({ inv, isClient, refresh }: { inv: Invoice; isClient: boolean; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const step =
    inv.status === "AwaitingPayment" ? 1 : inv.status === "Funded" ? 2 : inv.status === "Delivered" ? 3 :
    (inv.status === "Released" || inv.status === "Split") && !inv.rating ? 4 : 5;
  const text = [
    "",
    "You're the client. Demo Designer sent you this invoice. Tap Pay below (it's free test money).",
    "Your money is locked. Now let Demo Designer deliver the work:",
    "The work is delivered, with proof recorded on-chain. Check it, then tap Approve & release below.",
    "Paid out in seconds. Leave Demo Designer a rating below.",
    "That's the whole flow! Now try it for real: create your own invoice.",
  ][step];
  const deliver = async () => {
    setBusy(true);
    try {
      await relay({ method: "demo_deliver", invoice_id: inv.id });
      toast("Demo Designer delivered the work");
      refresh();
      setTimeout(refresh, 2500);
    } catch (e) {
      toast(`Didn't go through: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card demo-guide stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>▶ Demo · step {Math.min(step, 4)} of 4</b>
        <span className="muted small">testnet, no real money</span>
      </div>
      <p style={{ margin: 0 }}>{text}</p>
      {step === 2 && isClient && (
        <button className="btn gold" disabled={busy} onClick={deliver}>
          <Busy busy={busy}>Demo Designer delivers the work</Busy>
        </button>
      )}
      {step === 5 && (
        <div className="row">
          <a className="btn" href="#/new">Create my own invoice</a>
          <a className="btn ghost" href={`#/p/${inv.freelancer}`}>See Demo Designer's profile</a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- client: paying

function ProtectionNote({ inv }: { inv: Invoice }) {
  const grace = 2;
  const refundBy = shortDate(new Date(nsToDate(inv.due_at).getTime() + grace * DAY_MS));
  const up = BigInt(inv.upfront);
  return (
    <div className="protect">
      <span className="icon">🔒</span>
      <div>
        {up === BigInt(inv.amount) ? (
          <>This is a <b>direct payment</b>: it goes straight to {displayName(inv.freelancer)}, as you agreed.</>
        ) : (
          <>
            {up > 0n && <><b>{formatUsd(inv.upfront, { cents: true })}</b> goes to the freelancer right away, as agreed. </>}
            <b>{formatUsd(heldAmount(inv), { cents: true })} is held safely</b> by a smart contract. It's released only when you
            approve the work, and refunded to you if nothing is delivered by {refundBy}. Not even PayPact can touch it.
          </>
        )}
      </div>
    </div>
  );
}

function PayPanel({ inv, secret, onSecret, refresh }: {
  inv: Invoice; secret: string | null; onSecret: (s: string) => void; refresh: () => void;
}) {
  const ensureSecret = () => {
    if (secret) return secret;
    const s = newClientSecret();
    saveClientSecret(inv.id, s);
    onSecret(s);
    return s;
  };
  return (
    <div className="card stack">
      <h2>Pay this invoice</h2>
      <ProtectionNote inv={inv} />
      {config.anyChain ? <AnyChainPay inv={inv} ensureSecret={ensureSecret} /> : <DemoPay inv={inv} ensureSecret={ensureSecret} refresh={refresh} />}
      <NearWalletPay inv={inv} ensureSecret={ensureSecret} refresh={refresh} />
    </div>
  );
}

function DemoPay({ inv, ensureSecret, refresh }: { inv: Invoice; ensureSecret: () => string; refresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="stack">
      <AnyChainPreview amount={inv.amount} />
      {error && <p className="err">{error}</p>}
      <button
        className="btn big block gold"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const s = ensureSecret();
            await relay({ method: "demo_pay", invoice_id: inv.id, client_key: publicKeyOf(s) });
            toast("Paid. The money is locked for the freelancer.");
            refresh();
          } catch (e) {
            setError(errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Busy busy={busy}>Pay {formatUsd(inv.amount, { cents: true })} (test money)</Busy>
      </button>
    </div>
  );
}

/** Testnet: live NEAR Intents prices for this invoice, proving the any-crypto route is real. */
function AnyChainPreview({ amount }: { amount: string }) {
  const [rows, setRows] = useState<Record<string, string>>({});
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all(
        PREVIEW_OPTIONS.map((o) =>
          previewQuote(o.assetId, o.chain, amount)
            .then((v) => live && setRows((r) => ({ ...r, [o.assetId]: friendlyAmount(v) })))
            .catch(() => live && setRows((r) => ({ ...r, [o.assetId]: "–" }))),
        ),
      ).then(() => live && setAt(new Date()));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [amount]);
  return (
    <div className="preview">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>On mainnet, pay with any crypto</b>
        <span className="badge lock">Live prices</span>
      </div>
      <div className="preview-grid">
        {PREVIEW_OPTIONS.map((o) => (
          <div key={o.assetId} className="preview-row">
            <span className="muted small">{o.label} on {o.chain}</span>
            <b>{rows[o.assetId] ? `${rows[o.assetId]} ${o.label}` : <span className="spinner dark" />}</b>
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Real quotes from NEAR Intents, fees included{at ? `, updated ${at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}.
        Any-crypto payment runs on mainnet only, so this testnet demo pays with free test dollars below.
      </p>
    </div>
  );
}

function AnyChainPay({ inv, ensureSecret }: { inv: Invoice; ensureSecret: () => string }) {
  const [opt, setOpt] = useState(0);
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<SwapStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choice = PAY_OPTIONS[opt];

  useEffect(() => {
    if (!quote) return;
    const t = setInterval(async () => setStatus(await swapStatus(quote.depositAddress, quote.depositMemo).catch(() => null)), 6000);
    return () => clearInterval(t);
  }, [quote]);

  const getQuote = async () => {
    setBusy(true);
    setError("");
    try {
      const s = ensureSecret();
      setQuote(await quotePayment({ originAsset: choice.assetId, amountOut: inv.amount, refundTo: refundTo.trim(), msg: paymentMsg(inv.id, s) }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (quote) {
    const label = status === "SUCCESS" ? "✅ Received. Locking it for the freelancer…" :
      status === "PROCESSING" || status === "KNOWN_DEPOSIT_TX" ? "⏳ Payment seen, converting…" :
      status === "REFUNDED" || status === "FAILED" ? "↩️ Something went wrong; your payment is being refunded to your address." :
      status === "INCOMPLETE_DEPOSIT" ? "⚠️ The amount sent was too small; it will be refunded." : "Waiting for your payment…";
    return (
      <div className="stack">
        <div className="card gold" style={{ margin: 0 }}>
          <p style={{ marginBottom: 4 }}>Send exactly</p>
          <div className="amount" style={{ fontSize: 30 }}>{quote.amountInFormatted} {choice.label}</div>
          <p className="muted small">on <b>{choice.chain}</b>, to this address. It arrives in about {quote.timeEstimate ?? 60} seconds.</p>
        </div>
        <div className="center"><Qr text={quote.depositAddress} /></div>
        <CopyField label={`${choice.label} deposit address (${choice.chain})`} value={quote.depositAddress} />
        {quote.depositMemo && <CopyField label="Memo (required)" value={quote.depositMemo} />}
        <p className="center"><b>{label}</b></p>
        <p className="hint center">This page updates by itself. Only send {choice.label} on {choice.chain}; anything else can be lost.</p>
        <button className="btn ghost small" onClick={() => { setQuote(null); setStatus(null); }}>Choose another coin</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="field">
        <label>Pay with the crypto you already have</label>
        <div className="chips">
          {PAY_OPTIONS.map((o, i) => (
            <button key={o.assetId} className={`chip ${i === opt ? "on" : ""}`} onClick={() => setOpt(i)}>
              {o.label} · {o.chain}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="refund">Your {choice.chain} address</label>
        <input id="refund" placeholder={choice.addressHint} value={refundTo} onChange={(e) => setRefundTo(e.target.value)} />
        <div className="hint">Only used to send your money back automatically if the conversion fails.</div>
      </div>
      {error && <p className="err">{error}</p>}
      <button className="btn big block gold" disabled={busy || !looksLikeAddress(choice.chain, refundTo)} onClick={getQuote}>
        <Busy busy={busy}>Get payment details</Busy>
      </button>
      <p className="hint center">The exact amount, including network fees, is shown before you send anything.</p>
    </div>
  );
}

function NearWalletPay({ inv, ensureSecret, refresh }: { inv: Invoice; ensureSecret: () => string; refresh: () => void }) {
  const { accountId, connect } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <details>
      <summary>Have {config.symbol} on NEAR? Pay from your NEAR wallet</summary>
      <div className="stack" style={{ marginTop: 10 }}>
        {error && <p className="err">{error}</p>}
        {accountId ? (
          <button
            className="btn ghost block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const s = ensureSecret();
                await callContract(
                  "ft_transfer_call",
                  { receiver_id: config.contract, amount: inv.amount, msg: paymentMsg(inv.id, s, accountId) },
                  { receiverId: config.token, deposit: ONE_YOCTO, gas: 150_000_000_000_000n },
                );
                toast("Paid. The money is locked for the freelancer.");
                refresh();
              } catch (e) {
                setError(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Busy busy={busy}>Pay {formatUsd(inv.amount, { cents: true })} from {accountId}</Busy>
          </button>
        ) : (
          <button className="btn ghost block" onClick={() => connect()}>Connect a NEAR wallet</button>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- client: after paying

function reviewEnds(inv: Invoice) {
  return inv.delivered_at ? new Date(nsToDate(inv.delivered_at).getTime() + inv.review_days * DAY_MS) : null;
}

function CalendarButtons({ event }: { event: CalendarEvent }) {
  return (
    <div className="row">
      <button className="btn small ghost" onClick={() => downloadIcs(event)}>📅 Add to my calendar</button>
      <a className="btn small ghost" href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">Google Calendar</a>
    </div>
  );
}

function ClientPanel({ inv, secret, refresh }: { inv: Invoice; secret: string; refresh: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [splitPct, setSplitPct] = useState(50);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState("");
  const [refundAcct, setRefundAcct] = useState("");
  const url = `${location.origin}${location.pathname}#/i/${inv.id}`;
  const held = BigInt(heldAmount(inv));
  const ends = reviewEnds(inv);

  const act = async (label: string, action: ClientAction, done: string) => {
    setBusy(label);
    setError("");
    try {
      await sendClientAction(inv.id, secret, action);
      toast(done);
      refresh();
      setTimeout(refresh, 2500);
    } catch (e) {
      setError(errText(e));
      toast(`Didn't go through: ${errText(e)}`);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      {error && <div className="card red small"><b>Didn't go through:</b> {error}</div>}
      {!FINAL.includes(inv.status) && <SaveControlLink inv={inv} secret={secret} />}
      {inv.status === "Funded" && (
        <div className="card stack">
          <h3>Thanks, you've paid 🔒</h3>
          <p className="muted">
            {formatUsd(held, { cents: true })} is held safely. {displayName(inv.freelancer)} has been told the money is there and is working on it.
            Work is due {shortDate(nsToDate(inv.due_at))}.
          </p>
          <CalendarButtons event={{ title: `Work due: ${inv.title}`, details: `PayPact invoice #${inv.id}`, start: nsToDate(inv.due_at), url }} />
          <button className="btn ghost" disabled={!!busy} onClick={() => act("approve", { type: "approve" }, "Approved and paid. Thank you!")}>
            <Busy busy={busy === "approve"}>Already happy with the work? Approve now</Busy>
          </button>
          {Date.now() > nsToDate(inv.due_at).getTime() + 2 * DAY_MS && (
            <button className="btn danger" disabled={!!busy} onClick={() => act("refund", { type: "refund_undelivered" }, "Refund on its way")}>
              Nothing delivered: refund me
            </button>
          )}
        </div>
      )}

      {inv.status === "Delivered" && (
        <div className="card stack">
          <h3>📦 The work has been delivered</h3>
          <p className="muted">
            Please review it. If you're happy, approve and {displayName(inv.freelancer)} is paid in seconds.
            {ends && <> If there's no response by <b>{shortDate(ends)}</b>, payment is released automatically.</>}
          </p>
          {ends && <CalendarButtons event={{ title: `Review & approve: ${inv.title}`, details: `Approve or report a problem before the automatic release. PayPact invoice #${inv.id}`, start: ends, url }} />}
          <button className="btn big block" disabled={!!busy} onClick={() => act("approve", { type: "approve" }, "Approved and paid. Thank you!")}>
            {busy === "approve" ? <><span className="spinner" /> Releasing payment… a few seconds</> : <>Approve & release {formatUsd(held, { cents: true })}</>}
          </button>
          <details>
            <summary>Something's wrong? Report a problem</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <textarea placeholder="What's missing or wrong?" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              <p className="hint">The money stays frozen while you and the freelancer sort it out. You can agree a split, or a referee decides.</p>
              <button className="btn danger" disabled={!!busy || !reason.trim()} onClick={() => act("dispute", { type: "dispute", reason: reason.trim() }, "Problem reported. The money is frozen.")}>
                <Busy busy={busy === "dispute"}>Freeze payment & report</Busy>
              </button>
            </div>
          </details>
        </div>
      )}

      {inv.status === "Disputed" && (
        <div className="card red stack">
          <h3>⚠️ Payment frozen</h3>
          <p className="small">You reported: "{inv.dispute_reason}"</p>
          {inv.proposal?.by === "Freelancer" && (
            <div className="card" style={{ margin: 0 }}>
              <p>{displayName(inv.freelancer)} offers: <b>{formatUsd(inv.proposal.to_freelancer, { cents: true })}</b> to them, <b>{formatUsd(held - BigInt(inv.proposal.to_freelancer), { cents: true })}</b> back to you.</p>
              <button className="btn" disabled={!!busy} onClick={() => act("accept", { type: "accept_split" }, "Settled. Thanks for working it out.")}>
                <Busy busy={busy === "accept"}>Accept this split</Busy>
              </button>
            </div>
          )}
          <label>Offer a split: {splitPct}% to the freelancer ({formatUsd((held * BigInt(splitPct)) / 100n, { cents: true })})</label>
          <input type="range" min={0} max={100} step={5} value={splitPct} onChange={(e) => setSplitPct(Number(e.target.value))} />
          <button className="btn ghost" disabled={!!busy} onClick={() => act("propose", { type: "propose_split", to_freelancer: ((held * BigInt(splitPct)) / 100n).toString() }, "Offer sent")}>
            <Busy busy={busy === "propose"}>Send this offer</Busy>
          </button>
          <p className="hint">
            {inv.arbiter ? `If you can't agree, the referee (${inv.arbiter}) decides.` : `If nothing is agreed within ${inv.dispute_timeout_days} days, it's split 50/50.`}
          </p>
        </div>
      )}

      {(inv.status === "Released" || inv.status === "Split") && !inv.rating && (
        <div className="card stack">
          <h3>How was working with {displayName(inv.freelancer)}?</h3>
          <div className="starpick">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={n <= stars ? "on" : ""} onClick={() => setStars(n)} aria-label={`${n} stars`}>★</button>
            ))}
          </div>
          <textarea placeholder="A few words for future clients (optional)" maxLength={280} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn" disabled={!!busy} onClick={() => act("rate", { type: "rate", stars, comment: comment.trim() || null }, "Thanks! Your rating is on their profile.")}>
            <Busy busy={busy === "rate"}>Post rating</Busy>
          </button>
          <p className="hint">Only clients who actually paid can rate, once. Ratings can't be edited or deleted by anyone.</p>
        </div>
      )}
      {(inv.status === "Released" || inv.status === "Split") && inv.rating && (
        <div className="card green center">Thanks for paying with PayPact. You rated {displayName(inv.freelancer)} <Stars value={inv.rating.stars} />.</div>
      )}

      {!FINAL.includes(inv.status) && !inv.client_refund_to && (
        <details className="card soft">
          <summary>Add a NEAR account for refunds (recommended)</summary>
          <div className="row" style={{ marginTop: 10 }}>
            <input className="grow" placeholder="you.near" value={refundAcct} onChange={(e) => setRefundAcct(e.target.value.toLowerCase())} />
            <button className="btn small" disabled={!!busy || !refundAcct.trim()} onClick={() => act("refundacct", { type: "set_refund_account", account: refundAcct.trim() }, "Saved")}>Save</button>
          </div>
          <p className="hint">If any money comes back to you, it goes here.</p>
        </details>
      )}

    </>
  );
}

/**
 * The client's power to approve or dispute lives in this browser. If they clear it or
 * switch phones, that protection is gone, so right after paying we ask them to send
 * the private link to themselves, and keep asking until they do.
 */
function SaveControlLink({ inv, secret }: { inv: Invoice; secret: string }) {
  const key = `paypact:${config.contract}:saved:${inv.id}`;
  const [saved, setSaved] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);
  const link = privateLink(inv.id, secret);
  const markSaved = () => {
    setSaved(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
      /* fine: we'll just ask again next time */
    }
  };
  const msg = `My PayPact control link for "${inv.title}" (${formatUsd(inv.amount, { cents: true })}). It lets me approve the work or report a problem from any device. Don't share it.\n\n${link}`;
  const subject = `PayPact: control link for invoice #${inv.id}`;

  if (saved && !open) {
    return (
      <div className="card soft row small" style={{ justifyContent: "space-between" }}>
        <span>✅ Control link saved</span>
        <button className="btn small ghost" onClick={() => setOpen(true)}>Show it again</button>
      </div>
    );
  }
  return (
    <div className="card stack keycard">
      <h3>🔑 Save your control link, it takes 5 seconds</h3>
      <p className="small" style={{ margin: 0 }}>
        Your power to <b>approve the work or get your money back</b> is stored only in this browser. If you clear it or change phones,
        you'd lose that protection. Send this link <b>to yourself</b> so you can act from any device.
      </p>
      <div className="row">
        <a className="btn small" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" onClick={markSaved}>WhatsApp (to myself)</a>
        <a className="btn small ghost" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(subject)}`} target="_blank" rel="noreferrer" onClick={markSaved}>Telegram (Saved Messages)</a>
        <a className="btn small ghost" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`} onClick={markSaved}>Email it to me</a>
      </div>
      <div onClick={(e) => (e.target as HTMLElement).tagName === "BUTTON" && markSaved()}><CopyField label="Or copy it" value={link} /></div>
      <p className="hint" style={{ margin: 0 }}>Keep it private: anyone with this link can approve or dispute for you. The freelancer never sees it.</p>
    </div>
  );
}

// ---------------------------------------------------------------- freelancer

function FreelancerPanel({ inv, url, refresh }: { inv: Invoice; url: string; refresh: () => void }) {
  const { accountId } = useWallet();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [splitPct, setSplitPct] = useState(70);
  const held = BigInt(heldAmount(inv));
  const ends = reviewEnds(inv);

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    setError("");
    try {
      await fn();
      toast(done);
      refresh();
      setTimeout(refresh, 2500);
    } catch (e) {
      setError(errText(e));
      toast(`Didn't go through: ${errText(e)}`);
    } finally {
      setBusy("");
    }
  };
  const wallet = (method: string, args: object = {}, deposit = ONE_YOCTO) =>
    callContract(method, { invoice_id: inv.id, ...args }, { deposit });
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const proofArgs = { invoice_id: inv.id, link: link.trim() || null, note: note.trim() || null };
  const linkOk = !link.trim() || /^https:\/\/\S+$/.test(link.trim());
  const markDelivered = () =>
    accountId && loadAssistantKey(accountId)
      ? assistantCall(accountId, "mark_delivered", proofArgs)
      : signedRequest("mark_delivered", proofArgs);

  const shareText = `Hi, here's my invoice for ${inv.title}: ${formatUsd(inv.amount, { cents: true })}. You can pay with any crypto you have, and your payment is held safely until you approve the work:`;
  const nudge = `Hi! A friendly reminder from PayPact: the invoice for "${inv.title}" (${formatUsd(inv.amount, { cents: true })}) is ready whenever you are. Your payment stays protected until you approve the work.`;
  const reviewNudge = `Hi! Quick note from PayPact: the work for "${inv.title}" has been delivered. You can approve it here, or report a problem${ends ? ` before ${shortDate(ends)}` : ""}:`;
  const brag = `Just got paid ${formatUsd(inv.amount, { cents: true })} for "${inv.title}" with PayPact on @NEARProtocol: client paid with crypto, escrow held it, paid out in seconds. ✅`;

  return (
    <div className="stack">
      {inv.status === "AwaitingPayment" && (
        <div className="card stack">
          <h3>Send it to your client</h3>
          <ShareButtons text={shareText} url={url} />
          <NudgeButtons label="Send a friendly reminder, written as PayPact" text={nudge} url={url} />
          <button className="btn small danger" disabled={!!busy} onClick={() => run("cancel", () => wallet("cancel_invoice"), "Invoice cancelled")}>Cancel invoice</button>
        </div>
      )}

      {inv.status === "Funded" && (
        <div className="card green stack">
          <h3>🔒 {formatUsd(held, { cents: true })} is locked for you</h3>
          <p>
            {BigInt(inv.upfront) > 0n && <>{formatUsd(inv.upfront, { cents: true })} up front is already in your wallet. </>}
            The client can't pull this money back while you work. Deliver by <b>{shortDate(nsToDate(inv.due_at))}</b>, then mark it delivered.
          </p>
          <CalendarButtons event={{ title: `Deliver: ${inv.title}`, details: `PayPact invoice #${inv.id}: mark it delivered when done.`, start: nsToDate(inv.due_at), url }} />
          <div className="field">
            <label htmlFor="dlink">Link to the work (recommended)</label>
            <input id="dlink" inputMode="url" placeholder="https://drive.google.com/…" value={link} onChange={(e) => setLink(e.target.value)} />
            {!linkOk && <div className="err small">Use a full link starting with https://</div>}
          </div>
          <div className="field">
            <label htmlFor="dnote">Short note (optional)</label>
            <input id="dnote" maxLength={280} placeholder="Final logo files and brand guide" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="hint">Saved on-chain with the time you delivered. If the client ever claims nothing was delivered, this is your proof.</div>
          </div>
          <button className="btn big block" disabled={!!busy || !linkOk} onClick={() => run("deliver", markDelivered, "Marked delivered. The client has been asked to review.")}>
            {busy === "deliver" ? <><span className="spinner" /> Confirm in your wallet…</> : "I've delivered the work"}
          </button>
        </div>
      )}

      {inv.status === "Delivered" && (
        <div className="card stack">
          <h3>Waiting for the client's review</h3>
          <p className="muted">
            {ends && <>If they don't respond, you're <b>paid automatically on {shortDate(ends)}</b>. </>}No chasing needed.
          </p>
          {ends && <CalendarButtons event={{ title: `Auto-payment: ${inv.title}`, details: `If the client hasn't responded, release your payment. PayPact invoice #${inv.id}`, start: ends, url }} />}
          <NudgeButtons label="Nudge the client politely, written as PayPact" text={reviewNudge} url={url} />
          {ends && Date.now() >= ends.getTime() && (
            <button className="btn" disabled={!!busy} onClick={() => run("release", () => relay({ method: "release_after_review", invoice_id: inv.id }), "Released. Enjoy your money!")}>
              <Busy busy={busy === "release"}>Release my payment now</Busy>
            </button>
          )}
        </div>
      )}

      {inv.status === "Disputed" && (
        <div className="card red stack">
          <h3>⚠️ The client reported a problem</h3>
          <p className="small">"{inv.dispute_reason}"</p>
          {inv.proposal?.by === "Client" && (
            <div className="card" style={{ margin: 0 }}>
              <p>Client offers: <b>{formatUsd(inv.proposal.to_freelancer, { cents: true })}</b> to you.</p>
              <button className="btn" disabled={!!busy} onClick={() => run("accept", () => wallet("accept_split"), "Settled")}>Accept</button>
            </div>
          )}
          <label>Offer a split: {splitPct}% to you ({formatUsd((held * BigInt(splitPct)) / 100n, { cents: true })})</label>
          <input type="range" min={0} max={100} step={5} value={splitPct} onChange={(e) => setSplitPct(Number(e.target.value))} />
          <div className="row">
            <button className="btn ghost" disabled={!!busy} onClick={() => run("propose", () => wallet("propose_split", { to_freelancer: ((held * BigInt(splitPct)) / 100n).toString() }), "Offer sent")}>Send offer</button>
            <button className="btn danger" disabled={!!busy} onClick={() => run("refund", () => wallet("refund_client"), "Refunded")}>Refund the client</button>
          </div>
        </div>
      )}

      {(inv.status === "Released" || inv.status === "Split") && (
        <div className="card green stack center">
          <div className="celebrate">🎉</div>
          <h3>You've been paid</h3>
          {inv.rating && <p>Your client rated you <Stars value={inv.rating.stars} />{inv.rating.comment && <><br /><i>"{inv.rating.comment}"</i></>}</p>}
          <ShareButtons text={brag} url={url} />
          <a className="btn ghost" href={`#/p/${inv.freelancer}`}>See my profile</a>
        </div>
      )}
      {(BigInt(inv.owed_freelancer) > 0n) && (
        <div className="card gold">
          A payout to you couldn't be delivered (your account may need to register with the token).{" "}
          <button className="btn small" onClick={() => run("retry", () => relay({ method: "retry_payout", invoice_id: inv.id }), "Sent")}>Retry</button>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
