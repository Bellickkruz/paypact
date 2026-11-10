import { useEffect, useState } from "react";
import { formatUsd, nsToDate } from "../lib/money";
import { getInvoicesFor, heldAmount, type Invoice } from "../lib/near";
import { disableAssistant, enableAssistant, loadAssistantKey } from "../lib/assistant";
import { useWallet } from "../lib/wallet";
import { StatusBadge, errText, shortDate, toast } from "../ui";

export function Dashboard() {
  const { accountId, connect } = useWallet();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [assistant, setAssistant] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    setAssistant(!!loadAssistantKey(accountId));
    const load = () => getInvoicesFor(accountId).then(setInvoices).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [accountId]);

  if (!accountId) {
    return (
      <main className="wrap">
        <div className="card center stack">
          <h2>Sign in to see your invoices</h2>
          <button className="btn big" onClick={() => connect()}>Connect wallet</button>
        </div>
      </main>
    );
  }

  const list = (invoices ?? []).slice().reverse();
  const sum = (f: (i: Invoice) => boolean, amount: (i: Invoice) => string = (i) => i.amount) =>
    list.filter(f).reduce((s, i) => s + BigInt(amount(i)), 0n);
  const locked = sum((i) => i.status === "Funded" || i.status === "Delivered" || i.status === "Disputed", heldAmount);
  const waiting = sum((i) => i.status === "AwaitingPayment");
  const paid = sum((i) => i.status === "Released");

  return (
    <main className="wrap">
      <div className="row" style={{ justifyContent: "space-between", margin: "12px 0" }}>
        <h2 style={{ margin: 0 }}>My invoices</h2>
        <a className="btn gold" href="#/new">+ New invoice</a>
      </div>
      <div className="stats">
        <div className="stat"><b>{formatUsd(locked)}</b><span className="muted small">🔒 locked for you</span></div>
        <div className="stat"><b>{formatUsd(waiting)}</b><span className="muted small">awaiting payment</span></div>
        <div className="stat"><b>{formatUsd(paid)}</b><span className="muted small">paid out</span></div>
        <a className="stat" href={`#/p/${accountId}`} style={{ textDecoration: "none", color: "inherit" }}><b>→</b><span className="muted small">my public profile</span></a>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        {invoices === null && <span className="spinner dark" />}
        {invoices?.length === 0 && <p className="muted">No invoices yet. <a href="#/new">Create your first one.</a></p>}
        <div className="list">
          {list.map((i) => (
            <a key={i.id} className="item" href={`#/i/${i.id}`}>
              <div>
                <b>{i.title}</b>
                <div className="muted small">#{i.id} · due {shortDate(nsToDate(i.due_at))}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div><b>{formatUsd(i.amount, { cents: true })}</b></div>
                <StatusBadge status={i.status} />
              </div>
            </a>
          ))}
        </div>
      </div>

      <div className="card soft">
        <h3>Invoice assistant</h3>
        <p className="muted small">
          {assistant
            ? "On. It can create invoices and mark work delivered without wallet pop-ups. It holds a key NEAR won't let near your money."
            : "Off. Turn it on to send invoices without a wallet pop-up each time."}
        </p>
        <button
          className="btn small ghost"
          onClick={async () => {
            try {
              if (assistant) {
                disableAssistant(accountId);
                setAssistant(false);
              } else {
                await enableAssistant(accountId);
                setAssistant(true);
                toast("Assistant on");
              }
            } catch (e) {
              toast(errText(e));
            }
          }}
        >
          {assistant ? "Turn off on this device" : "Turn on"}
        </button>
      </div>
    </main>
  );
}
