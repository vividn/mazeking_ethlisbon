import { useEffect, useRef, useState } from 'react';
import {
  useAccount,
  useChains,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from 'wagmi';
import type { ColorScheme } from '../types';
import { useOwnedMazes } from '../hooks/useOwnedMazes';
import { pickTextColor } from '../lib/contrastText';

/**
 * Strip alpha from a theme colour.
 *
 * The header palette is deliberately translucent — `headerBackgroundColor` is
 * `hsla(h, 28%, 14%, 0.55)` — which is right for a bar laid over the maze but
 * wrong for a popover: the maze shows straight through the menu and makes it
 * hard to read. Reuse the hue, drop the transparency.
 */
export function opaque(color: string): string {
  const m = color.match(/^(hsla|rgba)\(([^)]+)\)$/i);
  if (!m) return color;
  const parts = m[2].split(',').map((p) => p.trim());
  if (parts.length === 4) parts.pop();
  return `${m[1].slice(0, 3)}(${parts.join(',')})`;
}

function shortAddress(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface WalletButtonProps {
  colors: ColorScheme;
}

/**
 * Header wallet control: connect, disconnect, switch wallet, and a count of
 * the maze NFTs the connected account holds.
 *
 * The count comes from `useOwnedMazes`, which discovers tokens by scanning
 * ERC-1155 transfer logs over a bounded block window. That means it can
 * under-report on a long-lived deployment whose mints fall outside the
 * window — the count is shown as-is rather than hidden, but treat it as
 * "what we can see" rather than a definitive balance.
 */
export function WalletButton({ colors }: WalletButtonProps) {
  const { address, isConnected, connector, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const chains = useChains();
  const { mazes, loading } = useOwnedMazes();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const fg = pickTextColor(colors.headerBackgroundColor);

  // Close the menu on outside click / Escape so it never traps the header.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /**
   * Re-open the wallet's account picker.
   *
   * Calling connect() again is a no-op while already connected, which is why
   * this appeared to do nothing. The working route is asking the provider to
   * re-grant `eth_accounts`, which is what makes MetaMask (and most injected
   * wallets) show the account chooser. Wallets that don't implement it — or a
   * user who dismisses the prompt — fall back to disconnecting, so the button
   * always leads somewhere.
   */
  const handleSwitchWallet = async () => {
    setOpen(false);
    try {
      const provider = (await connector?.getProvider()) as
        | { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
        | undefined;
      if (provider?.request) {
        await provider.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        });
        return;
      }
    } catch {
      // Unsupported method, or the user dismissed the prompt.
    }
    disconnect();
  };

  if (!isConnected || !address) {
    const first = connectors[0];
    return (
      <button
        type="button"
        data-testid="wallet-connect"
        disabled={!first || isPending}
        onClick={() => first && connect({ connector: first })}
        style={{ ...styles.pill, borderColor: fg, color: fg }}
        title={first ? `Connect with ${first.name}` : 'No wallet detected'}
      >
        {isPending ? 'Connecting…' : 'Connect Wallet'}
      </button>
    );
  }

  const count = mazes.length;

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <button
        type="button"
        data-testid="wallet-button"
        onClick={() => setOpen((v) => !v)}
        style={{ ...styles.pill, borderColor: fg, color: fg }}
        title={`${address}\n${connector?.name ?? 'wallet'}\n${chain?.name ?? 'unknown network'}`}
      >
        <span style={styles.addr}>{shortAddress(address)}</span>
        <span
          data-testid="wallet-maze-count"
          style={{ ...styles.badge, borderColor: fg }}
          title={
            loading
              ? 'Counting your mazes…'
              : `${count} maze NFT${count === 1 ? '' : 's'} found for this wallet`
          }
        >
          {loading ? '…' : `👑 ${count}`}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            ...styles.menu,
            backgroundColor: opaque(colors.headerBackgroundColor),
            borderColor: fg,
            color: fg,
          }}
        >
          <div style={styles.menuMeta}>
            <div style={styles.menuAddr}>{address}</div>
            <div style={styles.menuSub}>
              {connector?.name ?? 'wallet'} ·{' '}
              {loading ? 'counting mazes…' : `${count} maze NFTs`}
            </div>
            <div style={styles.menuSub}>
              network: {chain?.name ?? 'unrecognised'}
            </div>
          </div>

          {/* Chain switching. Wagmi only offers chains configured in
              wagmi.ts, so this is also the only in-app route between Sepolia
              and a local Anvil — previously impossible without editing wallet
              settings by hand. */}
          {chains.length > 1 && (
            <div style={styles.chainSection}>
              <div style={styles.sectionLabel}>Network</div>
              {chains.map((c) => {
                const active = c.id === chain?.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitem"
                    data-testid={`wallet-chain-${c.id}`}
                    disabled={active || switching}
                    onClick={() => {
                      switchChain({ chainId: c.id });
                      setOpen(false);
                    }}
                    style={{
                      ...styles.menuItem,
                      color: fg,
                      opacity: active ? 0.55 : 1,
                      cursor: active ? 'default' : 'pointer',
                    }}
                  >
                    {active ? '● ' : '○ '}
                    {c.name}
                    {active ? ' (current)' : ''}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            role="menuitem"
            data-testid="wallet-switch"
            onClick={handleSwitchWallet}
            style={{ ...styles.menuItem, color: fg }}
          >
            Switch wallet…
          </button>

          <button
            type="button"
            role="menuitem"
            data-testid="wallet-disconnect"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            style={{ ...styles.menuItem, color: fg }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'relative',
    display: 'inline-flex',
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '36px',
    padding: '0 10px',
    borderRadius: '18px',
    border: '1px solid',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '13px',
    whiteSpace: 'nowrap',
  },
  addr: {
    fontVariantNumeric: 'tabular-nums',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    borderLeft: '1px solid',
    paddingLeft: '8px',
    marginLeft: '2px',
    fontSize: '12px',
    opacity: 0.95,
  },
  menu: {
    position: 'absolute',
    top: '42px',
    right: 0,
    minWidth: '260px',
    border: '1px solid',
    borderRadius: '10px',
    padding: '8px',
    zIndex: 50,
    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
  },
  menuMeta: {
    padding: '6px 8px 10px',
  },
  menuAddr: {
    fontFamily: 'monospace',
    fontSize: '11px',
    wordBreak: 'break-all',
    opacity: 0.9,
  },
  menuSub: {
    fontSize: '11px',
    opacity: 0.7,
    marginTop: '4px',
  },
  chainSection: {
    borderTop: '1px solid rgba(128,128,128,0.35)',
    borderBottom: '1px solid rgba(128,128,128,0.35)',
    padding: '6px 0',
    margin: '4px 0',
  },
  sectionLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    opacity: 0.6,
    padding: '2px 8px 4px',
  },
  menuItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '13px',
    borderRadius: '6px',
  },
};
