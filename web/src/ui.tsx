import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { config } from "./lib/config";
import type { Invoice, Status } from "./lib/near";
import { useWallet } from "./lib/wallet";

export const go = (path: string) => {
  location.hash = path;
};

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const set = document.documentElement.getAttribute("data-theme");
  return set === "dark" ? "dark" : "light";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("paypact:theme", next);
    } catch {
      /* the choice just won't be remembered */
    }
    setTheme(next);
  };
  return (
    <button className="theme-toggle" onClick={flip} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Light mode" : "Dark mode"}>
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

export function Header() {
  const { accountId, connect, disconnect } = useWallet();
  return (
    <header className="header">
      <a className="logo" href="#/">
        <img src="/favicon.svg" alt="" />
        <b>Pay<span>Pact</span></b>
      </a>
      <nav className="nav">
        {config.network === "testnet" && <span className="net">testnet</span>}
        <ThemeToggle />
        {accountId ? (
          <>
            <a className="btn small ghost" href="#/me">Invoices</a>
            <button className="btn small ghost" onClick={disconnect} title={accountId}>
              Sign out
            </button>
          </>
        ) : (
          <button className="btn small" onClick={connect} title="Freelancer sign in">
            Sign in
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
    QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: "#111111", light: "#ffffff" } }).then(setSrc);
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
export const telegramUrl = (text: string, url: string) =>
  `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
export const xUrl = (text: string, url?: string) =>
  `https://x.com/intent/post?text=${encodeURIComponent(text)}${url ? `&url=${encodeURIComponent(url)}` : ""}`;

/** WhatsApp, Telegram and X, plus copy link. */
export function ShareButtons({ text, url, xText }: { text: string; url: string; xText?: string }) {
  return (
    <div className="stack">
      <div className="row">
        <a className="btn whatsapp grow" href={whatsappUrl(`${text} ${url}`)} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="btn telegram grow" href={telegramUrl(text, url)} target="_blank" rel="noreferrer">Telegram</a>
        <a className="btn x grow" href={xUrl(xText ?? text, url)} target="_blank" rel="noreferrer">𝕏 Post</a>
      </div>
      <button className="btn ghost block" onClick={() => navigator.clipboard.writeText(url).then(() => toast("Link copied"))}>
        Copy link
      </button>
    </div>
  );
}

/** A polite reminder written as PayPact, sent by WhatsApp or Telegram. */
export function NudgeButtons({ label, text, url }: { label: string; text: string; url: string }) {
  return (
    <div>
      <p className="small muted" style={{ marginBottom: 6 }}>💬 {label}</p>
      <div className="row">
        <a className="btn small whatsapp grow" href={whatsappUrl(`${text} ${url}`)} target="_blank" rel="noreferrer">WhatsApp</a>
        <a className="btn small telegram grow" href={telegramUrl(text, url)} target="_blank" rel="noreferrer">Telegram</a>
      </div>
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
