use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

const DAY: u64 = NS_PER_DAY;
const USDC: &str = "usdc.near";
const AMOUNT: u128 = 300_000_000; // 300 USDC (6 decimals)

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn set_ctx(predecessor: &str, deposit_yocto: u128, now: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc("escrow.near"))
        .predecessor_account_id(acc(predecessor))
        .attached_deposit(NearToken::from_yoctonear(deposit_yocto))
        .block_timestamp(now)
        .build());
}

struct Client {
    key: SigningKey,
}

impl Client {
    fn new() -> Self {
        Self { key: SigningKey::generate(&mut rand::rngs::OsRng) }
    }
    fn public(&self) -> String {
        format!("ed25519:{}", near_sdk::bs58::encode(self.key.verifying_key().to_bytes()).into_string())
    }
    fn sign(&self, c: &Contract, id: u64, action: &ClientAction) -> String {
        let msg = c.action_message(U64(id), action.clone());
        near_sdk::bs58::encode(self.key.sign(msg.as_bytes()).to_bytes()).into_string()
    }
}

fn setup() -> (Contract, u64) {
    set_ctx("owner.near", 0, 0);
    let mut c = Contract::new(acc("owner.near"), vec![acc(USDC)]);
    set_ctx("tolu.near", 0, 0);
    let id = c.create_invoice(acc(USDC), U128(AMOUNT), "Logo design".into(), 7, None, None, Some(acc("judge.near")), None);
    (c, id.0)
}

fn pay(c: &mut Contract, id: u64, client: &Client, amount: u128, refund_to: Option<&str>) -> u128 {
    set_ctx(USDC, 0, DAY);
    let msg = near_sdk::serde_json::json!({
        "invoice_id": U64(id), "client_key": client.public(), "refund_to": refund_to
    })
    .to_string();
    match c.ft_on_transfer(acc("intents.near"), U128(amount), msg) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("expected value"),
    }
}

fn act(c: &mut Contract, id: u64, client: &Client, action: ClientAction, now: u64) {
    let sig = client.sign(c, id, &action);
    set_ctx("relayer.near", 0, now);
    let _ = c.client_action(U64(id), action, sig);
}

fn status(c: &Contract, id: u64) -> Status {
    c.get_invoice(U64(id)).unwrap().status
}

#[test]
fn happy_path_client_approves() {
    let (mut c, id) = setup();
    let client = Client::new();
    assert_eq!(pay(&mut c, id, &client, AMOUNT, None), 0);
    assert_eq!(status(&c, id), Status::Funded);

    set_ctx("tolu.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), None, None);
    act(&mut c, id, &client, ClientAction::Approve, 3 * DAY);
    assert_eq!(status(&c, id), Status::Released);
    assert!(get_logs().iter().any(|l| l.contains("to_freelancer=300000000")));
}

#[test]
fn payment_rejected_for_wrong_token_short_amount_or_bad_msg() {
    let (mut c, id) = setup();
    let client = Client::new();
    // Short payment: everything refunded, invoice stays unpaid.
    assert_eq!(pay(&mut c, id, &client, AMOUNT - 1, None), AMOUNT - 1);
    assert_eq!(status(&c, id), Status::AwaitingPayment);
    // Wrong token.
    set_ctx("fake-usdc.near", 0, DAY);
    let msg = near_sdk::serde_json::json!({ "invoice_id": U64(id), "client_key": client.public() }).to_string();
    assert!(matches!(c.ft_on_transfer(acc("x.near"), U128(AMOUNT), msg), PromiseOrValue::Value(v) if v.0 == AMOUNT));
    // Garbage msg.
    set_ctx(USDC, 0, DAY);
    assert!(matches!(c.ft_on_transfer(acc("x.near"), U128(AMOUNT), "hi".into()), PromiseOrValue::Value(v) if v.0 == AMOUNT));
    assert_eq!(status(&c, id), Status::AwaitingPayment);
}

#[test]
fn overpayment_returns_excess_and_second_payment_is_refunded() {
    let (mut c, id) = setup();
    let client = Client::new();
    assert_eq!(pay(&mut c, id, &client, AMOUNT + 5, None), 5);
    assert_eq!(pay(&mut c, id, &Client::new(), AMOUNT, None), AMOUNT);
    assert_eq!(c.get_invoice(U64(id)).unwrap().client_key, Some(client.public()));
}

#[test]
#[should_panic(expected = "Invalid client signature")]
fn signature_from_another_key_is_rejected() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, None);
    let attacker = Client::new();
    let sig = attacker.sign(&c, id, &ClientAction::Approve);
    set_ctx("relayer.near", 0, 2 * DAY);
    let _ = c.client_action(U64(id), ClientAction::Approve, sig);
}

#[test]
#[should_panic(expected = "Invalid client signature")]
fn signatures_cannot_be_replayed() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, Some("sarah.near"));
    let sig = client.sign(&c, id, &ClientAction::SetRefundAccount { account: acc("sarah.near") });
    set_ctx("relayer.near", 0, 2 * DAY);
    let _ = c.client_action(U64(id), ClientAction::SetRefundAccount { account: acc("sarah.near") }, sig.clone());
    let _ = c.client_action(U64(id), ClientAction::SetRefundAccount { account: acc("sarah.near") }, sig);
}

#[test]
fn silent_client_auto_releases_after_review_window() {
    let (mut c, id) = setup();
    pay(&mut c, id, &Client::new(), AMOUNT, None);
    set_ctx("tolu.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), None, None);
    set_ctx("anyone.near", 0, 7 * DAY); // delivered day 2 + 5-day window
    let _ = c.release_after_review(U64(id));
    assert_eq!(status(&c, id), Status::Released);
}

#[test]
#[should_panic(expected = "Review window is still open")]
fn cannot_auto_release_early() {
    let (mut c, id) = setup();
    pay(&mut c, id, &Client::new(), AMOUNT, None);
    set_ctx("tolu.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), None, None);
    set_ctx("anyone.near", 0, 6 * DAY);
    let _ = c.release_after_review(U64(id));
}

#[test]
fn dispute_then_agreed_split() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, Some("sarah.near"));
    set_ctx("tolu.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), None, None);
    act(&mut c, id, &client, ClientAction::Dispute { reason: "Wrong colours".into() }, 3 * DAY);
    assert_eq!(status(&c, id), Status::Disputed);

    act(&mut c, id, &client, ClientAction::ProposeSplit { to_freelancer: U128(200_000_000) }, 3 * DAY);
    set_ctx("tolu.near", 1, 4 * DAY);
    let _ = c.accept_split(U64(id));
    assert_eq!(status(&c, id), Status::Split);
    assert!(get_logs().iter().any(|l| l.contains("to_freelancer=200000000 to_client=100000000")));
}

#[test]
fn arbiter_decides_dispute() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, Some("sarah.near"));
    set_ctx("tolu.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), None, None);
    act(&mut c, id, &client, ClientAction::Dispute { reason: "Incomplete".into() }, 3 * DAY);
    set_ctx("judge.near", 1, 4 * DAY);
    let _ = c.arbiter_resolve(U64(id), U128(250_000_000));
    assert_eq!(status(&c, id), Status::Split);
}

#[test]
fn stale_dispute_splits_50_50_and_holds_client_share_without_refund_account() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, None);
    set_ctx("tolu.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), None, None);
    act(&mut c, id, &client, ClientAction::Dispute { reason: "No".into() }, 3 * DAY);
    set_ctx("anyone.near", 0, 33 * DAY);
    let _ = c.resolve_stale_dispute(U64(id));
    let inv = c.get_invoice(U64(id)).unwrap();
    assert_eq!(inv.status, Status::Split);
    // No refund account yet: the client's half is held, not sent to a bridge.
    assert_eq!(inv.owed_client.0, AMOUNT / 2);

    act(&mut c, id, &client, ClientAction::SetRefundAccount { account: acc("sarah.near") }, 34 * DAY);
    set_ctx("anyone.near", 0, 34 * DAY);
    let _ = c.retry_payout(U64(id));
    assert_eq!(c.get_invoice(U64(id)).unwrap().owed_client.0, 0);
}

#[test]
fn undelivered_work_is_refunded_after_due_date_and_grace() {
    let (mut c, id) = setup(); // due day 7, grace 2 days
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, Some("sarah.near"));
    act(&mut c, id, &client, ClientAction::RefundUndelivered, 9 * DAY);
    assert_eq!(status(&c, id), Status::Refunded);
}

#[test]
#[should_panic(expected = "Due date and grace period have not passed")]
fn undelivered_refund_not_before_grace() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, Some("sarah.near"));
    act(&mut c, id, &client, ClientAction::RefundUndelivered, 8 * DAY);
}

#[test]
#[should_panic(expected = "Only delivered work can be disputed")]
fn cannot_dispute_before_delivery() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, None);
    act(&mut c, id, &client, ClientAction::Dispute { reason: "x".into() }, 2 * DAY);
}

// --- AI assistant safety: function-call keys cannot attach a deposit ---------

#[test]
fn ai_key_can_create_and_mark_delivered_without_deposit() {
    let (mut c, id) = setup();
    pay(&mut c, id, &Client::new(), AMOUNT, None);
    set_ctx("tolu.near", 0, 2 * DAY); // a function-call key sends no deposit
    c.mark_delivered(U64(id), None, None);
    let id2 = c.create_invoice(acc(USDC), U128(5_000_000), "Banner".into(), 3, None, None, None, None);
    assert_eq!(status(&c, id2.0), Status::AwaitingPayment);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn ai_key_cannot_refund_money() {
    let (mut c, id) = setup();
    pay(&mut c, id, &Client::new(), AMOUNT, Some("attacker.near"));
    set_ctx("tolu.near", 0, 2 * DAY); // no deposit: what a function-call key sends
    let _ = c.refund_client(U64(id));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn ai_key_cannot_accept_a_split() {
    let (mut c, id) = setup();
    set_ctx("tolu.near", 0, 2 * DAY);
    let _ = c.accept_split(U64(id));
}

#[test]
#[should_panic(expected = "Only the freelancer")]
fn strangers_cannot_mark_delivered() {
    let (mut c, id) = setup();
    pay(&mut c, id, &Client::new(), AMOUNT, None);
    set_ctx("mallory.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), None, None);
}

#[test]
#[should_panic(expected = "Token not supported")]
fn only_allowed_stablecoins() {
    let (mut c, _) = setup();
    set_ctx("tolu.near", 0, 0);
    c.create_invoice(acc("meme.near"), U128(1), "x".into(), 3, None, None, None, None);
}

// --- upfront payment ---------------------------------------------------------

fn setup_upfront(percent: u8) -> (Contract, u64) {
    set_ctx("owner.near", 0, 0);
    let mut c = Contract::new(acc("owner.near"), vec![acc(USDC)]);
    set_ctx("tolu.near", 0, 0);
    let id = c.create_invoice(acc(USDC), U128(AMOUNT), "Website".into(), 7, None, None, None, Some(percent));
    (c, id.0)
}

#[test]
fn half_upfront_pays_freelancer_at_funding_and_holds_the_rest() {
    let (mut c, id) = setup_upfront(50);
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, Some("sarah.near"));
    let inv = c.get_invoice(U64(id)).unwrap();
    assert_eq!(inv.status, Status::Funded);
    assert_eq!(inv.upfront.0, AMOUNT / 2);
    assert!(get_logs().iter().any(|l| l.contains("upfront=150000000")));
    // A full refund now only returns the held half.
    set_ctx("tolu.near", 1, 2 * DAY);
    let _ = c.refund_client(U64(id));
    assert!(get_logs().iter().any(|l| l.contains("to_freelancer=0 to_client=150000000")));
}

#[test]
fn full_upfront_is_a_direct_payment() {
    let (mut c, id) = setup_upfront(100);
    pay(&mut c, id, &Client::new(), AMOUNT, None);
    assert_eq!(status(&c, id), Status::Released);
    let (profile, _) = c.get_profile(acc("tolu.near"));
    assert_eq!(profile.completed, 1);
    assert_eq!(profile.total_earned.0, AMOUNT);
}

#[test]
#[should_panic(expected = "Upfront must be 0-100%")]
fn upfront_over_100_rejected() {
    setup_upfront(101);
}

// --- profile and ratings -----------------------------------------------------

#[test]
fn profile_tracks_jobs_on_time_delivery_and_rating() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, None);
    set_ctx("tolu.near", 0, 2 * DAY); // due day 7: on time
    c.mark_delivered(U64(id), None, None);
    act(&mut c, id, &client, ClientAction::Approve, 3 * DAY);
    act(&mut c, id, &client, ClientAction::Rate { stars: 5, comment: Some("Great logo!".into()) }, 3 * DAY);

    let (p, avg) = c.get_profile(acc("tolu.near"));
    assert_eq!((p.invoices_paid, p.completed, p.delivered, p.delivered_on_time), (1, 1, 1, 1));
    assert_eq!(p.total_earned.0, AMOUNT);
    assert_eq!((p.rating_count, avg), (1, 500));
    assert_eq!(c.get_invoice(U64(id)).unwrap().rating.unwrap().stars, 5);
}

#[test]
#[should_panic(expected = "Only a settled invoice can be rated")]
fn cannot_rate_before_settlement() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, None);
    act(&mut c, id, &client, ClientAction::Rate { stars: 5, comment: None }, 2 * DAY);
}

#[test]
#[should_panic(expected = "Already rated")]
fn can_rate_only_once() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, None);
    act(&mut c, id, &client, ClientAction::Approve, 2 * DAY);
    act(&mut c, id, &client, ClientAction::Rate { stars: 4, comment: None }, 2 * DAY);
    act(&mut c, id, &client, ClientAction::Rate { stars: 5, comment: None }, 2 * DAY);
}

#[test]
#[should_panic(expected = "Invalid client signature")]
fn only_the_paying_client_can_rate() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, None);
    act(&mut c, id, &client, ClientAction::Approve, 2 * DAY);
    act(&mut c, id, &Client::new(), ClientAction::Rate { stars: 1, comment: None }, 2 * DAY);
}

#[test]
fn late_delivery_and_disputes_show_in_profile() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, Some("sarah.near"));
    set_ctx("tolu.near", 0, 8 * DAY); // due day 7: late
    c.mark_delivered(U64(id), None, None);
    act(&mut c, id, &client, ClientAction::Dispute { reason: "Late".into() }, 9 * DAY);
    let (p, _) = c.get_profile(acc("tolu.near"));
    assert_eq!((p.delivered, p.delivered_on_time, p.disputed), (1, 0, 1));
}

// --- gasless: the relayer submits for a freelancer --------------------------

fn with_relayer() -> Contract {
    set_ctx("owner.near", 0, 0);
    let mut c = Contract::new(acc("owner.near"), vec![acc(USDC)]);
    set_ctx("owner.near", 1, 0);
    c.set_relayer(Some(acc("relayer.near")));
    c
}

#[test]
fn relayer_creates_and_delivers_for_freelancer() {
    let mut c = with_relayer();
    set_ctx("relayer.near", 0, 0);
    let id = c.create_invoice_for(acc("tolu.near"), acc(USDC), U128(AMOUNT), "Logo".into(), 7, None, None, None, None).0;
    assert_eq!(c.get_invoice(U64(id)).unwrap().freelancer, acc("tolu.near"));
    pay(&mut c, id, &Client::new(), AMOUNT, None);
    set_ctx("relayer.near", 0, 2 * DAY);
    c.mark_delivered_for(acc("tolu.near"), U64(id), None, None);
    assert_eq!(status(&c, id), Status::Delivered);
}

#[test]
#[should_panic(expected = "Only the PayPact relayer")]
fn strangers_cannot_create_for_others() {
    let mut c = with_relayer();
    set_ctx("mallory.near", 0, 0);
    c.create_invoice_for(acc("tolu.near"), acc(USDC), U128(AMOUNT), "Fake".into(), 7, None, None, None, None);
}

#[test]
#[should_panic(expected = "Only the freelancer")]
fn relayer_cannot_deliver_for_the_wrong_freelancer() {
    let mut c = with_relayer();
    set_ctx("relayer.near", 0, 0);
    let id = c.create_invoice_for(acc("tolu.near"), acc(USDC), U128(AMOUNT), "Logo".into(), 7, None, None, None, None).0;
    pay(&mut c, id, &Client::new(), AMOUNT, None);
    set_ctx("relayer.near", 0, 2 * DAY);
    c.mark_delivered_for(acc("mallory.near"), U64(id), None, None);
}

#[test]
#[should_panic(expected = "Only the PayPact relayer")]
fn no_relayer_means_no_gasless_calls() {
    set_ctx("owner.near", 0, 0);
    let mut c = Contract::new(acc("owner.near"), vec![acc(USDC)]);
    set_ctx("relayer.near", 0, 0);
    c.create_invoice_for(acc("tolu.near"), acc(USDC), U128(AMOUNT), "Logo".into(), 7, None, None, None, None);
}

#[test]
#[should_panic(expected = "Only the freelancer")]
fn relayer_cannot_move_money() {
    let mut c = with_relayer();
    set_ctx("relayer.near", 0, 0);
    let id = c.create_invoice_for(acc("tolu.near"), acc(USDC), U128(AMOUNT), "Logo".into(), 7, None, None, None, None).0;
    pay(&mut c, id, &Client::new(), AMOUNT, Some("sarah.near"));
    set_ctx("relayer.near", 1, 2 * DAY);
    let _ = c.refund_client(U64(id));
}

#[test]
fn delivery_proof_is_recorded() {
    let (mut c, id) = setup();
    let client = Client::new();
    pay(&mut c, id, &client, AMOUNT, None);
    set_ctx("tolu.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), Some(" https://figma.com/file/abc ".into()), Some("Final logo + brand guide".into()));
    let inv = c.get_invoice(U64(id)).unwrap();
    let d = inv.delivery.expect("proof stored");
    assert_eq!(d.link.as_deref(), Some("https://figma.com/file/abc"));
    assert_eq!(d.note.as_deref(), Some("Final logo + brand guide"));
    assert_eq!(inv.delivered_at, Some(U64(2 * DAY)));
}

#[test]
#[should_panic(expected = "Link must start with https://")]
fn delivery_link_must_be_https() {
    let (mut c, id) = setup();
    pay(&mut c, id, &Client::new(), AMOUNT, None);
    set_ctx("tolu.near", 0, 2 * DAY);
    c.mark_delivered(U64(id), Some("javascript:alert(1)".into()), None);
}
