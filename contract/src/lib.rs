//! Escrowed stablecoin invoices on NEAR.
//!
//! A freelancer creates an invoice. The client pays it in any token on any chain
//! through NEAR Intents 1Click, which delivers the stablecoin here with
//! `ft_transfer_call` and the invoice id in `msg`. The funds stay locked until:
//! - the client approves, or stays silent past the review window (paid to freelancer),
//! - the work is never delivered (refunded to the client),
//! - a dispute ends in an agreed split, an arbiter ruling, or the stale fallback.
//!
//! Clients usually have no NEAR account, so the client is a key: the paying
//! browser generates an ed25519 key and puts its public half in the payment
//! `msg`. Client actions are messages signed with that key, relayed by anyone.
//!
//! Methods that move money or change who gets paid require exactly 1 yoctoNEAR.
//! NEAR function-call access keys cannot attach a deposit, so an AI assistant
//! holding such a key can create invoices and mark work delivered, but can never
//! move funds.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::IterableMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

const NS_PER_DAY: u64 = 86_400 * 1_000_000_000;
const MAX_DAYS: u32 = 365;
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_PAYOUT_CALLBACK: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// Created, waiting for the client's payment.
    AwaitingPayment,
    /// Paid and locked; the freelancer is working.
    Funded,
    /// Freelancer marked the work delivered; the review window is running.
    Delivered,
    /// Client raised a problem; funds are frozen until resolved.
    Disputed,
    /// All funds went to the freelancer.
    Released,
    /// All funds went back to the client.
    Refunded,
    /// Funds were split between freelancer and client.
    Split,
    /// Freelancer withdrew the invoice before it was paid.
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Party {
    Freelancer,
    Client,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct SplitProposal {
    pub by: Party,
    pub to_freelancer: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Invoice {
    pub id: U64,
    pub freelancer: AccountId,
    /// NEP-141 stablecoin the invoice is priced and settled in.
    pub token: AccountId,
    pub amount: U128,
    pub title: String,
    pub created_at: U64,
    /// Work is due by this time (ns). Past due + grace, an undelivered invoice can be refunded.
    pub due_at: U64,
    pub review_days: u32,
    pub dispute_timeout_days: u32,
    pub arbiter: Option<AccountId>,
    pub status: Status,
    /// ed25519 public key (base58, "ed25519:...") of the client, set at payment.
    pub client_key: Option<String>,
    /// Where refunds go: a NEAR account the client named at payment, if any.
    pub client_refund_to: Option<AccountId>,
    pub funded_at: Option<U64>,
    pub delivered_at: Option<U64>,
    pub disputed_at: Option<U64>,
    pub dispute_reason: Option<String>,
    pub proposal: Option<SplitProposal>,
    /// Incremented on every signed client action, so a signature works once.
    pub client_nonce: u32,
    /// Funds still owed after a failed transfer, claimable with `retry_payout`.
    pub owed_freelancer: U128,
    pub owed_client: U128,
}

/// The `msg` of the `ft_transfer_call` that pays an invoice.
#[derive(Deserialize, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PaymentMsg {
    pub invoice_id: U64,
    pub client_key: String,
    #[serde(default)]
    pub refund_to: Option<AccountId>,
}

/// What the client can do with a signed message.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientAction {
    Approve,
    Dispute { reason: String },
    ProposeSplit { to_freelancer: U128 },
    AcceptSplit,
    /// Refund when the work was never delivered and the due date (+ grace) passed.
    RefundUndelivered,
    /// Set or change the NEAR account refunds are paid to.
    SetRefundAccount { account: AccountId },
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    invoices: IterableMap<u64, Invoice>,
    next_id: u64,
    /// Stablecoins invoices may be priced in.
    allowed_tokens: Vec<AccountId>,
    owner: AccountId,
    /// Days after `due_at` before an undelivered invoice can be refunded.
    grace_days: u32,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, allowed_tokens: Vec<AccountId>) -> Self {
        Self {
            invoices: IterableMap::new(b"i"),
            next_id: 1,
            allowed_tokens,
            owner,
            grace_days: 2,
        }
    }

    // ---------------------------------------------------------------- freelancer

    /// Create an invoice. Callable with a function-call key (no deposit), so an
    /// AI assistant can draft invoices for the freelancer.
    #[allow(clippy::too_many_arguments)]
    pub fn create_invoice(
        &mut self,
        token: AccountId,
        amount: U128,
        title: String,
        due_in_days: u32,
        review_days: Option<u32>,
        dispute_timeout_days: Option<u32>,
        arbiter: Option<AccountId>,
    ) -> U64 {
        require!(self.allowed_tokens.contains(&token), "Token not supported");
        require!(amount.0 > 0, "Amount must be positive");
        require!(!title.trim().is_empty() && title.len() <= 140, "Title must be 1-140 characters");
        require!(due_in_days >= 1 && due_in_days <= MAX_DAYS, "Due date must be 1-365 days out");
        let review_days = review_days.unwrap_or(5);
        let dispute_timeout_days = dispute_timeout_days.unwrap_or(30);
        require!(review_days >= 1 && review_days <= 60, "Review window must be 1-60 days");
        require!(
            dispute_timeout_days >= 7 && dispute_timeout_days <= MAX_DAYS,
            "Dispute timeout must be 7-365 days"
        );
        let freelancer = env::predecessor_account_id();
        if let Some(a) = &arbiter {
            require!(*a != freelancer, "Arbiter cannot be the freelancer");
        }
        let now = env::block_timestamp();
        let id = self.next_id;
        self.next_id += 1;
        self.invoices.insert(
            id,
            Invoice {
                id: U64(id),
                freelancer,
                token,
                amount,
                title: title.trim().to_string(),
                created_at: U64(now),
                due_at: U64(now + due_in_days as u64 * NS_PER_DAY),
                review_days,
                dispute_timeout_days,
                arbiter,
                status: Status::AwaitingPayment,
                client_key: None,
                client_refund_to: None,
                funded_at: None,
                delivered_at: None,
                disputed_at: None,
                dispute_reason: None,
                proposal: None,
                client_nonce: 0,
                owed_freelancer: U128(0),
                owed_client: U128(0),
            },
        );
        env::log_str(&format!("invoice_created id={id}"));
        U64(id)
    }

    /// Mark the work delivered; starts the client's review window.
    /// Callable with a function-call key.
    pub fn mark_delivered(&mut self, invoice_id: U64) {
        let mut inv = self.get_mut(invoice_id);
        require!(env::predecessor_account_id() == inv.freelancer, "Only the freelancer");
        require!(inv.status == Status::Funded, "Invoice is not funded");
        inv.status = Status::Delivered;
        inv.delivered_at = Some(U64(env::block_timestamp()));
        self.save(inv);
    }

    /// Withdraw an unpaid invoice. Requires 1 yoctoNEAR (full-access key).
    #[payable]
    pub fn cancel_invoice(&mut self, invoice_id: U64) {
        assert_one_yocto();
        let mut inv = self.get_mut(invoice_id);
        require!(env::predecessor_account_id() == inv.freelancer, "Only the freelancer");
        require!(inv.status == Status::AwaitingPayment, "Invoice is already paid");
        inv.status = Status::Cancelled;
        self.save(inv);
    }

    /// Give all funds back to the client. Requires 1 yoctoNEAR.
    #[payable]
    pub fn refund_client(&mut self, invoice_id: U64) -> Promise {
        assert_one_yocto();
        let mut inv = self.get_mut(invoice_id);
        require!(env::predecessor_account_id() == inv.freelancer, "Only the freelancer");
        require!(
            matches!(inv.status, Status::Funded | Status::Delivered | Status::Disputed),
            "Nothing to refund"
        );
        let amount = inv.amount.0;
        self.settle(&mut inv, 0, amount, Status::Refunded)
    }

    /// Propose how to split the funds in a dispute. Requires 1 yoctoNEAR.
    #[payable]
    pub fn propose_split(&mut self, invoice_id: U64, to_freelancer: U128) {
        assert_one_yocto();
        let mut inv = self.get_mut(invoice_id);
        require!(env::predecessor_account_id() == inv.freelancer, "Only the freelancer");
        require!(inv.status == Status::Disputed, "Invoice is not disputed");
        require!(to_freelancer.0 <= inv.amount.0, "Split exceeds the invoice amount");
        inv.proposal = Some(SplitProposal { by: Party::Freelancer, to_freelancer });
        self.save(inv);
    }

    /// Accept the client's split proposal. Requires 1 yoctoNEAR.
    #[payable]
    pub fn accept_split(&mut self, invoice_id: U64) -> Promise {
        assert_one_yocto();
        let mut inv = self.get_mut(invoice_id);
        require!(env::predecessor_account_id() == inv.freelancer, "Only the freelancer");
        let to_freelancer = Self::proposal_from(&inv, Party::Client);
        let to_client = inv.amount.0 - to_freelancer;
        self.settle(&mut inv, to_freelancer, to_client, Status::Split)
    }

    // -------------------------------------------------------------------- client

    /// Run a client action, authorized by the client's ed25519 signature over
    /// `action_message(invoice_id, action)`. Anyone can relay it.
    pub fn client_action(
        &mut self,
        invoice_id: U64,
        action: ClientAction,
        signature: String,
    ) -> PromiseOrValue<()> {
        let mut inv = self.get_mut(invoice_id);
        let key = inv.client_key.clone().unwrap_or_else(|| env::panic_str("Invoice is not paid"));
        let message = Self::message_for(&env::current_account_id(), &inv, &action);
        require!(verify_ed25519(&key, &signature, message.as_bytes()), "Invalid client signature");
        inv.client_nonce += 1;
        let now = env::block_timestamp();

        match action {
            ClientAction::Approve => {
                require!(
                    matches!(inv.status, Status::Funded | Status::Delivered),
                    "Invoice cannot be approved now"
                );
                let amount = inv.amount.0;
                PromiseOrValue::Promise(self.settle(&mut inv, amount, 0, Status::Released))
            }
            ClientAction::Dispute { reason } => {
                require!(inv.status == Status::Delivered, "Only delivered work can be disputed");
                require!(now < Self::review_ends(&inv), "Review window has ended");
                require!(reason.len() <= 500, "Reason is too long");
                inv.status = Status::Disputed;
                inv.disputed_at = Some(U64(now));
                inv.dispute_reason = Some(reason);
                self.save(inv);
                PromiseOrValue::Value(())
            }
            ClientAction::ProposeSplit { to_freelancer } => {
                require!(inv.status == Status::Disputed, "Invoice is not disputed");
                require!(to_freelancer.0 <= inv.amount.0, "Split exceeds the invoice amount");
                inv.proposal = Some(SplitProposal { by: Party::Client, to_freelancer });
                self.save(inv);
                PromiseOrValue::Value(())
            }
            ClientAction::AcceptSplit => {
                let to_freelancer = Self::proposal_from(&inv, Party::Freelancer);
                let to_client = inv.amount.0 - to_freelancer;
                PromiseOrValue::Promise(self.settle(&mut inv, to_freelancer, to_client, Status::Split))
            }
            ClientAction::RefundUndelivered => {
                require!(inv.status == Status::Funded, "Work was delivered or invoice is not funded");
                require!(
                    now >= inv.due_at.0 + self.grace_days as u64 * NS_PER_DAY,
                    "Due date and grace period have not passed"
                );
                let amount = inv.amount.0;
                PromiseOrValue::Promise(self.settle(&mut inv, 0, amount, Status::Refunded))
            }
            ClientAction::SetRefundAccount { account } => {
                inv.client_refund_to = Some(account);
                self.save(inv);
                PromiseOrValue::Value(())
            }
        }
    }

    // ------------------------------------------------------------------- anyone

    /// After the review window with no dispute, release funds to the freelancer.
    pub fn release_after_review(&mut self, invoice_id: U64) -> Promise {
        let mut inv = self.get_mut(invoice_id);
        require!(inv.status == Status::Delivered, "Invoice is not awaiting review");
        require!(env::block_timestamp() >= Self::review_ends(&inv), "Review window is still open");
        let amount = inv.amount.0;
        self.settle(&mut inv, amount, 0, Status::Released)
    }

    /// Arbiter decides a dispute. The arbiter can only split between the two parties.
    #[payable]
    pub fn arbiter_resolve(&mut self, invoice_id: U64, to_freelancer: U128) -> Promise {
        assert_one_yocto();
        let mut inv = self.get_mut(invoice_id);
        require!(
            inv.arbiter.as_ref() == Some(&env::predecessor_account_id()),
            "Only the invoice's arbiter"
        );
        require!(inv.status == Status::Disputed, "Invoice is not disputed");
        require!(to_freelancer.0 <= inv.amount.0, "Split exceeds the invoice amount");
        let to_client = inv.amount.0 - to_freelancer.0;
        self.settle(&mut inv, to_freelancer.0, to_client, Status::Split)
    }

    /// A dispute unresolved past its timeout is split 50/50.
    pub fn resolve_stale_dispute(&mut self, invoice_id: U64) -> Promise {
        let mut inv = self.get_mut(invoice_id);
        require!(inv.status == Status::Disputed, "Invoice is not disputed");
        let disputed_at = inv.disputed_at.map(|t| t.0).unwrap_or_default();
        require!(
            env::block_timestamp() >= disputed_at + inv.dispute_timeout_days as u64 * NS_PER_DAY,
            "Dispute timeout has not passed"
        );
        let half = inv.amount.0 / 2;
        let to_client = inv.amount.0 - half;
        self.settle(&mut inv, half, to_client, Status::Split)
    }

    /// Retry a payout whose token transfer failed (e.g. recipient not registered).
    pub fn retry_payout(&mut self, invoice_id: U64) -> Promise {
        let mut inv = self.get_mut(invoice_id);
        let f = inv.owed_freelancer.0;
        // The client's share waits until the client has named a refund account.
        let c = if inv.client_refund_to.is_some() { inv.owed_client.0 } else { 0 };
        require!(f > 0 || c > 0, "Nothing owed (a client refund needs a refund account first)");
        inv.owed_freelancer = U128(0);
        inv.owed_client = U128(inv.owed_client.0 - c);
        let promise = self.pay_out(&inv, f, c);
        self.save(inv);
        promise
    }

    // --------------------------------------------------------------- payments in

    /// NEP-141 receiver: pays an invoice. `msg` is a JSON `PaymentMsg`.
    /// Returns the amount to refund to the sender (all of it if the payment is invalid).
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let Ok(payment) = near_sdk::serde_json::from_str::<PaymentMsg>(&msg) else {
            env::log_str("payment_rejected reason=bad_msg");
            return PromiseOrValue::Value(amount);
        };
        let Some(mut inv) = self.invoices.get(&payment.invoice_id.0).cloned() else {
            env::log_str("payment_rejected reason=unknown_invoice");
            return PromiseOrValue::Value(amount);
        };
        if inv.token != token
            || inv.status != Status::AwaitingPayment
            || amount.0 < inv.amount.0
            || parse_ed25519_key(&payment.client_key).is_none()
        {
            env::log_str(&format!("payment_rejected id={} reason=mismatch", inv.id.0));
            return PromiseOrValue::Value(amount);
        }
        let excess = amount.0 - inv.amount.0;
        inv.status = Status::Funded;
        inv.funded_at = Some(U64(env::block_timestamp()));
        inv.client_key = Some(payment.client_key);
        // Payments relayed by NEAR Intents arrive from a bridge account, so the
        // sender is never assumed to be the client: refunds go only to an
        // account the client names (here, or later with SetRefundAccount).
        let _ = sender_id;
        inv.client_refund_to = payment.refund_to;
        env::log_str(&format!("invoice_funded id={}", inv.id.0));
        self.save(inv);
        PromiseOrValue::Value(U128(excess))
    }

    // ---------------------------------------------------------------- admin

    #[payable]
    pub fn set_allowed_tokens(&mut self, tokens: Vec<AccountId>) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.allowed_tokens = tokens;
    }

    // ---------------------------------------------------------------- views

    pub fn get_invoice(&self, invoice_id: U64) -> Option<Invoice> {
        self.invoices.get(&invoice_id.0).cloned()
    }

    pub fn get_invoices_for(&self, freelancer: AccountId, from: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        self.invoices
            .values()
            .filter(|i| i.freelancer == freelancer)
            .skip(from.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    pub fn get_allowed_tokens(&self) -> Vec<AccountId> {
        self.allowed_tokens.clone()
    }

    /// The exact text the client signs for `action` on this invoice right now.
    pub fn action_message(&self, invoice_id: U64, action: ClientAction) -> String {
        let inv = self.invoices.get(&invoice_id.0).unwrap_or_else(|| env::panic_str("Invoice not found"));
        Self::message_for(&env::current_account_id(), inv, &action)
    }

    // ---------------------------------------------------------------- callbacks

    #[private]
    pub fn on_payout(&mut self, invoice_id: U64, to_freelancer: U128, to_client: U128) {
        let mut inv = self.get_mut(invoice_id);
        let mut index = 0;
        if to_freelancer.0 > 0 {
            if matches!(env::promise_result_checked(index, 0), Err(PromiseError::Failed)) {
                inv.owed_freelancer = U128(inv.owed_freelancer.0 + to_freelancer.0);
                env::log_str(&format!("payout_failed id={} party=freelancer", inv.id.0));
            }
            index += 1;
        }
        if to_client.0 > 0 && matches!(env::promise_result_checked(index, 0), Err(PromiseError::Failed)) {
            inv.owed_client = U128(inv.owed_client.0 + to_client.0);
            env::log_str(&format!("payout_failed id={} party=client", inv.id.0));
        }
        self.save(inv);
    }
}

impl Contract {
    fn get_mut(&self, invoice_id: U64) -> Invoice {
        self.invoices
            .get(&invoice_id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Invoice not found"))
    }

    fn save(&mut self, inv: Invoice) {
        self.invoices.insert(inv.id.0, inv);
    }

    fn review_ends(inv: &Invoice) -> u64 {
        inv.delivered_at.map(|t| t.0).unwrap_or_default() + inv.review_days as u64 * NS_PER_DAY
    }

    fn proposal_from(inv: &Invoice, by: Party) -> u128 {
        require!(inv.status == Status::Disputed, "Invoice is not disputed");
        match &inv.proposal {
            Some(p) if p.by == by => p.to_freelancer.0,
            _ => env::panic_str("No split proposal from the other party"),
        }
    }

    fn message_for(contract: &AccountId, inv: &Invoice, action: &ClientAction) -> String {
        format!(
            "{contract}|invoice:{}|nonce:{}|{}",
            inv.id.0,
            inv.client_nonce,
            near_sdk::serde_json::to_string(action).unwrap()
        )
    }

    /// Mark the invoice settled and send the funds. A client share with no refund
    /// account yet is held as owed until the client names one.
    fn settle(&mut self, inv: &mut Invoice, to_freelancer: u128, to_client: u128, status: Status) -> Promise {
        inv.status = status;
        let to_client = if to_client > 0 && inv.client_refund_to.is_none() {
            inv.owed_client = U128(inv.owed_client.0 + to_client);
            0
        } else {
            to_client
        };
        let promise = self.pay_out(inv, to_freelancer, to_client);
        env::log_str(&format!(
            "invoice_settled id={} status={:?} to_freelancer={} to_client={}",
            inv.id.0, status, to_freelancer, to_client
        ));
        self.save(inv.clone());
        promise
    }

    fn pay_out(&self, inv: &Invoice, to_freelancer: u128, to_client: u128) -> Promise {
        if to_freelancer + to_client == 0 {
            // Everything is held as owed; just record it.
            return Promise::new(env::current_account_id());
        }
        let mut transfers: Option<Promise> = None;
        let mut add = |receiver: AccountId, amount: u128| {
            let p = Promise::new(inv.token.clone())
                .function_call(
                    "ft_transfer".to_string(),
                    near_sdk::serde_json::json!({ "receiver_id": receiver, "amount": U128(amount) })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(1),
                    GAS_FOR_FT_TRANSFER,
                );
            transfers = Some(match transfers.take() {
                Some(t) => t.and(p),
                None => p,
            });
        };
        if to_freelancer > 0 {
            add(inv.freelancer.clone(), to_freelancer);
        }
        if to_client > 0 {
            add(inv.client_refund_to.clone().unwrap(), to_client);
        }
        transfers.unwrap().then(
            Promise::new(env::current_account_id()).function_call(
                "on_payout".to_string(),
                near_sdk::serde_json::json!({
                    "invoice_id": inv.id,
                    "to_freelancer": U128(to_freelancer),
                    "to_client": U128(to_client),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_PAYOUT_CALLBACK,
            ),
        )
    }
}

fn parse_ed25519_key(key: &str) -> Option<[u8; 32]> {
    let raw = key.strip_prefix("ed25519:")?;
    let bytes = near_sdk::bs58::decode(raw).into_vec().ok()?;
    bytes.try_into().ok()
}

fn verify_ed25519(key: &str, signature_b58: &str, message: &[u8]) -> bool {
    let Some(pk) = parse_ed25519_key(key) else { return false };
    let sig_raw = signature_b58.strip_prefix("ed25519:").unwrap_or(signature_b58);
    let Ok(sig_bytes) = near_sdk::bs58::decode(sig_raw).into_vec() else { return false };
    let Ok(sig): Result<[u8; 64], _> = sig_bytes.try_into() else { return false };
    env::ed25519_verify(&sig, message, &pk)
}

#[cfg(test)]
mod tests;
