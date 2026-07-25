import { useEffect, useRef, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import type { ColorScheme } from '../types';
import { useOwnedMazes } from '../hooks/useOwnedMazes';
import { pickTextColor } from '../lib/contrastText';

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
  const { address, isConnected, connector } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
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
        {isPending ? 'Connecting…' : 'Connect'}
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
        title={`${address}\n${connector?.name ?? 'wallet'}`}
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
            backgroundColor: colors.headerBackgroundColor,
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
          </div>

          {/* Switching accounts is a wallet-side action: re-running connect
              prompts the wallet's account picker. Wagmi has no generic
              "switch account" call, so this is the honest route. */}
          <button
            type="button"
            role="menuitem"
            data-testid="wallet-switch"
            onClick={() => {
              const first = connectors[0];
              if (first) connect({ connector: first });
              setOpen(false);
            }}
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
