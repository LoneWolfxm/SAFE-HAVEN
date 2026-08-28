import { useState } from 'react'
import toast from 'react-hot-toast'
import { useWallet } from '../context/WalletContext'
import { usePrice } from '../hooks/usePrice'
import { TxStatusBadge } from '../components/TxStatusBadge'
import { buildWithdraw, buildCancelDeposit, submitTx, getVault, getTimeRemaining } from '../lib/stellar'
import { formatUnlockDate, formatCountdown, formatBps, formatTokenWithUsd, formatPriceUpdate } from '../lib/format'
import type { TxStatus, VaultEntry } from '../types'
import { CONFIG } from '../config'

export function WithdrawPage() {
  const { wallet, signTransaction } = useWallet()
  const { getPrice } = usePrice()

  const [depositId, setDepositId] = useState('')
  const [lookedUp,  setLookedUp]  = useState<(VaultEntry & { timeRemaining: number }) | null>(null)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const [looking,   setLooking]   = useState(false)

  const [txStatus, setTxStatus] = useState<TxStatus>('idle')
  const [txHash,   setTxHash]   = useState<string | undefined>()
  const [txError,  setTxError]  = useState<string | undefined>()

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
        setLookedUp({ ...entry, timeRemaining: remaining })
      }
    } catch (e) {
      setLookupErr(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLooking(false)
    }
  }

  async function execute(method: 'withdraw' | 'cancel') {
    if (!wallet || !lookedUp) return
    const id = parseInt(depositId, 10)

    setTxStatus('signing')
    setTxError(undefined)
    setTxHash(undefined)

    try {
      const xdr = method === 'withdraw'
        ? await buildWithdraw(wallet.address, id)
        : await buildCancelDeposit(wallet.address, id)

      if (!xdr) throw new Error('Failed to build transaction')

      const signed = await signTransaction(xdr)
      if (!signed) { setTxStatus('idle'); return }

      setTxStatus('submitting')
      const result = await submitTx(signed)

      if (result.success) {
        setTxStatus('success')
        setTxHash(result.txHash)
        toast.success(method === 'withdraw' ? 'Withdrawal successful!' : 'Deposit cancelled.')
        setLookedUp(null)
        setDepositId('')
      } else {
        setTxStatus('error')
        setTxError(result.error)
        toast.error(result.error ?? 'Transaction failed')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unexpected error'
      setTxStatus('error')
      setTxError(msg)
      toast.error(msg)
    }
  }

  if (!wallet) {
    return (
      <div className="card p-10 text-center max-w-lg">
        <p className="text-slate-400">Connect your wallet to withdraw tokens.</p>
      </div>
    )
  }

  const isXlm     = lookedUp?.token === CONFIG.NATIVE_TOKEN
  const isUnlocked = (lookedUp?.timeRemaining ?? 1) === 0
  const penalty    = lookedUp && !isUnlocked
    ? (lookedUp.amount * BigInt(lookedUp.penaltyBps)) / 10_000n
    : 0n
  const refund     = lookedUp ? lookedUp.amount - penalty : 0n

  // Price data
  const priceData = isXlm ? getPrice('native') : null
  const priceUsd = priceData?.usd
  const priceUpdateStr = priceData ? formatPriceUpdate(priceData.lastUpdated) : null

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
            ) : (
              <span className="badge-yellow countdown-active">
                {formatCountdown(lookedUp.timeRemaining)} remaining
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-y-3 text-sm">
            <span className="text-slate-400">Amount</span>
            <span className="font-medium">{formatTokenWithUsd(lookedUp.amount, isXlm ? 'XLM' : 'tokens', priceUsd)}</span>
            {priceUpdateStr && (
              <>
                <span></span>
                <span className="text-xs text-slate-500">{priceUpdateStr}</span>
              </>
            )}

            <span className="text-slate-400">Unlocks</span>
            <span>{formatUnlockDate(lookedUp.unlockTime)}</span>

            <span className="text-slate-400">Penalty</span>
            <span className={lookedUp.penaltyBps > 0 ? 'text-orange-400' : 'text-slate-300'}>
              {formatBps(lookedUp.penaltyBps)}
            </span>

            {!isUnlocked && lookedUp.penaltyBps > 0 && (
              <>
                <span className="text-slate-400">You'd receive</span>
                <span className="text-slate-200">{formatTokenWithUsd(refund, isXlm ? 'XLM' : 'tokens', priceUsd)}</span>
              </>
            )}
          </div>

          <TxStatusBadge status={txStatus} txHash={txHash} error={txError} />

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
            ) : (
              <button
                className="btn-danger flex-1"
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
    </div>
  )
}
