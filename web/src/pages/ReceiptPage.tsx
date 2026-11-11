import { useEffect, useState } from "react";
import { accountUrl, config, displayName } from "../lib/config";
import { formatUsd, nsToDate } from "../lib/money";
import { getInvoice, getProject, heldAmount, type Invoice } from "../lib/near";

const STATUS_TEXT: Record<string, string> = {
  AwaitingPayment: "Not paid yet",
  Funded: "Paid, held in escrow",
  Delivered: "Paid, work delivered, in review",
  Disputed: "Paid, in dispute",
  Released: "Paid in full to the freelancer",
  Refunded: "Refunded to the client",
  Split: "Settled by agreed split",
  Cancelled: "Cancelled",
};

const when = (ns: string | null) =>
  ns ? nsToDate(ns).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

/** A printable receipt: the browser's "Save as PDF" turns it into a file for the books. */
export function ReceiptPage({ id }: { id: string }) {
  const [inv, setInv] = useState<Invoice | null | undefined>(undefined);
  const [ms, setMs] = useState<Invoice[] | null>(null);
  useEffect(() => {
    getInvoice(id)
      .then(async (i) => {
        if (i?.project) setMs(await getProject(i.project.id));
        setInv(i);
      })
      .catch(() => setInv(null));
  }, [id]);

  if (inv === undefined) return <main className="wrap"><div className="card center"><span className="spinner dark" /></div></main>;
  if (inv === null) return <main className="wrap"><div className="card center">Invoice not found.</div></main>;
  const project = inv.project && ms ? { ...inv.project, ms } : null;

  const up = BigInt(inv.upfront);
  const invoiceUrl = `${location.origin}${location.pathname}#/i/${inv.id}`;
  return (
    <main className="wrap receipt-wrap">
      <div className="row no-print" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <a href={`#/i/${inv.id}`}>← Back to invoice</a>
        <button className="btn" onClick={() => window.print()}>Download PDF / Print</button>
      </div>
      <article className="receipt">
        <header className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="receipt-logo">Pay<span>Pact</span></div>
            <div className="muted small">Escrowed invoices on NEAR</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="receipt-title">Receipt</div>
            <div className="muted small">{project ? `Project #${project.id} · ${project.count} milestones` : `Invoice #${inv.id}`}</div>
            {config.network !== "mainnet" && <div className="muted small">Testnet (test money)</div>}
          </div>
        </header>

        <section className="receipt-grid">
          <div><div className="muted small">From (freelancer)</div><b>{displayName(inv.freelancer)}</b><div className="muted small mono">{inv.freelancer}</div></div>
          <div><div className="muted small">Status</div><b>{project
            ? `${project.ms.filter((m) => ["Released", "Split", "Refunded"].includes(m.status)).length} of ${project.count} milestones settled`
            : STATUS_TEXT[inv.status]}</b></div>
        </section>

        <table className="receipt-table">
          <thead><tr><th>Description</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          {project ? (
            <>
              <tbody>
                <tr><td colSpan={2}><b>{project.title}</b></td></tr>
                {project.ms.map((m, i) => (
                  <tr key={m.id}>
                    <td>
                      {i + 1}. {m.title}
                      <div className="muted small">Due {when(m.due_at)} · {STATUS_TEXT[m.status]}{m.delivered_at ? ` · delivered ${when(m.delivered_at)}` : ""}</div>
                      {m.delivery?.link && <div className="mono">{m.delivery.link}</div>}
                    </td>
                    <td style={{ textAlign: "right" }}>{formatUsd(m.amount, { cents: true })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total ({config.symbol})</td><td style={{ textAlign: "right" }}>{formatUsd(project.total, { cents: true })}</td></tr></tfoot>
            </>
          ) : (<>
          <tbody>
            <tr><td>{inv.title}</td><td style={{ textAlign: "right" }}>{formatUsd(inv.amount, { cents: true })}</td></tr>
            {up > 0n && <tr className="muted"><td>· Paid up front to the freelancer</td><td style={{ textAlign: "right" }}>{formatUsd(inv.upfront, { cents: true })}</td></tr>}
            {up < BigInt(inv.amount) && <tr className="muted"><td>· Held in escrow until approval</td><td style={{ textAlign: "right" }}>{formatUsd(heldAmount(inv), { cents: true })}</td></tr>}
          </tbody>
          <tfoot><tr><td>Total ({config.symbol})</td><td style={{ textAlign: "right" }}>{formatUsd(inv.amount, { cents: true })}</td></tr></tfoot>
          </>)}
        </table>

        <section className="receipt-grid">
          <div><div className="muted small">Issued</div>{when(inv.created_at)}</div>
          <div><div className="muted small">Paid</div>{when(inv.funded_at)}</div>
          {!project && <div><div className="muted small">Work delivered</div>{when(inv.delivered_at)}</div>}
          <div><div className="muted small">{project ? "Last milestone due" : "Due"}</div>{when(project ? project.ms[project.ms.length - 1].due_at : inv.due_at)}</div>
        </section>

        {!project && inv.delivery?.link && (
          <p className="small"><span className="muted">Proof of delivery:</span> <span className="mono">{inv.delivery.link}</span></p>
        )}

        <footer className="receipt-foot small muted">
          Settled by the PayPact smart contract <span className="mono">{config.contract}</span> on NEAR {config.network}.
          Every amount and date above is read from the blockchain and can be checked at{" "}
          <a href={accountUrl(config.contract)}>{accountUrl(config.contract).replace(/^https:\/\//, "")}</a>.
          <br />Invoice: {invoiceUrl}
        </footer>
      </article>
    </main>
  );
}
