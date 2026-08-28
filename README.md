# SAFE-HAVEN

[![Rust](https://img.shields.io/badge/Rust-1.81%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![Soroban SDK](https://img.shields.io/badge/Soroban-SDK%20v22-blue?logo=stellar)](https://github.com/stellar/rs-soroban-sdk)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![Tests](https://github.com/kenedybok3/SAFE-HAVEN/actions/workflows/ci.yml/badge.svg)](https://github.com/kenedybok3/SAFE-HAVEN/actions)

A production-ready decentralized vault on the Stellar blockchain (Soroban) — with a full React/TypeScript frontend.

Tokens are locked in the smart contract until a future timestamp. Early exits are possible with a configurable penalty. Admin rights can be permanently renounced for fully trustless operation.

---

## Project Structure

```
SAFE-HAVEN/
├── contracts/safe-haven/       Smart contract (Rust / Soroban)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs              Crate root
│       ├── contract.rs         All public entry points
│       ├── types.rs            VaultKey, VaultEntry, constants
│       ├── errors.rs           VaultError enum (14 codes)
│       ├── events.rs           Event emission helpers
│       ├── storage.rs          Persistent storage + TTL helpers
│       └── test.rs             48+ unit tests
│
├── frontend/                   React + TypeScript + Vite (UI)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── config.ts           Contract ID, RPC URLs
│   │   ├── context/            Freighter wallet
│   │   ├── hooks/              useDeposits, useContractInfo
│   │   ├── lib/                Stellar SDK helpers, formatting
│   │   ├── components/         Header, TabNav, DepositCard, etc.
│   │   └── pages/              Dashboard, Deposit, Withdraw, Admin
│   ├── .env.example
│   └── README.md
│
├── Cargo.toml                  Rust workspace
├── Makefile                    Build / test / lint / deploy
└── STRUCTURE.md                Detailed project layout
```

---

## Quick Start

### Smart Contract

```bash
# Prerequisites
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install --locked soroban-cli

# Optional: jq for JSON parsing in smoke tests (apt-get install jq / brew install jq)

# One-shot: install all recommended dev tools
make install-tools

# Build
make build

# Test
make test

# Run all tests on file change (requires cargo-watch, installed by make install-tools)
make watch

# Full local dev environment (build + deploy + frontend)
make dev

# Deploy to testnet
export SOROBAN_SECRET_KEY=S...
make deploy-testnet

# Deploy to mainnet (the deployer must already be funded; no mainnet faucet exists)
export SOROBAN_SECRET_KEY=S...
make deploy-mainnet

# Redeploy a retained immutable WASM as a new contract ID
export SOROBAN_SECRET_KEY=S...
make rollback NETWORK=testnet ARTIFACT_DIR=deployments/testnet/<timestamp>
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # set VITE_CONTRACT_ID to your deployed contract
npm run dev            # -> http://localhost:5173
```

See [`frontend/README.md`](./frontend/README.md) for the full frontend guide.

See [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md) for disaster scenarios, recovery procedures, roles, and escalation rules.

See [`MONITORING.md`](./MONITORING.md) for contract health checks, alert thresholds, storage/TTL monitoring, and failed-transaction observability.

Deployment artifacts are written to `deployments/<network>/<timestamp>/`, including raw and optimized WASM, contract ID, manifest, and checksum. Each deployment also updates `deploy_<network>.log` for CI compatibility. Soroban contracts are immutable, so rollback means deploying the retained previous WASM as a new contract and updating the frontend contract ID after verification.

---

## Overview

| Property | Value |
|---|---|
| Network | Stellar (Soroban) |
| Language | Rust |
| SDK | soroban-sdk v22 |
| Storage | Persistent (per-depositor) |
| Max deposit | 10^15 units |
| Max lock duration | 5 years |
| Min lock duration | 60 seconds |
| Early-exit penalty | 0-100% (basis points, set at deposit time) |

---

## How It Works

1. **Deposit** - User calls `deposit(token, amount, unlock_time, penalty_bps)` — tokens transfer into the contract
2. **Storage** - Contract stores a `VaultEntry` in persistent storage keyed by `(depositor, deposit_id)`
3. **Verification** - On `withdraw()`, contract checks `ledger.timestamp() >= unlock_time`
4. **Unlock** - Tokens returned to depositor. Otherwise call fails with `FundsStillLocked`
5. **Early exit** - `cancel_deposit()` returns funds minus penalty; penalty goes to `fee_recipient`
6. **Admin recovery** - Admin can emergency-withdraw any deposit (funds always go to depositor, never admin)
7. **Trustless mode** - Admin can be permanently renounced via `renounce_admin()`

---

## Contract API

### Initialization

#### `initialize(admin, fee_recipient, max_deposit?, max_lock_secs?)`
One-time setup. Sets admin and fee recipient. Optionally overrides compile-time limits.

---

### Core Functions

#### `deposit(depositor, token, amount, unlock_time, penalty_bps) -> u32`
Locks tokens. Returns the deposit ID.

#### `deposit_for(payer, depositor, token, amount, unlock_time, penalty_bps) -> u32`
Payer funds a vault for a different beneficiary.

#### `deposit_by_ledger(depositor, token, amount, unlock_ledger, penalty_bps) -> u32`
Locks tokens until a specific Stellar ledger sequence number is reached, instead of a wall-clock timestamp.

Use this when you need to express a lock period in terms of on-chain ledger progression — for example, "release after the network has produced exactly N more ledgers" — rather than relying on the ledger's timestamp field.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `depositor` | `Address` | Account locking the tokens. Must sign the transaction. |
| `token` | `Address` | SAC-compatible token contract address. |
| `amount` | `i128` | Amount to lock (> 0, ≤ `max_deposit`). |
| `unlock_ledger` | `u32` | Ledger sequence number at or after which withdrawal is permitted. Must be > `current_ledger + 12` (minimum gap of 12 ledgers ≈ 60 seconds at 5 s/ledger). |
| `penalty_bps` | `u32` | Early-exit penalty in basis points (0–10000). Requires a `fee_recipient` to be configured if > 0. |

**Returns** the deposit ID (`u32`), shared with the same per-depositor counter as timestamp-based deposits.

**Withdrawal** — `withdraw()` and `withdraw_to()` both accept ledger-based deposits. On withdrawal the contract checks `env.ledger().sequence() >= unlock_ledger`; if the ledger sequence has not yet reached the target the call fails with `FundsStillLocked`.

**Estimating wall-clock time from a ledger number** — Stellar produces a new ledger roughly every 5 seconds. To approximate the unlock time in seconds from the current ledger:

```
estimated_seconds = (unlock_ledger - current_ledger) × 5
```

> **⚠️ IMPORTANT: This is an ESTIMATE, not a guaranteed prediction.**
>
> - Actual ledger close times vary by ±1-2 seconds depending on network conditions
> - The 5-second value is a Stellar network consensus target, not a hard guarantee
> - Use this estimate for UI display and rough scheduling only
> - Do **not** rely on this for precise, critical timing — use timestamp-based deposits instead
> - When withdrawal is called, the actual check is `current_ledger >= unlock_ledger`, which is exact
> - The `time_remaining(depositor, id)` query returns `(remaining_ledgers × 5)` for ledger-based deposits, which is the same estimate
>
> See the **"Ledger-Based Deposit Time Estimation: Precision & Confidence"** section below for a detailed decision tree, use-case guidance, and accuracy details.

#### `withdraw(depositor, deposit_id)`
Withdraws if `now >= unlock_time`.

#### `withdraw_to(depositor, deposit_id, recipient)`
Withdraws to a different address.

#### `cancel_deposit(depositor, deposit_id)`
Early exit with penalty. Penalty is split: 30% goes to fee_recipient, 70% accumulates in the staker rewards pool; remainder returned to depositor.

---

### Staker Registry Functions

The staker registry allows users to register as stakers and earn a portion of penalties accrued from early deposit exits. This creates an incentive mechanism where stakers share in the penalties paid by users who exit early.

#### `register_staker(staker, amount) -> Result<(), VaultError>`
Register or update a staker's stake amount.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `staker` | `Address` | The staker's address. Must sign the transaction. |
| `amount` | `i128` | Stake amount in contract tokens (> 0). |

**Returns** `Ok(())` on success, or an error code if validation fails.

**Behavior**
- Validates that `amount > 0` — zero or negative amounts are rejected with `InvalidStakeAmount`.
- Updates the staker's entry if already registered, or creates a new entry.
- Maintains `total_staked` (sum of all registered stakes) for proportional reward calculation.
- Adds the staker to the staker list on first registration.
- Emits a `StakerRegistered` event.
- Requires authentication from the staker.

**Example**
```rust
// Alice registers with 1000 tokens as stake
vault.register_staker(&alice, &1000)?;

// Later, Alice increases her stake to 2000
vault.register_staker(&alice, &2000)?;
```

#### `claim_staker_rewards(staker) -> Result<(), VaultError>`
Claim accumulated rewards from the staker rewards pool.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `staker` | `Address` | The staker claiming rewards. Must sign the transaction. |

**Returns** `Ok(())` on success, or an error code if no rewards are available or staker is not registered.

**Behavior**
- Validates that the staker is registered — returns `StakerNotFound` if not.
- Calculates the staker's proportional share: `(stake_amount / total_staked) × rewards_pool`.
- Validates that the calculated reward is > 0 — returns `NoRewardsToClaim` if the pool is empty or the proportion rounds to zero.
- Deducts the reward from the rewards pool.
- Tracks cumulative rewards claimed per staker for auditing.
- Emits a `RewardsClaimed` event.
- Requires authentication from the staker.

**Example**
```rust
// Alice claims her proportional share of the rewards pool
vault.claim_staker_rewards(&alice)?;

// If Alice has stake 1000 and total_staked is 4000, and rewards_pool is 700:
// Alice's reward = (1000 / 4000) × 700 = 175 tokens
```

---

### Penalty Splitting & Rewards Pool

When a user calls `cancel_deposit()` to exit early, the penalty is split as follows:

| Recipient | Percentage | Basis Points |
|---|---|---|
| Fee Recipient | 30% | 3000 bps |
| Staker Rewards Pool | 70% | 7000 bps |

**Example**
If a user cancels a deposit with 100 tokens penalty (10% of 1000):
- Fee Recipient receives 30 tokens (100 × 0.30)
- Staker Rewards Pool receives 70 tokens (100 × 0.70)

Registered stakers can then claim their proportional share of the rewards pool based on their stake amount relative to total staked.

---

### Admin Functions

#### `emergency_withdraw(admin, depositor, deposit_id)`
Admin-only. Returns funds to depositor regardless of lock time.

#### `pause(admin)` / `unpause(admin)`
Halts / restores deposits.

#### `transfer_admin(admin, new_admin)` / `accept_admin(new_admin)`
Two-step admin transfer.

#### `cancel_transfer_admin(admin)`
Cancels a pending transfer.

#### `renounce_admin(admin)`
Permanently removes admin. Contract becomes fully trustless.

---

### Read-only Queries

| Function | Returns |
|---|---|
| `get_vault(depositor, id)` | `Option<VaultEntry>` |
| `get_deposit_ids(depositor)` | `Vec<u32>` |
| `time_remaining(depositor, id)` | `u64` seconds |
| `get_time()` | Current ledger timestamp |
| `version()` | `String` — contract version from Cargo.toml |
| `get_admin()` | `Option<Address>` |
| `get_pending_admin()` | `Option<Address>` |
| `get_fee_recipient()` | `Option<Address>` |
| `get_constants()` | `(max_deposit, max_lock_secs)` |
| `get_depositor_count()` | `u32` |
| `get_depositors(offset, limit)` | `Page<Address>` — items + total_count |
| `is_paused()` | `bool` |
| `is_initialized()` | `bool` |

---

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 1 | `InvalidAmount` | Amount <= 0 |
| 2 | `UnlockTimeNotInFuture` | unlock_time (or unlock_ledger) <= current value |
| 3 | `NoDepositFound` | No active deposit at the given (depositor, deposit_id) |
| 4 | `FundsStillLocked` | Lock not yet expired |
| 5 | `DepositAlreadyExists` | Reserved — defined in the enum to hold the slot and prevent future code-number collisions, but never emitted by any current code path |
| 6 | `LockDurationTooLong` | Exceeds 5 years |
| 7 | `Unauthorized` | Caller is not the admin (or contract is not initialized) |
| 8 | `AmountTooLarge` | Exceeds 10^15 |
| 9 | `InvalidPenaltyBps` | penalty_bps > 10000 |
| 10 | `InvalidAdmin` | Proposed new admin is same as current admin |
| 11 | `LockDurationTooShort` | Lock duration < 60 seconds (or < 12 ledgers for `deposit_by_ledger`) |
| 12 | `ContractPaused` | Deposits are paused |
| 13 | `VaultAlreadyUnlocked` | `cancel_deposit` called after the lock has already expired |
| 14 | `MissingFeeRecipient` | penalty_bps > 0 but no fee_recipient is configured |
| 15 | `AlreadyInitialized` | `initialize` was called on an already-initialized contract |
| 16 | `InvalidStakeAmount` | Staker registration with amount <= 0 |
| 17 | `StakerNotFound` | Staker not registered in the staker registry |
| 18 | `NoRewardsToClaim` | Rewards pool is empty or staker's share rounds to zero |
| 19 | `InsufficientStakeAmount` | Insufficient staked amount for operation |

---

## Security Properties

| Property | Implementation |
|---|---|
| Checks-Effects-Interactions | Storage cleared before token transfer on every withdrawal |
| Auth-first | `require_auth()` is the first call in every mutating function |
| No re-entrancy | State removed before any external token call |
| Bounded inputs | Amount capped at 10^15; lock 60s-5yr |
| No admin theft | Emergency withdraw always sends to depositor |
| Trustless mode | `renounce_admin()` permanently removes admin |
| Safe transfer | Two-step admin transfer prevents key loss |

---

## Soroban Developer Notes

### Ledger TTL and Storage Expiry

Soroban uses a **time-to-live (TTL)** system for all persistent storage entries. Every entry written to the ledger has a limited lifespan — measured in ledgers, not wall-clock time — after which it **expires and is pruned**. If a storage entry expires, reading it returns `None` as if it were never written.

SAFE-HAVEN mitigates this by bumping TTL on every storage write and read that matters:

- **On write**: every `set_*` helper calls `extend_ttl` with a `BUMP_TARGET` that covers the maximum lock duration (~5 years) plus a `BUMP_THRESHOLD` buffer.
- **On read**: the `get_deposit` (mutable) helper also extends TTL. The `*_readonly` variants do *not* extend TTL — they are used by queries that should not incur a write-cost.
- **Edge case**: a deposit that sits untouched for longer than `BUMP_TARGET` ledgers (~31.5M ledgers) could theoretically expire. In practice this exceeds the maximum lock duration, and any withdrawal attempt would need to re-create the entry via a migration or re-deposit.

**Takeaway**: always use the write-path `get_deposit` (not `get_deposit_readonly`) for operations that will later mutate the entry. Read-only queries (like `get_vault`) use the readonly variant to avoid unnecessary ledger writes.

### Instruction Budget Limits

Every Soroban transaction has a **CPU instruction budget** (default ~100M instructions for testnet, ~50M for mainnet). Functions that iterate over unbounded collections can exhaust this budget and fail mid-execution.

SAFE-HAVEN's paginated views respect this limit:

- `get_depositors(offset, limit)` and `get_deposits_page(offset, limit)` use a `limit` parameter and stop early. Keep `limit` ≤ 50 in production.
- `get_vault_batch(depositors, deposit_id)` and `get_deposit_batch(depositor, deposit_ids)` clamp input size to `MAX_BATCH_SIZE` (25).
- The `DepositorList` can grow large over time, but `remove_depositor` is O(1) — it clears only a flag. The list is append-only and stale entries are skipped during enumeration.

**Takeaway**: always paginate with reasonable limits. Don't attempt to fetch all deposits or all depositors in a single RPC call.

### Simulation vs. Submission

Soroban distinguishes between two phases of a transaction:

1. **Simulation** — the RPC dry-runs your transaction against the current ledger state to compute the exact footprint, resource fees, and result. Simulation is read-only and free.
2. **Submission** — the signed transaction is broadcast to the network. This consumes real resources and costs fees.

Key implications:

- A simulation that succeeds does **not** guarantee submission will succeed. Ledger state can change between simulation and submission (e.g., another transaction withdraws the funds you were about to claim).
- Always simulate before submitting to catch errors early and estimate fees.
- The frontend's `stellar.ts` helpers simulate first, then submit, and surface any discrepancy as an error.

### `require_auth()` Must Be First

In Soroban, **`require_auth()` must be the very first call in every mutating (non-readonly) contract function**. Calling it after storage reads, transfers, or other operations is an anti-pattern that can lead to:

- **Wasted compute**: if auth fails, all preceding work is discarded but still counted against the instruction budget.
- **Re-entrancy risk**: performing state changes before auth verification opens a window for re-entrant calls.

SAFE-HAVEN enforces this convention: every mutating function calls `caller.require_auth()` as its first meaningful statement (after the function signature). The `Security Properties` table above documents this as "Auth-first".

**Takeaway**: when adding new mutating functions, always put `require_auth()` first. The contract's security model depends on it.

---

## Ledger-Based Deposit Time Estimation: Precision & Confidence

When using `deposit_by_ledger()`, the contract stores a target ledger sequence number. To estimate when that ledger will close in wall-clock time, use the formula:

```
estimated_seconds = (unlock_ledger - current_ledger) × 5
```

### How accurate is this estimate?

**Excellent for rough UI display** (±5–10 seconds over typical durations):
- Stellar's consensus layer targets a 5-second ledger close time on average
- Over a 1-hour lock (720 ledgers), the estimate will typically be within ±2–3 minutes
- For long locks (days or weeks), the relative error shrinks further

**Not suitable for precise scheduling**:
- Actual ledger close times vary by ±1–2 seconds due to network conditions, validator clock skew, and consensus timeouts
- Over-the-counter exchanges, time-sensitive payment settlements, or critical business logic should NOT rely on this estimate
- For exact timing, use timestamp-based deposits (`deposit()`) instead

### When should I use `time_remaining()` for ledger-based deposits?

**Safe to use**:
- Display in a UI dashboard showing "roughly X seconds remaining"
- Showing a progress bar for visual feedback
- Non-critical notifications like "deposit will unlock soon"

**Not safe to use**:
- Calculating precise interest accrual or compounding
- Triggering critical financial workflows ("execute settlement exactly when deposit unlocks")
- Legal or compliance deadlines that require exact timestamps
- Any system that cannot tolerate ±2–5 seconds of error

### Decision tree: Which deposit type should I use?

```
Do you need EXACT wall-clock precision?
├─ YES  → Use deposit() or deposit_for() (timestamp-based)
│        The unlock check is exact: env.ledger().timestamp() >= unlock_time
│
└─ NO   → Do you need to express the lock in ledger terms?
         (e.g., "release after block 12,345,678")?
         ├─ YES  → Use deposit_by_ledger()
         │        Unlock check is exact: env.ledger().sequence() >= unlock_ledger
         │        time_remaining() will return an estimate ±1–2 seconds
         │
         └─ NO   → Use deposit() or deposit_for() (timestamp-based)
                   Simpler, widely supported in the UI, no approximation needed
```

### Implementation Details

The 5-second estimate is defined in `storage.rs::LEDGER_SECONDS`:

```rust
pub const LEDGER_SECONDS: u64 = 5;
```

This constant is used by:
- `contract.rs::time_remaining()` — returns `remaining_ledgers × LEDGER_SECONDS` for ledger-based deposits
- `constants.rs::MIN_LOCK_LEDGERS` — enforces minimum 12 ledgers (~60 seconds)
- Storage TTL calculations — ensures vault state persists longer than maximum lock duration

The estimate formula is deterministic and does not change; network delays may cause the actual ledger close to drift slightly, but the formula itself is reliable for UI purposes.

---

## Known Limitations

The following gaps apply specifically to `deposit_by_ledger` deposits. All other deposit types (`deposit`, `deposit_for`) are unaffected.

| Limitation | Detail |
|---|---|
| **No frontend support** | The React UI only exposes `deposit` and `deposit_for`. Ledger-based deposits must be made via the Stellar CLI or a custom SDK integration. |
| **No maximum lock duration** | `deposit` and `deposit_for` reject lock durations longer than `max_lock_secs` (default 5 years). `deposit_by_ledger` only enforces a *minimum* gap of 12 ledgers (`MIN_LOCK_LEDGERS`). There is no equivalent upper-bound check on `unlock_ledger`, so arbitrarily far-future ledger numbers are accepted. |
| **`get_vault` returns `None`** | The `get_vault(depositor, id)` query only searches timestamp-based entries. To retrieve a ledger-based deposit, use `get_ledger_vault(depositor, id)` which returns `Option<LedgerVaultEntry>`. |
| **`time_remaining` is an estimate** | For ledger-based deposits, `time_remaining` returns `remaining_ledgers × 5` seconds. This is an approximation because actual ledger close times vary by ±1-2 seconds and are not exactly 5 seconds. **Do not rely on this value for precise scheduling or critical timing.** Use this estimate for UI display and rough scheduling only. The actual withdrawal check (`current_ledger >= unlock_ledger`) is exact and will work correctly. |
| **`get_deposits_page` excludes ledger-based deposits** | The paginated flat deposits view only iterates over timestamp-based `VaultEntry` records. To enumerate ledger-based deposits, use `get_depositors` + `get_deposit_ids` + `get_ledger_vault`. |

These limitations are tracked as open issues and will be addressed in future releases.

---

```bash
make build            # Compile to WASM
make test             # Run all tests
make watch            # Auto-run tests on file change
make lint             # Clippy
make fmt              # Format
make check            # fmt + lint + test + audit + deny
make optimize         # Optimize WASM with soroban CLI
make check-wasm-size  # Fail if WASM > 64 KB
make dev              # Build + deploy locally + start frontend
make deploy-testnet   # Deploy to Stellar testnet
make smoke-test-local # End-to-end test against local node
make install-tools    # Install all recommended dev tools
make audit            # cargo audit (security)
make deny             # cargo deny (licenses)
```

---

## Use Cases

- **Savings** - Lock funds for a fixed period to enforce discipline
- **Token vesting** - Team/investor tokens released on a schedule
- **HODL commitments** - Commit to not selling until a future date
- **Escrow** - Time-gated release of payment

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CHANGELOG.md](./CHANGELOG.md).

## License

MIT
