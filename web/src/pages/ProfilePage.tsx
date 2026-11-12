import { useEffect, useState } from "react";
import { formatUsd, nsToDate } from "../lib/money";
import { getInvoicesFor, getProfile, type Invoice, type Profile } from "../lib/near";
import { ShareButtons, Stars, shortDate } from "../ui";
import { displayName } from "../lib/config";

export function ProfilePage({ account }: { account: string }) {
  const [data, setData] = useState<{ p: Profile; avg: number; invoices: Invoice[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([getProfile(account), getInvoicesFor(account)])
      .then(([[p, avg], invoices]) => setData({ p, avg, invoices }))
      .catch(() => setError(true));
  }, [account]);

  if (error) return <main className="wrap"><div className="card center">Couldn't load this profile.</div></main>;
  if (!data) return <main className="wrap"><div className="card center"><span className="spinner dark" /></div></main>;

  const { p, avg, invoices } = data;
  const reviews = invoices.filter((i) => i.rating).sort((a, b) => Number(BigInt(b.rating!.at) - BigInt(a.rating!.at)));
  const onTime = p.delivered ? Math.round((p.delivered_on_time / p.delivered) * 100) : null;
  const url = `${location.origin}${location.pathname}#/p/${account}`;

  return (
    <main className="wrap">
      <div className="card">
        <p className="muted small" style={{ marginBottom: 2 }}>Freelancer on PayPact</p>
        <h2>{displayName(account)}</h2>
        {displayName(account) !== account && <p className="muted small" style={{ marginTop: -6 }}>{account}</p>}
        <Stars value={avg / 100} count={p.rating_count} />
        <div className="stats" style={{ marginTop: 16 }}>
          <div className="stat"><b>{p.completed + p.split}</b><span className="muted small">deliveries paid out</span></div>
          <div className="stat"><b>{formatUsd(p.total_earned)}</b><span className="muted small">earned</span></div>
          <div className="stat"><b>{onTime === null ? "—" : `${onTime}%`}</b><span className="muted small">delivered on time</span></div>
          <div className="stat"><b>{p.disputed}</b><span className="muted small">{p.disputed === 1 ? "dispute" : "disputes"}</span></div>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Every number here comes from real payments on the NEAR blockchain. Only clients who paid can leave a rating, and nobody can edit or delete them.
        </p>
      </div>

      <div className="card">
        <h3>What clients say</h3>
        {reviews.length === 0 && <p className="muted">No ratings yet.</p>}
        {reviews.length > 0 && (
          <p className="hint" style={{ marginTop: -4 }}>
            Each rating comes from a client who paid that exact job through escrow, so you can see what every review cost. A row of tiny jobs is easy to spot.
          </p>
        )}
        <div className="list">
          {reviews.map((i) => (
            <div key={i.id} className="item">
              <div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <Stars value={i.rating!.stars} />
                  <span className="badge ok">✓ Paid {formatUsd(i.project ? i.project.total : i.amount)} {i.project ? `project (${i.project.count} milestones)` : "job"}</span>
                </div>
                {i.rating!.comment && <div>"{i.rating!.comment}"</div>}
                <div className="muted small">{i.project ? i.project.title : i.title} · {shortDate(nsToDate(i.rating!.at))} · <a href={`#/i/${i.project ? i.project.id : i.id}`}>{i.project ? "project" : "invoice"} #{i.project ? i.project.id : i.id}</a></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card soft">
        <h3>Share this profile</h3>
        <ShareButtons text={`My verified track record on PayPact: ${p.completed + p.split} deliveries paid${p.rating_count ? `, ${(avg / 100).toFixed(1)}★` : ""}.`} url={url} />
      </div>
    </main>
  );
}
