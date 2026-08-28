import { useState } from 'react'
import { useWallet } from '../context/WalletContext'
import { useNetwork } from '../context/NetworkContext'
import { shortAddr } from '../lib/format'
import { CONFIG } from '../config'
import { BuyTokensModal } from './BuyTokensModal'
import { NetworkSwitcher } from './NetworkSwitcher'
import { SecurityTipsModal } from './SecurityTipsModal'
import { SmallBalanceWarning } from './SmallBalanceWarning'
import { PublicWifiWarning } from './PublicWifiWarning'
import { HelpModal } from './HelpModal'

interface HeaderProps {
  isPaused: boolean
}

export function Header({ isPaused }: HeaderProps) {
  const { wallet, isConnecting, isRestoringSession, networkMismatch, connect, disconnect } = useWallet()
  const { isMismatched } = useNetwork()
  const [showBuyModal, setShowBuyModal] = useState(false)
  const [showSecurityTips, setShowSecurityTips] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  return (
    <>
      {/* Public WiFi Warning */}
      <PublicWifiWarning enabled={!!wallet} />

      {/* Small Balance Warning */}
      {wallet && (
        <SmallBalanceWarning
          walletAddress={wallet.address}
          threshold={10}
          horizonUrl={CONFIG.HORIZON_URL}
        />
      )}

      {/* Network mismatch warning banner */}
      {networkMismatch && wallet?.walletNetwork && (
        <div className="w-full bg-red-900/30 border-b border-red-700/40 px-4 py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 text-red-400 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-400 mb-1">Network Mismatch</p>
              <p className="text-xs text-red-300">
                Your Freighter wallet is on <span className="font-mono">{wallet.walletNetwork}</span>, but this app is configured for <span className="font-mono">{CONFIG.NETWORK_PASSPHRASE}</span>. 
                Disconnect and switch your wallet to the correct network.
              </p>
            </div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-stellar-600 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={1.8}>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="12" cy="12" r="3" />
              <path d="M12 7v1M12 16v1M7 12h1M16 12h1" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">SAFE-HAVEN</p>
            <p className="text-xs text-slate-500 leading-tight">Stellar · Soroban</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Contract paused badge */}
          {isPaused && (
            <span className="badge-red hidden sm:flex">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              Contract Paused
            </span>
          )}

          {/* Network Switcher */}
          <NetworkSwitcher />

          {/* Buy Tokens button (only show if Ramp is enabled and wallet connected) */}
          {CONFIG.RAMP_ENABLED && wallet && !networkMismatch && (
            <button
              onClick={() => setShowBuyModal(true)}
              className="btn-secondary text-xs hidden sm:flex items-center gap-2"
              title="Buy tokens with fiat currency"
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" />
              </svg>
              Buy Tokens
            </button>
          )}

          {/* Help button */}
          <button
            onClick={() => setShowHelp(true)}
            className="btn-secondary text-xs hidden sm:flex items-center gap-2"
            title="View help and FAQ"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            Help
          </button>

          {/* Security Tips button */}
          <button
            onClick={() => setShowSecurityTips(true)}
            className="btn-secondary text-xs hidden sm:flex items-center gap-2"
            title="View security tips and best practices"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            Security
          </button>

          {/* Wallet button / skeleton */}
          {isRestoringSession ? (
            // Show skeleton while validating the restored session
            <div className="flex items-center gap-2">
              <div className="hidden sm:block text-right">
                <div className="h-3 w-16 bg-slate-700/40 rounded animate-pulse mb-1" />
                <div className="h-4 w-32 bg-slate-700/40 rounded animate-pulse" />
              </div>
              <div className="w-24 h-9 bg-slate-700/40 rounded-lg animate-pulse" />
            </div>
          ) : wallet ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:block text-right">
                <p className="text-xs text-slate-400">Active wallet</p>
                <p className="text-sm font-mono text-slate-200">{shortAddr(wallet.address)}</p>
              </div>
              <div className="relative group">
                <button
                  onClick={disconnect}
                  className="btn-secondary text-xs px-3 py-2"
                  title="Disconnect from this app (Freighter access not revoked)"
                >
                  Disconnect
                </button>
                {/* Tooltip explaining the disconnect limitation */}
                <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block">
                  <div className="bg-slate-900 border border-slate-700 rounded-lg p-2 w-48 text-xs text-slate-300 z-50">
                    <p className="font-semibold text-slate-200 mb-1">Disconnect removes your session from this app</p>
                    <p className="text-slate-400">Freighter access is NOT revoked — you'll be auto-reconnected on next load. To fully disconnect, revoke access in Freighter's extension settings.</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="btn-primary"
            >
              {isConnecting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connecting…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6z" />
                    <path d="M10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                  </svg>
                  Connect Wallet
                </>
              )}
            </button>
          )}
        </div>
      </div>
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </header>

    {/* Buy Tokens Modal */}
    <BuyTokensModal isOpen={showBuyModal} onClose={() => setShowBuyModal(false)} />

    {/* Help Modal */}
    <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />

    {/* Security Tips Modal */}
    <SecurityTipsModal isOpen={showSecurityTips} onClose={() => setShowSecurityTips(false)} />
    </>
  )
}
