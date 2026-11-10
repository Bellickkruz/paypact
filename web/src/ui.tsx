import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { config } from "./lib/config";
import type { Invoice, Status } from "./lib/near";
import { useWallet } from "./lib/wallet";

export const go = (path: string) => {
  location.hash = path;
};

export function Header() {
  const { accountId, connect, disconnect } = useWallet();
  return (
    <header className="header">
      <a className="logo" href="#/">
        <img src="/favicon.svg" alt="" /> PayPact
      </a>
      <nav className="nav">
        {config.network === "testnet" && <span className="net">testnet</span>}
        {accountId ? (
          <>
            <a className="btn small ghost" href="#/me">My invoices</a>
            <button className="btn small ghost" onClick={disconnect} title={accountId}>
              Sign out
            </button>
          </>
        ) : (
          <button className="btn small" onClick={connect}>
            Freelancer sign in
          </button>
        )}
      </nav>
    </header>
  );
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  AwaitingPayment: { label: "Waiting for payment", cls: "wait" },
  Funded: { label: "🔒 Paid & locked", cls: "lock" },
  Delivered: { label: "📦 Delivered, in review", cls: "lock" },
  Disputed: { label: "⚠️ Problem reported", cls: "bad" },
  Released: { label: "✅ Paid out", cls: "ok" },
  Refunded: { label: "↩️ Refunded", cls: "off" },
  Split: { label: "⚖️ Settled", cls: "ok" },
  Cancelled: { label: "Cancelled", cls: "off" },
};

export const StatusBadge = ({ status }: { status: Status }) => (
  <span className={`badge ${STATUS[status].cls}`}>{STATUS[status].label}</span>
);

export function Timeline({ inv }: { inv: Invoice }) {
  const s = inv.status;
  const paid = s !== "AwaitingPayment" && s !== "Cancelled";
  const delivered = ["Delivered", "Disputed", "Released", "Split"].includes(s) && !!inv.delivered_at;
  const done = ["Released", "Split", "Refunded"].includes(s);
  const steps = [
    { label: "Invoice sent", done: true },
    { label: "Paid & locked", done: paid },
    { label: "Work delivered", done: delivered || (done && s === "Released") },
    { label: s === "Refunded" ? "Refunded" : "Paid out", done },
  ];
  const nowIndex = steps.findIndex((x) => !x.done);
  return (
    <div className="timeline">
      {steps.map((st, i) => (
        <div key={st.label} className={`step ${st.done ? "done" : ""} ${i === nowIndex ? "now" : ""}`}>
          <div className="dot">{st.done ? "✓" : ""}</div>
          {st.label}
        </div>
      ))}
    </div>
  );
}

export function Stars({ value, count }: { value: number; count?: number }) {
  // No ratings yet reads as "new", not as zero stars.
  if (count === 0) return <span className="badge wait">New on PayPact</span>;
  const full = Math.round(value);
  return (
    <span>
      <span className="stars">{"★".repeat(full)}{"☆".repeat(5 - full)}</span>{" "}
      {count !== undefined && <span className="muted small">{value ? value.toFixed(1) : "No ratings"}{count ? ` (${count})` : ""}</span>}
    </span>
  );
}

export function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: "#0f3d2e" } }).then(setSrc);
  }, [text]);
  return <div className="qr">{src && <img src={src} alt="QR code" />}</div>;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  let el = document.querySelector<HTMLDivElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el && (el.style.display = "none"), 2600);
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  return (
    <div>
      {label && <label>{label}</label>}
      <div className="copy">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn small ghost"
          onClick={() => navigator.clipboard.writeText(value).then(() => toast("Copied"))}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const xUrl = (text: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;

export function ShareButtons({ text, url }: { text: string; url: string }) {
  const full = `${text} ${url}`;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div className="row">
      <a className="btn whatsapp grow" href={whatsappUrl(full)} target="_blank" rel="noreferrer">
        Send on WhatsApp
      </a>
      {canShare && (
        <button className="btn ghost grow" onClick={() => navigator.share({ text, url }).catch(() => {})}>
          Share…
        </button>
      )}
      <button className="btn ghost grow" onClick={() => navigator.clipboard.writeText(url).then(() => toast("Link copied"))}>
        Copy link
      </button>
    </div>
  );
}

export function Busy({ busy, children }: { busy: boolean; children: ReactNode }) {
  return busy ? <span className="spinner" /> : <>{children}</>;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const shortDate = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
export const errText = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  const panic = m.match(/Smart contract panicked: ([^"\\]+)/) ?? m.match(/"([A-Z][^"\\]{6,120})"/);
  return panic ? panic[1] : m.slice(0, 200);
};
