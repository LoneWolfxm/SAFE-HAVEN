// ============================================================
//  Wallet Context — manages multi-wallet connection via stellar-wallets-kit
// ============================================================

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import toast from 'react-hot-toast'
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit'
import {
  FREIGHTER_ID,
  WalletNetwork,
  FreighterModule,
  xBullModule,
  AlbedoModule,
  LobstrModule,
  HanaModule,
} from '@creit.tech/stellar-wallets-kit'
import type { WalletInfo } from '../types'
import { shortAddr } from '../lib/format'
import { CONFIG } from '../config'

interface WalletContextValue {
  wallet: WalletInfo | null
  wallets: WalletInfo[]
  isConnecting: boolean
  isRestoringSession: boolean
  networkMismatch: boolean
  connect: () => Promise<void>
  disconnect: () => void
  signTransaction: (xdr: string) => Promise<SigningResult>
}

const WalletContext = createContext<WalletContextValue | null>(null)

/**
 * Initialize wallet state synchronously from localStorage
 * Returns [wallet, isRestoringSession] where isRestoringSession is true if we found
 * a saved wallet that needs async validation
 */
function initializeWalletFromStorage(): [WalletInfo | null, boolean] {
  // Only run on client side
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [null, false]
  }

  const saved = localStorage.getItem('tlv_wallet_address')
  if (!saved) {
    return [null, false]
  }

  // We found a saved address — restore it immediately, but mark as restoring
  // so the UI knows it's pending async validation
  return [{ address: saved, displayAddress: shortAddr(saved) }, true]
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet]           = useState<WalletInfo | null>(null)
  const [wallets, setWallets]         = useState<WalletInfo[]>([])
  const [isConnecting, setConnecting] = useState(false)
  const walletKitRef = useRef<StellarWalletsKit | null>(null)

  // Determine network
  const isMainnet = CONFIG.NETWORK_PASSPHRASE === 'Public Global Stellar Network ; September 2015'
  const network = isMainnet ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET

  // Initialize wallet kit on mount
  useEffect(() => {
    try {
      walletKitRef.current = new StellarWalletsKit({
        network,
        selectedWalletId: FREIGHTER_ID,
        modules: [
          new FreighterModule(),
          new xBullModule(),
          new AlbedoModule(),
          new LobstrModule(),
          new HanaModule(),
        ],
      })
    } catch (e) {
      console.error('Failed to initialize StellarWalletsKit:', e)
    }
  }, [network])

  // Restore session on mount — re-validate against the live wallet address
  // to guard against stale sessions after an account or network switch (#12).
  useEffect(() => {
    if (!walletKitRef.current) return

    const saved = localStorage.getItem('tlv_wallet_address')
    const savedWallets = localStorage.getItem('tlv_wallets')
    let restoredWallets: WalletInfo[] = []
    try {
      restoredWallets = savedWallets ? JSON.parse(savedWallets) as WalletInfo[] : []
    } catch {
      localStorage.removeItem('tlv_wallets')
    }
    if (saved && !restoredWallets.some((item) => item.address === saved)) {
      restoredWallets = [{ address: saved, displayAddress: shortAddr(saved) }, ...restoredWallets]
    }
    setWallets(restoredWallets)
    if (!saved) return

    const restore = async () => {
      try {
        // Try to get the current address from the wallet kit
        try {
          const result = await walletKitRef.current!.getAddress()
          if (!result || !result.address) {
            localStorage.removeItem('tlv_wallet_address')
            return
          }

          const { address } = result
          if (address !== saved) {
            // Active account changed — clear the stale session.
            localStorage.removeItem('tlv_wallet_address')
            toast('Wallet account changed — please reconnect.', { icon: '🔄' })
            return
          }

          // Address is still valid; restore the session.
          setWallet({ address: saved, displayAddress: shortAddr(saved) })
        } catch {
          // Not connected — clear the stale session.
          localStorage.removeItem('tlv_wallet_address')
        }
      } catch (e) {
        console.error('Session restore failed:', e)
        localStorage.removeItem('tlv_wallet_address')
      }
    }

    restore()
  }, [walletKitRef])

  const connect = useCallback(async () => {
    setConnecting(true)
    setNetworkMismatch(false)
    try {
      if (!walletKitRef.current) {
        toast.error('Wallet initialization failed. Please refresh the page.')
        return
      }

      // Get the address from the wallet kit (this will prompt the user)
      const result = await walletKitRef.current.getAddress()
      if (!result || !result.address) {
        toast.error('Could not get address from wallet')
        return
      }

      const { address } = result
      const info: WalletInfo = { address, displayAddress: shortAddr(address) }
      setWallet(info)
      setNetworkMismatch(!!hasNetworkMismatch)
      localStorage.setItem('tlv_wallet_address', address)
      
      if (hasNetworkMismatch) {
        // Show a warning instead of success
        toast.error(
          `Network mismatch! Wallet: ${walletNetworkPassphrase}, App: ${CONFIG.NETWORK_PASSPHRASE}`,
          { duration: 0 }
        )
      } else {
        toast.success(`Connected: ${shortAddr(address)}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to connect wallet'
      // Suppress rejection/cancellation messages from user-initiated cancellations
      if (!msg.toLowerCase().includes('reject') && !msg.toLowerCase().includes('cancel')) {
        toast.error(msg, { duration: 8000 })
      }
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setWallet(null)
    setNetworkMismatch(false)
    localStorage.removeItem('tlv_wallet_address')
    toast.success('Wallet disconnected')
  }, [persistWallets, wallet, wallets])

  const switchWallet = useCallback((address: string) => {
    const next = wallets.find((item) => item.address === address)
    if (!next) return
    setWallet(next)
    localStorage.setItem('tlv_wallet_address', next.address)
  }, [wallets])

  const signTransaction = useCallback(async (txXdr: string): Promise<SigningResult> => {
    // Check for network mismatch before attempting to sign
    if (networkMismatch) {
      const msg = `Network mismatch: Wallet is on ${wallet?.walletNetwork}, but app is on ${CONFIG.NETWORK_PASSPHRASE}`
      toast.error(msg, { duration: 0 })
      return { signed: false, rejected: false, error: msg }
    }

    try {
      if (!walletKitRef.current) {
        toast.error('Wallet not initialized')
        return null
      }

      const result = await walletKitRef.current.signTransaction(txXdr, {
        networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
      })

      if (!result || !result.signedTxXdr) {
        toast.error('Failed to sign transaction')
        return null
      }

      return result.signedTxXdr
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Signing rejected'
      const isUserReject = msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')
      
      if (!isUserReject) {
        toast.error(`Signing error: ${msg}`)
        return { signed: false, rejected: false, error: msg }
      }
      
      // User rejection — silent, just return rejected flag
      return { signed: false, rejected: true }
    }
  }, [networkMismatch, wallet?.walletNetwork])

  return (
    <WalletContext.Provider value={{ wallet, isConnecting, isRestoringSession, networkMismatch, connect, disconnect, signTransaction }}>
      {children}
    </WalletContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
