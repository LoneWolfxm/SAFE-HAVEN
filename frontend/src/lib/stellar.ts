// ============================================================
//  Stellar / Soroban contract interaction helpers
// ============================================================

import {
  Contract,
  rpc as StellarRpc,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk'
import { CONFIG } from '../config'
import type { VaultEntry, ContractResult } from '../types'

// ----------------------------------------------------------------
//  RPC client (singleton)
// ----------------------------------------------------------------

let _rpc: StellarRpc.Server | null = null

export function getRpc(): StellarRpc.Server {
  if (!_rpc) {
    _rpc = new StellarRpc.Server(CONFIG.RPC_URL, { allowHttp: CONFIG.RPC_URL.startsWith('http://') })
  }
  return _rpc
}

// ----------------------------------------------------------------
//  Address helpers
// ----------------------------------------------------------------

export function shortAddress(addr: string): string {
  if (addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// ----------------------------------------------------------------
//  scVal parsing helpers
// ----------------------------------------------------------------

function parseVaultEntry(scVal: xdr.ScVal): VaultEntry | null {
  try {
    const raw = scValToNative(scVal) as Record<string, unknown>
    return {
      token:      raw['token']       as string,
      amount:     BigInt(raw['amount'] as string | number),
      unlockTime: Number(raw['unlock_time']),
      depositor:  raw['depositor']   as string,
      penaltyBps: Number(raw['penalty_bps']),
    }
  } catch {
    return null
  }
}

// ----------------------------------------------------------------
//  Read-only contract queries (no signing needed)
// ----------------------------------------------------------------

/**
 * Source account for simulation transactions.
 *
 * Priority:
 *  1. Connected wallet address passed in (best – always exists on-chain)
 *  2. VITE_SIMULATION_ACCOUNT env var (operator-configured per-network)
 *  3. The contract ID itself as a last-resort fallback (Soroban simulation
 *     does not validate the source account's on-chain existence for read-only
 *     calls, so this works even when the account isn't funded)
 */
function getSimulationAccount(): string {
  return (import.meta.env.VITE_SIMULATION_ACCOUNT as string | undefined) ?? CONFIG.CONTRACT_ID
}

async function simulateReadOnly<T>(
  method: string,
  args: xdr.ScVal[],
  parser: (v: xdr.ScVal) => T,
  /** Optional connected wallet address — used as the source account when provided */
  walletAddress?: string,
): Promise<T | null> {
  try {
    const rpc = getRpc()
    const contract = new Contract(CONFIG.CONTRACT_ID)

    // Resolve the source account: wallet > env config > contract ID as fallback
    const sourceAddress = walletAddress ?? getSimulationAccount()

    let account: Awaited<ReturnType<typeof rpc.getAccount>>
    try {
      account = await rpc.getAccount(sourceAddress)
    } catch {
      // Account not found on-chain — build a minimal synthetic account.
      // Soroban ignores the sequence number for read-only simulations.
      const { Account } = await import('@stellar/stellar-sdk')
      account = new Account(sourceAddress, '0') as unknown as Awaited<ReturnType<typeof rpc.getAccount>>
    }

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build()

    const result = await rpc.simulateTransaction(tx)
    if (StellarRpc.Api.isSimulationError(result)) {
      console.error('Simulation error:', result.error)
      return null
    }
    if (!result.result) return null
    return parser(result.result.retval)
  } catch (e) {
    console.error(`simulateReadOnly(${method}) failed:`, e)
    return null
  }
}

/** Fetch a single vault entry */
export async function getVault(depositor: string, depositId: number): Promise<VaultEntry | null> {
  return simulateReadOnly(
    'get_vault',
    [
      new Address(depositor).toScVal(),
      nativeToScVal(depositId, { type: 'u32' }),
    ],
    (v) => {
      if (v.switch() === xdr.ScValType.scvVoid()) return null
      return parseVaultEntry(v)
    },
  )
}

/** Fetch all deposit IDs for an address */
export async function getDepositIds(depositor: string): Promise<number[]> {
  const result = await simulateReadOnly(
    'get_deposit_ids',
    [new Address(depositor).toScVal()],
    (v) => scValToNative(v) as number[],
  )
  return result ?? []
}

/** Fetch time remaining in seconds */
export async function getTimeRemaining(depositor: string, depositId: number): Promise<number> {
  const result = await simulateReadOnly(
    'time_remaining',
    [
      new Address(depositor).toScVal(),
      nativeToScVal(depositId, { type: 'u32' }),
    ],
    (v) => Number(scValToNative(v)),
  )
  return result ?? 0
}

/** Fetch current ledger time */
export async function getLedgerTime(): Promise<number> {
  const result = await simulateReadOnly(
    'get_time',
    [],
    (v) => Number(scValToNative(v)),
  )
  return result ?? Math.floor(Date.now() / 1000)
}

/** Fetch admin address */
export async function getAdmin(): Promise<string | null> {
  const result = await simulateReadOnly(
    'get_admin',
    [],
    (v) => {
      if (v.switch() === xdr.ScValType.scvVoid()) return null
      return scValToNative(v) as string
    },
  )
  return result ?? null
}

/** Check if contract is paused */
export async function isPaused(): Promise<boolean> {
  const result = await simulateReadOnly(
    'is_paused',
    [],
    (v) => scValToNative(v) as boolean,
  )
  return result ?? false
}

/** Fetch fee recipient */
export async function getFeeRecipient(): Promise<string | null> {
  const result = await simulateReadOnly(
    'get_fee_recipient',
    [],
    (v) => {
      if (v.switch() === xdr.ScValType.scvVoid()) return null
      return scValToNative(v) as string
    },
  )
  return result ?? null
}

/** Fetch contract constants */
export async function getConstants(): Promise<{ maxDeposit: bigint; maxLockSecs: number } | null> {
  return simulateReadOnly(
    'get_constants',
    [],
    (v) => {
      const [maxDeposit, maxLockSecs] = scValToNative(v) as [string, string]
      return { maxDeposit: BigInt(maxDeposit), maxLockSecs: Number(maxLockSecs) }
    },
  )
}

/** Fetch depositor count */
export async function getDepositorCount(): Promise<number> {
  const result = await simulateReadOnly(
    'get_depositor_count',
    [],
    (v) => Number(scValToNative(v)),
  )
  return result ?? 0
}

// ----------------------------------------------------------------
//  Transaction building helpers (for wallet signing)
// ----------------------------------------------------------------

/**
 * Build an unsigned transaction for a mutating contract call.
 * The caller must sign it with their wallet, then submit via submitTx().
 */
export async function buildTx(
  callerAddress: string,
  method: string,
  args: xdr.ScVal[],
): Promise<string | null> {
  try {
    const rpc = getRpc()
    const contract = new Contract(CONFIG.CONTRACT_ID)
    const account = await rpc.getAccount(callerAddress)

    const tx = new TransactionBuilder(account, {
      fee: (Number(BASE_FEE) * 10).toString(), // bump fee for Soroban
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(300)
      .build()

    // Simulate to get resource requirements
    const sim = await rpc.simulateTransaction(tx)
    if (StellarRpc.Api.isSimulationError(sim)) {
      console.error('Simulation error:', sim.error)
      return null
    }

    // Assemble with proper resource data
    const assembled = StellarRpc.assembleTransaction(tx, sim).build()
    return assembled.toXDR()
  } catch (e) {
    console.error(`buildTx(${method}) failed:`, e)
    return null
  }
}

/** Submit a signed transaction XDR and wait for confirmation */
export async function submitTx(signedXdr: string): Promise<ContractResult<string>> {
  try {
    const rpc = getRpc()
    const tx = TransactionBuilder.fromXDR(signedXdr, CONFIG.NETWORK_PASSPHRASE)
    const response = await rpc.sendTransaction(tx)

    if (response.status === 'ERROR') {
      return { success: false, error: response.errorResult?.toXDR('base64') ?? 'Transaction failed' }
    }

    // Poll for confirmation
    let attempts = 0
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 2000))
      const status = await rpc.getTransaction(response.hash)
      if (status.status === StellarRpc.Api.GetTransactionStatus.SUCCESS) {
        return { success: true, txHash: response.hash }
      }
      if (status.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
        return { success: false, error: 'Transaction failed on-chain', txHash: response.hash }
      }
      attempts++
    }
    return { success: false, error: 'Transaction confirmation timeout', txHash: response.hash }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  }
}

// ----------------------------------------------------------------
//  Contract call builders (return unsigned XDR)
// ----------------------------------------------------------------

export async function buildDeposit(
  depositor: string,
  tokenAddress: string,
  amount: bigint,
  unlockTime: number,
  penaltyBps: number,
): Promise<string | null> {
  return buildTx(depositor, 'deposit', [
    new Address(depositor).toScVal(),
    new Address(tokenAddress).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
    nativeToScVal(unlockTime, { type: 'u64' }),
    nativeToScVal(penaltyBps, { type: 'u32' }),
  ])
}

export async function buildWithdraw(
  depositor: string,
  depositId: number,
): Promise<string | null> {
  return buildTx(depositor, 'withdraw', [
    new Address(depositor).toScVal(),
    nativeToScVal(depositId, { type: 'u32' }),
  ])
}

export async function buildCancelDeposit(
  depositor: string,
  depositId: number,
): Promise<string | null> {
  return buildTx(depositor, 'cancel_deposit', [
    new Address(depositor).toScVal(),
    nativeToScVal(depositId, { type: 'u32' }),
  ])
}

export async function buildPause(admin: string): Promise<string | null> {
  return buildTx(admin, 'pause', [new Address(admin).toScVal()])
}

export async function buildUnpause(admin: string): Promise<string | null> {
  return buildTx(admin, 'unpause', [new Address(admin).toScVal()])
}

export async function buildEmergencyWithdraw(
  admin: string,
  depositor: string,
  depositId: number,
): Promise<string | null> {
  return buildTx(admin, 'emergency_withdraw', [
    new Address(admin).toScVal(),
    new Address(depositor).toScVal(),
    nativeToScVal(depositId, { type: 'u32' }),
  ])
}
