import type { ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import type { ColorScheme } from '../types';
import { Wordmark } from './Wordmark';
import { WalletButton } from './WalletButton';
import { pickTextColor } from '../lib/contrastText';

interface PageHeaderProps {
  title: ReactNode;
  colors: ColorScheme;
  // Which page we're on; the matching icon is hidden so users don't navigate
  // to the page they're already viewing.
  current: 'mazes' | 'gallery';
}

export function PageHeader({ title, colors, current }: PageHeaderProps) {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const fg = pickTextColor(colors.headerBackgroundColor);

  return (
    <div
      style={{
        ...styles.header,
        backgroundColor: colors.headerBackgroundColor,
      }}
    >
      <button
        type="button"
        onClick={() => navigate('/')}
        style={styles.wordmarkButton}
        aria-label="Back to game"
        title="Back to game"
      >
        <Wordmark
          text={'maze♚\n♚king'}
          pixelSize={3}
          color={colors.textBackgroundColor}
          zkColor={colors.zkBackgroundColor}
          crownColor={colors.crownBackgroundColor}
          ariaLabel="MAZEKING"
        />
      </button>
      <h1 style={{ ...styles.pageTitle, color: fg }}>{title}</h1>
      <div style={styles.spacer} />
      <div style={styles.iconRow}>
        <WalletButton colors={colors} />
        {current !== 'mazes' && isConnected && (
          <Link
            to="/mazes"
            style={{ ...styles.iconLink, borderColor: fg, color: fg }}
            title="My Mazes"
            aria-label="Go to my mazes"
          >
            👤
          </Link>
        )}
        {current !== 'gallery' && (
          <Link
            to="/gallery"
            style={{ ...styles.iconLink, borderColor: fg, color: fg }}
            title="Gallery"
            aria-label="Go to public gallery"
          >
            🖼
          </Link>
        )}
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{
            ...styles.backButton,
            backgroundColor: colors.uiAccentColor,
            color: pickTextColor(colors.uiAccentColor),
          }}
          aria-label="Back to game"
          title="Back to game"
        >
          ← Game
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '6px 16px',
    minHeight: '52px',
    flexShrink: 0,
  },
  wordmarkButton: {
    flexShrink: 0,
    background: 'transparent',
    border: 'none',
    padding: 0,
    margin: 0,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  pageTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  spacer: {
    flex: 1,
  },
  iconRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  iconLink: {
    width: '36px',
    height: '36px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.35)',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    lineHeight: 1,
    textDecoration: 'none',
  },
  backButton: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
};
