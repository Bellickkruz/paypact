import { useWallet } from "../lib/wallet";
import { go } from "../ui";

export function Home() {
  const { accountId, connect } = useWallet();
  const start = async () => {
    if (!accountId) await connect();
    go("/new");
  };
  return (
    <main className="wrap wide">
      <section className="hero">
        <h1>Get paid <span className="accent">safely.</span><br />From anyone. On any crypto.</h1>
        <p className="lead">
          Send your client a link. They pay with whatever crypto they already have, on any chain. The money is locked
          for you before you start, and released the moment they approve.
        </p>
        <div className="row">
          <button className="btn big gold" onClick={start}>Create a free invoice</button>
          <span className="muted small">No fees from PayPact. No account for your client.</span>
        </div>
      </section>

      <section className="steps3" style={{ marginTop: 28 }}>
        <div className="card">
          <div className="num">1</div>
          <h3>Type one sentence</h3>
          <p className="muted">"Bill Sarah $300 for the logo by Friday, half upfront." Your invoice is ready.</p>
        </div>
        <div className="card">
          <div className="num">2</div>
          <h3>Client pays any way they like</h3>
          <p className="muted">USDC, USDT, ETH, SOL or BTC, on any chain. You see <b>"$300 locked for you"</b> before you start.</p>
        </div>
        <div className="card">
          <div className="num">3</div>
          <h3>Deliver, get paid</h3>
          <p className="muted">They approve and you're paid in seconds. Silent client? You're paid automatically after the review window.</p>
        </div>
      </section>

      <section className="grid2" style={{ marginTop: 16 }}>
        <div className="card dark">
          <h3>For freelancers</h3>
          <ul className="muted">
            <li>Never start work on a promise again</li>
            <li>No awkward chasing: polite reminders written for you, plus calendar alerts</li>
            <li>Ask for a deposit up front, if you agree one</li>
            <li>A track record clients can't fake or delete</li>
          </ul>
        </div>
        <div className="card gold">
          <h3>For clients</h3>
          <ul className="muted">
            <li>Your money is protected until you approve the work</li>
            <li>Refunded if the work is never delivered</li>
            <li>Pay with the crypto you already hold, no wallet setup</li>
            <li>See the freelancer's real ratings first</li>
          </ul>
        </div>
      </section>

      <section className="card soft center">
        <h3>Your AI assistant can never touch the money</h3>
        <p className="muted">
          Let the assistant write invoices and mark work delivered. It holds a key that can only do those two things.
          NEAR itself refuses anything else, so even a tricked assistant can't move a cent.
        </p>
      </section>
    </main>
  );
}
