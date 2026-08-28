import { useState, useRef, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useWallet } from '../context/WalletContext'
import { useContractLogs } from '../context/ContractLogsContext'
import { TxStatusBadge } from '../components/TxStatusBadge'
import { TwoFAVerification } from '../components/TwoFAVerification'
import { buildWithdraw, buildCancelDeposit, submitTx, getVault, getTimeRemaining } from '../lib/stellar'
import { stroopsToXlm, formatUnlockDate, formatCountdown, formatBps } from '../lib/format'
import { useTokenSymbol } from '../hooks/useTokenSymbol'
import type { TxStatus, VaultEntry } from '../types'

type LookedUpEntry = VaultEntry & {
  timeRemaining: number
  /** Whether the chain has confirmed timeRemaining === 0 for this entry. */
  unlockVerified: boolean
}

export function WithdrawPage() {
  const { wallet, isRestoringSession, signTransaction } = useWallet()
  const { addLog, updateLog } = useContractLogs()

  const [depositId, setDepositId] = useState('')
  const [lookedUp,  setLookedUp]  = useState<LookedUpEntry | null>(null)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const [looking,   setLooking]   = useState(false)

  const [txStatus, setTxStatus] = useState<TxStatus>('idle')
  const [txHash,   setTxHash]   = useState<string | undefined>()
  const [txError,  setTxError]  = useState<string | undefined>()

  // Guard against concurrent execute() calls (e.g. rapid double-click or
  // two buttons triggered in quick succession).
  const executing = useRef(false)
  // Guard against concurrent chain re-verifications.
  const verifying = useRef(false)

  const isPending = txStatus === 'signing' || txStatus === 'submitting' || txStatus === 'confirming'

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    if (!wallet) return
    setLooking(true)
    setLookupErr(null)
    setLookedUp(null)

    try {
      const id = parseInt(depositId, 10)
      const [entry, remaining] = await Promise.all([
        getVault(wallet.address, id),
        getTimeRemaining(wallet.address, id),
      ])
      if (!entry) {
        setLookupErr('No deposit found for this ID on your address.')
      } else {
        setLookedUp({
          ...entry,
          timeRemaining: remaining,
          // getTimeRemaining() is a live chain call — if it returns 0 the
          // vault is confirmed unlocked right now. No re-verification needed.
          unlockVerified: remaining === 0,
        })
      }
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLooking(false)
    }
  }

  // Live 1-second countdown for the looked-up vault.
  // When the local timer reaches 0, mark unlockVerified: false so the
  // chain re-verification effect below fires.
  useEffect(() => {
    if (!lookedUp || lookedUp.timeRemaining === 0) return

    const id = setInterval(() => {
      setLookedUp((prev) => {
        if (!prev || prev.timeRemaining === 0) return prev
        const next = prev.timeRemaining - 1
        if (next === 0) {
          // Just ticked to 0 — require a chain confirmation before enabling
          // the Withdraw button.
          return { ...prev, timeRemaining: 0, unlockVerified: false }
        }
        return { ...prev, timeRemaining: next }
      })
    }, 1000)

    return () => clearInterval(id)
  // Re-start the interval any time a new vault is looked up.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookedUp?.token, lookedUp?.unlockTime])

  // Chain re-verification: fires whenever the local countdown hits 0 but the
  // chain hasn't confirmed the unlock yet.
  const verifyUnlock = useCallback(async () => {
    if (!wallet || !lookedUp) return
    if (verifying.current) return
    verifying.current = true

    const id = parseInt(depositId, 10)
    try {
      const remaining = await getTimeRemaining(wallet.address, id)
      setLookedUp((prev) => {
        if (!prev) return prev
        if (remaining === 0) {
          return { ...prev, timeRemaining: 0, unlockVerified: true }
        }
        // Chain says still locked — correct the countdown and keep
        // unlockVerified: false until the next tick-to-0 cycle.
        return { ...prev, timeRemaining: remaining, unlockVerified: false }
      })
    } catch (e) {
      console.warn('WithdrawPage verifyUnlock failed:', e)
      // Leave unlockVerified: false; the user can re-look-up to retry.
    } finally {
      verifying.current = false
    }
  }, [wallet, lookedUp, depositId])

  useEffect(() => {
    if (lookedUp?.timeRemaining === 0 && lookedUp.unlockVerified === false) {
      void verifyUnlock()
    }
  }, [lookedUp, verifyUnlock])

  async function execute(method: 'withdraw' | 'cancel') {
    if (!wallet || !lookedUp) return
    // Prevent a second in-flight operation from clobbering shared tx state.
    if (executing.current) return
    executing.current = true

    const id = parseInt(depositId, 10)

    // Check if 2FA is required
    if (twoFAState.enabled) {
      setPendingMethod(method)
      setShow2FA(true)
      return
    }

    // Proceed without 2FA
    await executeTransaction(method, id)
  }

  async function executeTransaction(method: 'withdraw' | 'cancel', depositId: number) {
    if (!wallet) return

    setTxStatus('signing')
    setTxError(undefined)
    setTxHash(undefined)

    // Add pending log entry
    const logId = addLog({
      operation: method === 'withdraw' ? 'withdraw' : 'cancel_deposit',
      status: 'pending',
      initiator: wallet.address,
      parameters: { depositId: id },
    })

    try {
      const xdr = method === 'withdraw'
        ? await buildWithdraw(wallet.address, depositId)
        : await buildCancelDeposit(wallet.address, depositId)

      if (!xdr) throw new Error('Failed to build transaction')

      const signed = await signTransaction(xdr)
      if (!signed) { 
        setTxStatus('idle')
        updateLog(logId, {
          status: 'error',
          errorMessage: 'User rejected the transaction',
        })
        return
      }

      setTxStatus('submitting')
      const result = await submitTx(signed)

      if (result.success) {
        setTxStatus('success')
        setTxHash(result.txHash)
        updateLog(logId, {
          status: 'success',
          txHash: result.txHash,
        })
        toast.success(method === 'withdraw' ? 'Withdrawal successful!' : 'Deposit cancelled.')
        // Clear the deposit card, but intentionally leave txStatus/txHash set so
        // the TxStatusBadge rendered below the card remains visible with the
        // confirmation hash.
        setLookedUp(null)
        setDepositId('')
      } else {
        // Signing error: already toasted, but still reset state
        setTxStatus('idle')
        updateLog(logId, {
          status: 'error',
          errorMessage: result.error,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unexpected error'
      setTxStatus('error')
      setTxError(msg)
      updateLog(logId, {
        status: 'error',
        errorMessage: msg,
      })
      toast.error(msg)
    } finally {
      executing.current = false
    }
  }

  if (!wallet && !isRestoringSession) {
    return (
      <div className="card p-10 text-center max-w-lg">
        <p className="text-slate-400">Connect your wallet to withdraw tokens.</p>
      </div>
    )
  }

  const isUnlocked           = lookedUp?.timeRemaining === 0 && lookedUp.unlockVerified === true
  const isPendingVerification = lookedUp?.timeRemaining === 0 && lookedUp.unlockVerified === false
  const penalty = lookedUp && !isUnlocked
    ? (lookedUp.amount * BigInt(lookedUp.penaltyBps)) / 10_000n
    : 0n
  const refund = lookedUp ? lookedUp.amount - penalty : 0n

  // Fetch the token symbol whenever a vault is loaded. `useTokenSymbol` returns
  // "XLM" immediately for the native token and caches all other results.
  const { symbol: tokenSymbol, loading: symbolLoading } = useTokenSymbol(lookedUp?.token ?? null)
  // Label shown next to amounts: resolved symbol, a short fallback while loading,
  // or a truncated contract address when the SAC call fails.
  const tokenLabel = tokenSymbol
    ?? (symbolLoading ? '…' : lookedUp ? `${lookedUp.token.slice(0, 6)}…` : '')

  return (
    <div className="max-w-lg space-y-5">
      {/* Lookup form */}
      <div className="card p-6">
        <h2 className="font-semibold text-lg mb-1">Withdraw / Cancel a deposit</h2>
        <p className="text-sm text-slate-400 mb-5">Enter your deposit ID to look it up, then withdraw or cancel.</p>

        <form onSubmit={handleLookup} className="flex gap-2">
          <input
            className="input flex-1"
            type="number"
            min="0"
            placeholder="Deposit ID (e.g. 0)"
            value={depositId}
            onChange={(e) => { setDepositId(e.target.value); setLookedUp(null); setLookupErr(null) }}
            disabled={isPending}
          />
          <button
            type="submit"
            className="btn-secondary px-4"
            disabled={!depositId || looking || isPending}
          >
            {looking ? (
              <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
            ) : 'Look up'}
          </button>
        </form>

        {lookupErr && (
          <p className="text-sm text-red-400 mt-3">{lookupErr}</p>
        )}
      </div>

      {/* Deposit details */}
      {lookedUp && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Deposit #{depositId}</h3>
            {isUnlocked ? (
              <span className="badge-green">Unlocked</span>
            ) : isPendingVerification ? (
              <span className="badge-yellow">
                <span className="w-3 h-3 border-2 border-yellow-400/40 border-t-yellow-400 rounded-full animate-spin" />
                Verifying…
              </span>
            ) : (
              <span className="badge-yellow countdown-active">
                {formatCountdown(lookedUp.timeRemaining)} remaining
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-y-3 text-sm">
            <span className="text-slate-400">Amount</span>
            <span className="font-medium">{stroopsToXlm(lookedUp.amount)} {tokenLabel}</span>

            <span className="text-slate-400">Unlocks</span>
            <span>{formatUnlockDate(lookedUp.unlockTime)}</span>

            <span className="text-slate-400">Penalty</span>
            <span className={lookedUp.penaltyBps > 0 ? 'text-orange-400' : 'text-slate-300'}>
              {formatBps(lookedUp.penaltyBps)}
            </span>

            {!isUnlocked && !isPendingVerification && lookedUp.penaltyBps > 0 && (
              <>
                <span className="text-slate-400">You'd receive (approx.)</span>
                <span className="text-slate-200">{stroopsToXlm(refund)} {tokenLabel}</span>
              </>
            )}
          </div>

          <div className="flex gap-3">
            {isUnlocked ? (
              <button
                className="btn-primary flex-1"
                onClick={() => execute('withdraw')}
                disabled={isPending}
              >
                {isPending
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : 'Withdraw funds'
                }
              </button>
            ) : isPendingVerification ? (
              <button className="btn-primary flex-1" disabled>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Verifying unlock…
              </button>
            ) : (
              <button
                className={lookedUp.penaltyBps > 0 ? 'btn-danger flex-1' : 'btn-secondary flex-1'}
                onClick={() => execute('cancel')}
                disabled={isPending}
              >
                Cancel deposit
                {lookedUp.penaltyBps > 0 && ` (${formatBps(lookedUp.penaltyBps)} penalty)`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Transaction status — rendered outside the deposit card so it persists
          after a successful withdrawal clears lookedUp. */}
      {txStatus !== 'idle' && (
        <div className="card p-4 space-y-3">
          <TxStatusBadge status={txStatus} txHash={txHash} error={txError} />
          {txStatus === 'success' && (
            <button
              className="btn-secondary w-full text-sm"
              onClick={() => setTxStatus('idle')}
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StrategyOption({
  value,
  label,
  description,
  selected,
  onSelect,
  disabled,
}: {
  value: WithdrawalStrategy
  label: string
  description: string
  selected: boolean
  onSelect: (value: WithdrawalStrategy) => void
  disabled: boolean
}) {
  return (
    <label className={`cursor-pointer rounded-lg border p-3 transition-colors ${selected ? 'border-sky-400 bg-sky-400/10' : 'border-slate-700 hover:border-slate-500'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
      <input
        className="sr-only"
        type="radio"
        name="withdrawal-strategy"
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
        disabled={disabled}
      />
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-slate-500 mt-1">{description}</span>
    </label>
  )
}

function buildLinearSchedule(amount: bigint, unlockTime: number) {
  const now = Math.floor(Date.now() / 1000)
  const start = Math.min(now, unlockTime)
  const duration = Math.max(unlockTime - start, 0)
  return [1, 2, 3, 4].map((step) => ({
    date: start + Math.floor(duration * step / 4),
    amount: amount * BigInt(step) / 4n - amount * BigInt(step - 1) / 4n,
  }))
}
