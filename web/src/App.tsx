import { useEffect, useState } from "react";
import { Header } from "./ui";
import { Home } from "./pages/Home";
import { NewInvoice } from "./pages/NewInvoice";
import { InvoicePage } from "./pages/InvoicePage";
import { ProfilePage } from "./pages/ProfilePage";
import { Dashboard } from "./pages/Dashboard";
import { ReceiptPage } from "./pages/ReceiptPage";
import { config, accountUrl } from "./lib/config";

function useRoute() {
  const read = () => (location.hash.replace(/^#/, "").split("?")[0] || "/");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  let page;
  let m: RegExpMatchArray | null;
  if (route === "/new") page = <NewInvoice />;
  else if (route === "/me") page = <Dashboard />;
  else if ((m = route.match(/^\/i\/(\d+)$/))) page = <InvoicePage id={m[1]} />;
  else if ((m = route.match(/^\/r\/(\d+)$/))) page = <ReceiptPage id={m[1]} />;
  else if ((m = route.match(/^\/p\/([a-z0-9._-]+)$/))) page = <ProfilePage account={m[1]} />;
  else page = <Home />;
  return (
    <>
      <Header />
      {page}
      <footer className="site-footer">
        <div className="foot-brand"><img src="/favicon.svg" alt="" /> <b>Pay<span>Pact</span></b> <span className="muted">· escrow invoices on NEAR</span></div>
        <nav>
          <a href="https://github.com/Bellickkruz/paypact" target="_blank" rel="noreferrer">GitHub</a>
          <a href={accountUrl(config.contract)} target="_blank" rel="noreferrer">Contract</a>
          <a href="#/new">Create an invoice</a>
          <a href="#/me">My invoices</a>
        </nav>
        <p className="muted">
          PayPact runs on a NEAR smart contract (<span className="mono">{config.contract}</span>). Nobody, not even PayPact, can take the money in it.
        </p>
      </footer>
    </>
  );
}
