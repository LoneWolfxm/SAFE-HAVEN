// ============================================================
//  SAFE-HAVEN -- Soroban Smart Contract
//  Stellar Blockchain | Soroban SDK v22
// ============================================================

#![no_std]
// Deny silent integer overflow in all arithmetic operations.
// All arithmetic must use checked, saturating, or wrapping variants.
// This catches potential overflow bugs at compile time rather than silently
// wrapping at runtime in the deterministic Soroban WASM environment.
#![deny(clippy::arithmetic_side_effects)]

mod constants;
mod contract;
mod errors;
mod events;
mod storage;
mod types;

pub use constants::{
    EPOCH_SIZE_LEDGERS, MAX_BATCH_SIZE, MAX_DEPOSIT_AMOUNT, MAX_LOCK_DURATION_SECS,
    MIN_LOCK_DURATION_SECS, WITHDRAWAL_LIMIT_PER_EPOCH,
};

pub use types::{
    DepositType, MultiTokenVaultEntry, Page, TokenDeposit, STORAGE_VERSION, MAX_TOKENS_PER_DEPOSIT,
};

pub use contract::SafeHaven;
pub use contract::SafeHavenClient;

#[cfg(test)]
mod test;
