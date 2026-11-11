// Read an invoice and its freelancer's profile straight from the PayPact contract on
// NEAR testnet, without the web app. No install needed (Node 18+, uses fetch).
//
//   node scripts/check-invoice.mjs <invoice-id> [contract]
//
// Example: create one with "Try it now" on https://paypact-alpha.vercel.app, then run
// this with the number shown on the invoice ("Invoice #12").
const [id, contract = "pact2.paypact-dev-mwaweex6.testnet"] = process.argv.slice(2);
if (!/^\d+$/.test(id ?? "")) {
  console.error("usage: node scripts/check-invoice.mjs <invoice-id> [contract]");
  process.exit(1);
}

async function view(method, args) {
  const res = await fetch("https://rpc.testnet.fastnear.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: {
        request_type: "call_function", finality: "optimistic", account_id: contract,
        method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const json = await res.json();
  if (json.error || json.result?.error) throw new Error(JSON.stringify(json.error ?? json.result.error));
  return JSON.parse(Buffer.from(json.result.result).toString());
}

const usd = (units) => `$${(Number(BigInt(units)) / 1e6).toFixed(2)}`;
const date = (ns) => (ns ? new Date(Number(BigInt(ns) / 1_000_000n)).toISOString() : "-");

const inv = await view("get_invoice", { invoice_id: id });
if (!inv) {
  console.log(`Invoice #${id} not found on ${contract}`);
  process.exit(1);
}
const [profile, avg] = await view("get_profile", { account_id: inv.freelancer });

console.log(`Invoice #${inv.id} on ${contract}`);
console.log(`  title        ${inv.title}`);
console.log(`  freelancer   ${inv.freelancer}`);
console.log(`  status       ${inv.status}`);
if (inv.project) console.log(`  project      #${inv.project.id} "${inv.project.title}": milestone ${inv.project.index + 1} of ${inv.project.count}, project total ${usd(inv.project.total)} paid once`);
console.log(`  amount       ${usd(inv.amount)}  (up front ${usd(inv.upfront)}, held in escrow ${usd(BigInt(inv.amount) - BigInt(inv.upfront))})`);
console.log(`  created      ${date(inv.created_at)}`);
console.log(`  paid         ${date(inv.funded_at)}`);
console.log(`  delivered    ${date(inv.delivered_at)}`);
if (inv.delivery) console.log(`  proof        ${inv.delivery.link ?? ""} ${inv.delivery.note ? `"${inv.delivery.note}"` : ""}`);
if (inv.dispute_reason) console.log(`  dispute      "${inv.dispute_reason}"`);
if (inv.rating) console.log(`  rating       ${"★".repeat(inv.rating.stars)} ${inv.rating.comment ? `"${inv.rating.comment}"` : ""}`);
console.log(`  client key   ${inv.client_key ?? "-"}  (set when paid; client actions must be signed by it)`);
console.log(`Freelancer profile: ${profile.completed} completed, ${profile.disputed} disputed, ` +
  `${profile.delivered_on_time}/${profile.delivered} on time, earned ${usd(profile.total_earned)}, ` +
  `rating ${profile.rating_count ? (avg / 100).toFixed(1) : "none"} (${profile.rating_count})`);
