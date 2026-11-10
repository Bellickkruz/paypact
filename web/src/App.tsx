import { useEffect, useState } from "react";
import { Header } from "./ui";
import { Home } from "./pages/Home";
import { NewInvoice } from "./pages/NewInvoice";
import { InvoicePage } from "./pages/InvoicePage";
import { ProfilePage } from "./pages/ProfilePage";
import { Dashboard } from "./pages/Dashboard";
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
  else if ((m = route.match(/^\/p\/([a-z0-9._-]+)$/))) page = <ProfilePage account={m[1]} />;
  else page = <Home />;
  return (
    <>
      <Header />
      {page}
      <footer>
        PayPact runs on a NEAR smart contract:{" "}
        <a href={accountUrl(config.contract)} target="_blank" rel="noreferrer">{config.contract}</a>.
        Nobody, not even PayPact, can take the money in it.
      </footer>
    </>
  );
}
