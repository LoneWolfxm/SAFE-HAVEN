import { useState } from 'react'
import toast from 'react-hot-toast'
import { useWallet } from '../context/WalletContext'
import { usePrice } from '../hooks/usePrice'
import { TxStatusBadge } from '../components/TxStatusBadge'
import { buildDeposit, submitTx } from '../lib/stellar'
import { xlmToStroops, stroopsToXlm, formatBps, formatTokenWithUsd, formatPriceUpdate } from '../lib/format'
import type { TxStatus } from '../types'
import type { ContractInfo } from '../App'
import { CONFIG } from '../config'

interface DepositPageProps {
  contractInfo: ContractInfo
  onSuccess: () => void
}

export function DepositPage({ contractInfo, onSuccess }: DepositPageProps) {
  const { wallet, signTransaction } = useWallet()
  const { getPrice } = usePrice()

  const [tokenAddress, setTokenAddress] = useState<string>(CONFIG.NATIVE_TOKEN)
  const [amount,       setAmount]       = useState('')
  const [unlockDate,   setUnlockDate]   = useState('')
  const [penaltyBps,   setPenaltyBps]   = useState('0')

  const [txStatus, setTxStatus] = useState<TxStatus>('idle')
  const [txHash,   setTxHash]   = useState<string | undefined>()
  const [txError,  setTxError]  = useState<string | undefined>()

  // Derived validation
  const amountNum       = parseFloat(amount)
  const penaltyBpsNum   = parseInt(penaltyBps, 10)
  const unlockTimestamp = unlockDate ? Math.floor(new Date(unlockDate).getTime() / 1000) : 0
  const nowSecs         = Math.floor(Date.now() / 1000)
  const lockDuration    = unlockTimestamp - nowSecs

  // Price data (only XLM for now)
  const isXlm = tokenAddress === CONFIG.NATIVE_TOKEN
  const priceData = isXlm ? getPrice('native') : null
  const priceUsd = priceData?.usd
  const priceUpdateStr = priceData ? formatPriceUpdate(priceData.lastUpdated) : null

  const errors = {
    amount:    !amount ? '' : isNaN(amountNum) || amountNum <= 0 ? 'Amount must be > 0' :
               xlmToStroops(amount) > contractInfo.maxDeposit ? `Max: ${stroopsToXlm(contractInfo.maxDeposit)} XLM` : '',
    unlock:    !unlockDate ? '' : unlockTimestamp <= nowSecs ? 'Must be in the future' :
               lockDuration < CONFIG.MIN_LOCK_DURATION_SECS ? `Minimum lock: ${CONFIG.MIN_LOCK_DURATION_SECS}s` :
               lockDuration > contractInfo.maxLockSecs ? `Max lock: ${contractInfo.maxLockSecs}s` : '',
    penalty:   isNaN(penaltyBpsNum) || penaltyBpsNum < 0 || penaltyBpsNum > 10_000 ? '0–10000 only' : '',
  }
  const isValid = amount && unlockDate && !errors.amount && !errors.unlock && !errors.penalty && !contractInfo.paused

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!wallet || !isValid) return

    setTxStatus('signing')
    setTxError(undefined)
    setTxHash(undefined)

    try {
      const amountStroops = xlmToStroops(amount)
      const xdr = await buildDeposit(wallet.address, tokenAddress, amountStroops, unlockTimestamp, penaltyBpsNum)
      if (!xdr) throw new Error('Failed to build transaction')

      const signed = await signTransaction(xdr)
      if (!signed) { setTxStatus('idle'); return }

      setTxStatus('submitting')
      const result = await submitTx(signed)

      if (result.success) {
        setTxStatus('success')
        setTxHash(result.txHash)
        toast.success('Deposit successful! Your tokens are locked.')
        setAmount('')
        setUnlockDate('')
        setPenaltyBps('0')
        setTimeout(onSuccess, 1500)
      } else {
        setTxStatus('error')
        setTxError(result.error)
        toast.error(result.error ?? 'Deposit failed')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unexpected error'
      setTxStatus('error')
      setTxError(msg)
      toast.error(msg)
    }
  }

  const isPending = txStatus === 'signing' || txStatus === 'submitting' || txStatus === 'confirming'

  if (!wallet) {
    return (
      <div className="card p-10 text-center">
        <p className="text-slate-400">Connect your wallet to deposit tokens.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <div className="card p-6">
        <h2 className="font-semibold text-lg mb-1">Lock tokens in a vault</h2>
        <p className="text-sm text-slate-400 mb-6">
          Tokens will be transferred to the contract and locked until your chosen date.
        </p>

        {contractInfo.paused && (
          <div className="mb-5 p-3 rounded-xl bg-red-900/30 border border-red-700/40 text-red-400 text-sm">
            ⚠️ Contract is currently paused. Deposits are disabled.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {/* Token */}
          <div>
            <label className="label">Token contract address</label>
            <input
              className="input"
              type="text"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value.trim())}
              placeholder="CDLZFC3…"
              disabled={isPending}
            />
            <p className="text-xs text-slate-500 mt-1">Default: native XLM token</p>
          </div>

          {/* Amount */}
          <div>
            <label className="label">Amount (XLM)</label>
            <div className="relative">
              <input
                className={`input pr-14 ${errors.amount ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500' : ''}`}
                type="number"
                min="0"
                step="0.0000001"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0000000"
                disabled={isPending}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium pointer-events-none">XLM</span>
            </div>
            {errors.amount && <p className="text-xs text-red-400 mt-1">{errors.amount}</p>}
          </div>

          {/* Unlock date */}
          <div>
            <label className="label">Unlock date & time</label>
            <input
              className={`input ${errors.unlock ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500' : ''}`}
              type="datetime-local"
              value={unlockDate}
              onChange={(e) => setUnlockDate(e.target.value)}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              disabled={isPending}
            />
            {errors.unlock && <p className="text-xs text-red-400 mt-1">{errors.unlock}</p>}
          </div>

          {/* Penalty BPS */}
          <div>
            <label className="label">
              Early exit penalty (basis points)
              <span className="ml-1 text-slate-500 normal-case">— 0 = no penalty, 10000 = 100%</span>
            </label>
            <div className="relative">
              <input
                className={`input pr-20 ${errors.penalty ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500' : ''}`}
                type="number"
                min="0"
                max="10000"
                step="1"
                value={penaltyBps}
                onChange={(e) => setPenaltyBps(e.target.value)}
                disabled={isPending}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">
                {isNaN(penaltyBpsNum) ? '—' : formatBps(penaltyBpsNum)}
              </span>
            </div>
            {errors.penalty && <p className="text-xs text-red-400 mt-1">{errors.penalty}</p>}
          </div>

          {/* Summary */}
          {amount && unlockDate && !errors.amount && !errors.unlock && (
            <div className="bg-slate-800/60 rounded-xl p-4 text-sm space-y-1.5">
              <p className="text-slate-400 text-xs uppercase tracking-wide font-medium mb-2">Summary</p>
              <Row label="Locking" value={formatTokenWithUsd(xlmToStroops(amount), 'XLM', priceUsd)} />
              {priceUpdateStr && (
                <p className="text-xs text-slate-500">{priceUpdateStr}</p>
              )}
              <Row label="Until" value={new Date(unlockDate).toLocaleString()} />
              {penaltyBpsNum > 0 && <Row label="Early exit penalty" value={formatBps(penaltyBpsNum)} accent="orange" />}
            </div>
          )}

          <TxStatusBadge status={txStatus} txHash={txHash} error={txError} />

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={!isValid || isPending}
          >
            {isPending ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
            )}
            {isPending ? 'Processing…' : 'Lock Tokens'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${accent === 'orange' ? 'text-orange-400' : 'text-slate-200'}`}>{value}</span>
    </div>
  )
}
