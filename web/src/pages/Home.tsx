import { useEffect, useRef, useState } from "react";
import { useWallet } from "../lib/wallet";
import { config, displayName } from "../lib/config";
import { formatUsd, toUnits } from "../lib/money";
import { parseInvoice } from "../lib/parseInvoice";
import { relay } from "../lib/relay";
import { ago, networkStats, type NetworkStats } from "../lib/network";
import { Busy, StatusBadge, errText, go, toast } from "../ui";

const EXAMPLES = [
  "Bill Sarah $300 for the logo design by Friday, half upfront",
  "Invoice Kola Fitness $1,200 for a landing page in 2 weeks",
  "Charge Bloom Café $450 for 10 Instagram posts by the end of the month, 30% upfront",
];
const DAY_MS = 86_400_000;

/** Types example sentences one letter at a time until the visitor starts typing. */
function useTypewriter(active: boolean) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(EXAMPLES[0]);
      return;
    }
    let ex = 0, i = 0, pause = 0;
    const t = setInterval(() => {
      if (pause > 0) { pause--; return; }
      const full = EXAMPLES[ex];
      if (i <= full.length) { setText(full.slice(0, i)); i++; if (i > full.length) pause = 45; }
      else { ex = (ex + 1) % EXAMPLES.length; i = 0; pause = 6; }
    }, 42);
    return () => clearInterval(t);
  }, [active]);
  return text;
}

export function Home() {
  const { accountId, connect } = useWallet();
  const [sentence, setSentence] = useState("");
  const [touched, setTouched] = useState(false);
  const typed = useTypewriter(!touched);
  const shown = touched ? sentence : typed;
  const p = parseInvoice(shown);
  const [trying, setTrying] = useState<"" | "invoice" | "project">("");

  const send = async () => {
    const q = new URLSearchParams();
    if (p.client) q.set("client", p.client);
    if (p.title) q.set("title", p.title);
    if (p.amount) q.set("amount", p.amount);
    if (p.upfrontPercent) q.set("upfront", String(p.upfrontPercent));
    if (p.dueInDays) q.set("due", String(p.dueInDays));
    if (!accountId) await connect();
    go(`/new${q.toString() ? `?${q}` : ""}`);
  };
  const tryDemo = async (kind: "invoice" | "project") => {
    setTrying(kind);
    try {
      const { invoice_id } = (await relay({ method: "demo_create", kind })) as unknown as { invoice_id: string };
      go(`/i/${invoice_id}`);
    } catch (e) {
      toast(`Couldn't start the demo: ${errText(e)}`);
    } finally {
      setTrying("");
    }
  };

  return (
    <main className="wrap wide home2">
      <section className="hero2">
        <div className="hero2-text">
          <span className="eyebrow">Escrow invoices on NEAR</span>
          <h1>Get paid <span className="accent">before</span> you start.</h1>
          <p className="lead">
            Send a link. Your client pays with any crypto, no account needed. The money is locked by a smart contract and
            released the moment they approve your work.
          </p>
          <div className="composer">
            <label htmlFor="sentence">Describe the job in one sentence</label>
            <textarea id="sentence" rows={2} value={shown}
              onFocus={() => { if (!touched) { setTouched(true); setSentence(""); } }}
              onChange={(e) => { setTouched(true); setSentence(e.target.value); }} />
            <div className="composer-actions">
              <button className="btn gold" onClick={send}>Send this invoice →</button>
              <span className="muted small">Free. You don't need any crypto to start.</span>
            </div>
          </div>
          {config.demoFreelancer && (
            <div className="try-row">
              <button className="linkish" disabled={!!trying} onClick={() => tryDemo("invoice")}>
                <Busy busy={trying === "invoice"}>▶ Try it as a client</Busy>
              </button>
              <span className="muted">·</span>
              <button className="linkish" disabled={!!trying} onClick={() => tryDemo("project")}>
                <Busy busy={trying === "project"}>▶ Try a 4-post project paid in batches</Busy>
              </button>
              <span className="muted small">No wallet needed, about 60 seconds.</span>
            </div>
          )}
        </div>
        <InvoiceCard client={p.client} title={p.title} amount={p.amount} days={p.dueInDays} upfront={p.upfrontPercent ?? 0} />
      </section>

      <LiveNetwork />
      <Protection />
    </main>
  );
}

// ---------------------------------------------------------------- the 3D invoice

function InvoiceCard({ client, title, amount, days, upfront }: { client?: string; title?: string; amount?: string; days?: number; upfront: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const units = amount ? toUnits(amount) : null;
  const total = units ? BigInt(units) : null;
  const up = total ? (total * BigInt(upfront)) / 100n : 0n;
  const due = new Date(Date.now() + (days ?? 7) * DAY_MS);

  // Tilt toward the pointer (or the phone's angle), like a card held in the hand.
  const tilt = (x: number, y: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", `${(-y * 12).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(x * 14).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${50 + x * 60}%`);
    el.style.setProperty("--gy", `${50 + y * 60}%`);
  };
  return (
    <div className="invoice-stage"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        tilt((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => tilt(0, 0)}>
      <div className="invoice3d" ref={ref}>
        <div className="inv-sheen" />
        <div className="inv-head">
          <div><b className="inv-logo">Pay<span>Pact</span></b><div className="muted small">Invoice · draft</div></div>
          <div className="inv-due"><span className="muted small">Due</span><b>{due.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b></div>
        </div>
        <div className="inv-parties">
          <div><span className="muted small">From</span><b>You</b></div>
          <div><span className="muted small">Billed to</span><b key={client} className="pop">{client || "Your client"}</b></div>
        </div>
        <div className="inv-line">
          <span>{title || "What it's for"}</span>
          <b key={amount} className="pop tnum">{total ? formatUsd(total, { cents: true }) : "$0.00"}</b>
        </div>
        {total && upfront > 0 && upfront < 100 && (
          <div className="inv-split pop">
            <div className="bar"><span style={{ width: `${upfront}%` }} /></div>
            <div className="row small" style={{ justifyContent: "space-between" }}>
              <span>💸 {formatUsd(up, { cents: true })} up front</span>
              <span>🔒 {formatUsd(total - up, { cents: true })} held</span>
            </div>
          </div>
        )}
        <div className="inv-pay">
          <span className="muted small">Client pays with</span>
          <div className="coins-row">{["USDC", "USDT", "ETH", "SOL", "BTC", "NEAR"].map((c) => <span key={c}>{c}</span>)}</div>
        </div>
        <div className="inv-foot muted small">Held by contract {config.contract.split(".")[0]}… on NEAR · released on approval</div>
        {total && (
          <div className="seal" key={`seal-${amount}`} aria-label="Locked in escrow">
            <svg viewBox="0 0 120 120" width="112" height="112">
              <defs><path id="sealcircle" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" /></defs>
              <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" strokeWidth="3" />
              <circle cx="60" cy="60" r="34" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 4" />
              <text fontSize="11.5" fontWeight="800" letterSpacing="2.5" fill="currentColor"><textPath href="#sealcircle">LOCKED IN ESCROW · NEAR ·</textPath></text>
              <g className="seal-lock" transform="translate(60 62)">
                <path className="shackle" d="M-9,-6 v-7 a9,9 0 0,1 18,0 v7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                <rect x="-13" y="-6" width="26" height="20" rx="4" fill="currentColor" />
              </g>
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- live network

function LiveNetwork() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => networkStats().then((s) => live && setStats(s)).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return (
    <section className="panel2 network">
      <header className="panel2-head">
        <div>
          <h2>Live on NEAR {config.network}</h2>
          <p className="muted small">Read straight from the PayPact contract, including demo traffic. Nobody can edit these numbers.</p>
        </div>
        <span className="live-dot">Live</span>
      </header>
      <div className="kpis">
        <div><span className="muted small">Locked in escrow now</span><b className="tnum">{stats ? formatUsd(stats.lockedNow) : <span className="shimmer" />}</b></div>
        <div><span className="muted small">Paid out to freelancers</span><b className="tnum">{stats ? formatUsd(stats.paidOut) : <span className="shimmer" />}</b></div>
        <div><span className="muted small">Invoices created</span><b className="tnum">{stats ? stats.invoices.toLocaleString() : <span className="shimmer" />}</b></div>
      </div>
      <ul className="activity">
        {stats?.recent.map((inv, i) => (
          <li key={inv.id} style={{ animationDelay: `${i * 60}ms` }}>
            <a href={`#/i/${inv.project ? inv.project.id : inv.id}`}>
              <span className="tnum muted">#{inv.id}</span>
              <span className="act-title">{inv.project ? `${inv.project.title} · ${inv.title}` : inv.title}<span className="muted small"> · {displayName(inv.freelancer)}</span></span>
              <b className="tnum">{formatUsd(inv.amount)}</b>
              <StatusBadge status={inv.status} />
              <span className="muted small act-time">{ago(inv.delivered_at ?? inv.funded_at ?? inv.created_at)}</span>
            </a>
          </li>
        ))}
        {!stats && Array.from({ length: 4 }, (_, i) => <li key={i}><span className="shimmer wide" /></li>)}
      </ul>
      <a className="small" href={`${config.explorer}/address/${config.contract}`} target="_blank" rel="noreferrer">Verify on the NEAR explorer ↗</a>
    </section>
  );
}

// ---------------------------------------------------------------- protection table

const RULES: [string, string, string][] = [
  ["The client approves the work", "You're paid in seconds", "Smart contract"],
  ["The client goes quiet", "You're paid automatically when the review window ends", "Smart contract"],
  ["Nothing is delivered by the due date", "The client can take a full refund", "Smart contract"],
  ["You disagree about the work", "Agree a split, ask your referee, or it's split 50/50 after the timeout", "Smart contract"],
  ["Your AI assistant is tricked", "It still can't move money: its key can only draft invoices", "NEAR access keys"],
  ["The client changes phones", "Their private control link restores approve and dispute", "Signed messages"],
];

function Protection() {
  return (
    <section className="panel2">
      <header className="panel2-head">
        <div>
          <h2>What happens if…</h2>
          <p className="muted small">Every outcome is decided by code on NEAR, not by PayPact. Not even we can take the money.</p>
        </div>
      </header>
      <div className="rules">
        {RULES.map(([cond, result, by]) => (
          <div key={cond} className="rule">
            <span className="rule-if">{cond}</span>
            <span className="rule-then">→ {result}</span>
            <span className="rule-by">{by}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
