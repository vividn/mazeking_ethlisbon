import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { isDebugSeedActive } from '../lib/debugSeed';
import { Maze, type MazeHandle } from './Maze';
import { Controls } from './Controls';
import { WinModal } from './WinModal';
import { HeaderSeedInput } from './HeaderSeedInput';
import { HistorySidebar } from './HistorySidebar';
import { MazeSizeWarning } from './MazeSizeWarning';
import { Wordmark } from './Wordmark';
import { WalletButton } from './WalletButton';
import { pickTextColor } from '../lib/contrastText';
import { DEFAULT_SEED } from '../App';
import { useIsMobile } from '../hooks/useIsMobile';
import { useGameState } from '../hooks/useGameState';
import { useGameKeyboard } from '../hooks/useGameKeyboard';
import robeUrl from '../glyphs/robe.png?url';
import scepterUrl from '../glyphs/scepter.png?url';

/**
 * Replay payload for an on-chain token. When set, Game decodes the layout
 * bytes via `mazeFromLayoutBytes` and uses the tokenId to derive a
 * mazeHash-aligned palette — no seed string required. This is how
 * MyMazes/Gallery hand off owned/registered tokens for replay regardless of
 * which device minted them.
 */
export interface ReplayPayload {
  layout: Uint8Array;
  tokenId: bigint;
  /** Optional original seed for display (unknown for tokens minted elsewhere). */
  seed?: string | null;
}

interface GameProps {
  initialSeed: string;
  onSeedChange: (seed: string) => void;
  active: boolean;
  /**
   * When non-null, the game replays the maze encoded in `replay.layout`
   * (decoded from on-chain bytes) instead of generating from `initialSeed`.
   * The parent flips this to null to return to seed-driven play.
   */
  replay: ReplayPayload | null;
}

export function Game({ initialSeed, onSeedChange, active, replay }: GameProps) {
  const navigate = useNavigate();
  const mazeRef = useRef<MazeHandle>(null);
  const isMobile = useIsMobile();
  const {
    seed,
    maze,
    colors,
    gameState,
    visited,
    initialPositions,
    showKinglyHint,
    winModalDismissed,
    setWinModalDismissed,
    initGame,
    initFromReplay,
    handleMove,
    handlePlayAgain,
  } = useGameState({ initialSeed, onSeedChange, replay });
  const [seedBarOpen, setSeedBarOpen] = useState(false);
  const [historySidebarOpen, setHistorySidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { isConnected } = useAccount();
  const [copied, setCopied] = useState(false);
  const gameContainerRef = useRef<HTMLDivElement>(null);

  // Sync mobile status-bar theme-color to seed's wall color, and tint the
  // page background so the chrome around the maze shares the seed's palette.
  // We only do this while the / route is active so MyMazes/Gallery pages can
  // own their own page background without fighting the game's seed palette.
  useEffect(() => {
    if (!active || !colors) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colors.wallColor);
    document.body.style.backgroundColor = colors.pageBackgroundColor;
  }, [active, colors]);

  // Lock the layout while the mobile seed input is open so the soft keyboard
  // overlays the page instead of reflowing it. We:
  // 1. Toggle a `seed-input-open` class on html+body — paired CSS swaps
  //    `100dvh` (visual viewport, shrinks with keyboard) for `100vh` (large
  //    viewport, stable). iOS Safari relies on this.
  // 2. Append `interactive-widget=overlays-content` to the viewport meta —
  //    a hint Chrome 108+ honors to overlay the keyboard.
  useEffect(() => {
    if (!isMobile || !seedBarOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const meta = document.querySelector(
      'meta[name="viewport"]'
    ) as HTMLMetaElement | null;
    const previousViewport = meta?.getAttribute('content') ?? null;
    html.classList.add('seed-input-open');
    body.classList.add('seed-input-open');
    if (
      meta &&
      previousViewport &&
      !previousViewport.includes('interactive-widget')
    ) {
      meta.setAttribute(
        'content',
        `${previousViewport}, interactive-widget=overlays-content`
      );
    }
    return () => {
      html.classList.remove('seed-input-open');
      body.classList.remove('seed-input-open');
      if (meta && previousViewport) {
        meta.setAttribute('content', previousViewport);
      }
    };
  }, [isMobile, seedBarOpen]);

  const handleResetView = useCallback(() => mazeRef.current?.resetView(), []);
  useGameKeyboard({
    active,
    gameWon: gameState?.gameWon ?? false,
    seedBarOpen,
    historySidebarOpen,
    setHistorySidebarOpen,
    setSeedBarOpen,
    onMove: handleMove,
    initGame,
    initFromReplay,
    replay,
    seed,
    onResetView: handleResetView,
  });

  const handleSeedBarStart = (newSeed: string) => {
    initGame(newSeed);
    setSeedBarOpen(false);
  };

  const handleSeedBarCancel = () => {
    setSeedBarOpen(false);
  };

  const handleNewMaze = () => {
    setSeedBarOpen(true);
  };

  const handleHistorySelect = (selectedSeed: string) => {
    initGame(selectedSeed);
  };

  const handleResetToDefault = useCallback(() => {
    initGame(DEFAULT_SEED);
  }, [initGame]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = window.location.href;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  if (!maze || !colors || !gameState || !initialPositions) {
    return <div style={styles.loading}>Loading maze...</div>;
  }

  const getContrastColor = pickTextColor;
  const buttonTextColor = getContrastColor(colors.uiAccentColor);
  const debugMode = isDebugSeedActive(seed);
  const statMobileStyle = isMobile ? styles.statMobile : null;
  const statsGroupNode = (
    <div
      style={{
        ...styles.statsGroup,
        ...(isMobile ? styles.statsGroupMobile : styles.statsGroupDesktop),
      }}
    >
      {isMobile ? (
        <>
          <span
            style={{
              ...styles.stat,
              ...statMobileStyle,
              ...styles.statMobileMoves,
              backgroundColor: colors.uiAccentColor,
              color: buttonTextColor,
            }}
          >
            Moves: <strong>{gameState.moveCount}</strong>
          </span>
          <span
            style={{
              ...styles.stat,
              ...statMobileStyle,
              color: gameState.hasRobe ? colors.keyColor : '#888',
            }}
          >
            {gameState.hasRobe ? 'Robe ✓' : 'Find robe'}
          </span>
          <span
            style={{
              ...styles.stat,
              ...statMobileStyle,
              color: gameState.hasScepter ? colors.keyColor : '#888',
            }}
          >
            {gameState.hasScepter ? 'Scepter ✓' : 'Find scepter'}
          </span>
        </>
      ) : (
        <>
          <span
            style={styles.statDesktop}
            title={`Moves: ${gameState.moveCount}`}
          >
            <span aria-hidden style={styles.statIcon}>
              🚶
            </span>
            <strong>{gameState.moveCount}</strong>
          </span>
          <span
            style={{
              ...styles.statDesktop,
              color: gameState.hasRobe ? colors.keyColor : '#888',
            }}
            title={gameState.hasRobe ? 'Robe collected' : 'Find the robe'}
          >
            <img aria-hidden src={robeUrl} alt="" style={styles.statSprite} />
            {gameState.hasRobe ? 'robe' : 'Find robe'}
          </span>
          <span
            style={{
              ...styles.statDesktop,
              color: gameState.hasScepter ? colors.keyColor : '#888',
            }}
            title={
              gameState.hasScepter ? 'Scepter collected' : 'Find the scepter'
            }
          >
            <img
              aria-hidden
              src={scepterUrl}
              alt=""
              style={styles.statSprite}
            />
            {gameState.hasScepter ? 'scepter' : 'Find scepter'}
          </span>
        </>
      )}
      {debugMode && (
        <span
          style={{
            ...styles.stat,
            ...statMobileStyle,
            padding: '2px 6px',
            border: `1px solid ${colors.uiAccentColor}`,
            borderRadius: '4px',
            color: colors.uiAccentColor,
            fontWeight: 700,
            letterSpacing: '0.05em',
          }}
          title="Debug seed active: 66% of internal walls removed (localhost only)"
        >
          [DEBUG]
        </span>
      )}
    </div>
  );

  return (
    <div style={styles.container} ref={gameContainerRef}>
      <div
        style={{
          ...styles.header,
          ...(isMobile ? styles.headerMobile : styles.headerDesktop),
          backgroundColor: colors.headerBackgroundColor,
        }}
      >
        {isMobile ? (
          <>
            {seedBarOpen ? (
              <div
                style={{
                  ...styles.wordmarkRow,
                  ...styles.wordmarkRowMobile,
                }}
              >
                <HeaderSeedInput
                  onStartGame={handleSeedBarStart}
                  onCancel={handleSeedBarCancel}
                  accentColor={colors.uiAccentColor}
                  textColor={getContrastColor(colors.headerBackgroundColor)}
                  compact
                />
              </div>
            ) : (
              <>
                <div
                  style={{
                    ...styles.wordmarkRow,
                    ...styles.wordmarkRowMobile,
                  }}
                >
                  <button
                    type="button"
                    onClick={handleResetToDefault}
                    style={styles.wordmarkButton}
                    aria-label="Reset to initial maze"
                    title="Reset to initial maze"
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
                  <div style={styles.headerSpacer} />
                  <button
                    onClick={() => navigate('/mazes')}
                    style={{
                      ...styles.mobileIconButton,
                      borderColor: getContrastColor(
                        colors.headerBackgroundColor
                      ),
                      color: getContrastColor(colors.headerBackgroundColor),
                    }}
                    title="Open my mazes"
                    aria-label="View collection"
                  >
                    👤
                  </button>
                  <button
                    onClick={handleNewMaze}
                    style={{
                      ...styles.mobilePrimaryCta,
                      backgroundColor: colors.uiAccentColor,
                      color: buttonTextColor,
                    }}
                    title="Start a new game"
                    aria-label="New game"
                  >
                    + New
                  </button>
                </div>
                <div style={styles.mobileStatsRow}>{statsGroupNode}</div>
              </>
            )}
          </>
        ) : (
          <div style={styles.headerRowDesktop}>
            <button
              type="button"
              onClick={handleResetToDefault}
              style={styles.wordmarkButton}
              aria-label="Reset to initial maze"
              title="Reset to initial maze"
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
            {statsGroupNode}
            {seedBarOpen ? (
              <HeaderSeedInput
                onStartGame={handleSeedBarStart}
                onCancel={handleSeedBarCancel}
                accentColor={colors.uiAccentColor}
                textColor={getContrastColor(colors.headerBackgroundColor)}
              />
            ) : (
              <>
                <div style={styles.headerSpacer} />
                <div style={styles.iconButtonRow}>
                  <WalletButton colors={colors} />
                  <button
                    onClick={handleCopyLink}
                    style={{
                      ...styles.iconButton,
                      borderColor: getContrastColor(
                        colors.headerBackgroundColor
                      ),
                      color: getContrastColor(colors.headerBackgroundColor),
                    }}
                    title={copied ? 'Copied!' : 'Copy link to clipboard'}
                    aria-label="Share — copy link to clipboard"
                  >
                    {copied ? '✓' : '🔗'}
                  </button>
                  <button
                    onClick={() => setHistorySidebarOpen(true)}
                    style={{
                      ...styles.iconButton,
                      borderColor: getContrastColor(
                        colors.headerBackgroundColor
                      ),
                      color: getContrastColor(colors.headerBackgroundColor),
                    }}
                    title="History"
                    aria-label="Open history"
                  >
                    🕘
                  </button>
                  {isConnected && (
                    <button
                      onClick={() => navigate('/mazes')}
                      style={{
                        ...styles.iconButton,
                        borderColor: getContrastColor(
                          colors.headerBackgroundColor
                        ),
                        color: getContrastColor(colors.headerBackgroundColor),
                      }}
                      title="My Mazes"
                      aria-label="Go to my mazes"
                    >
                      👤
                    </button>
                  )}
                  <button
                    onClick={() => navigate('/gallery')}
                    style={{
                      ...styles.iconButton,
                      borderColor: getContrastColor(
                        colors.headerBackgroundColor
                      ),
                      color: getContrastColor(colors.headerBackgroundColor),
                    }}
                    title="Gallery"
                    aria-label="Go to public gallery"
                  >
                    🖼
                  </button>
                  <div
                    style={styles.helpWrapper}
                    onMouseEnter={() => setHelpOpen(true)}
                    onMouseLeave={() => setHelpOpen(false)}
                  >
                    <button
                      onClick={() => setHelpOpen((v) => !v)}
                      onFocus={() => setHelpOpen(true)}
                      onBlur={() => setHelpOpen(false)}
                      style={{
                        ...styles.iconButton,
                        borderColor: getContrastColor(
                          colors.headerBackgroundColor
                        ),
                        color: getContrastColor(colors.headerBackgroundColor),
                      }}
                      title="Keyboard shortcuts"
                      aria-label="Show keyboard shortcuts"
                      aria-expanded={helpOpen}
                    >
                      ?
                    </button>
                    {helpOpen && (
                      <div
                        role="tooltip"
                        style={{
                          ...styles.helpPopover,
                          backgroundColor: colors.wallColor,
                          color: getContrastColor(colors.wallColor),
                          borderColor: getContrastColor(colors.wallColor),
                        }}
                      >
                        <div style={styles.helpRow}>
                          <kbd style={styles.kbd}>Arrows</kbd>
                          <kbd style={styles.kbd}>WASD</kbd>
                          <span>move</span>
                        </div>
                        <div style={styles.helpRow}>
                          <kbd style={styles.kbd}>R</kbd>
                          <span>restart</span>
                        </div>
                        <div style={styles.helpRow}>
                          <kbd style={styles.kbd}>N</kbd>
                          <span>new</span>
                        </div>
                        <div style={styles.helpRow}>
                          <kbd style={styles.kbd}>0</kbd>
                          <span>reset zoom</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSeedBarOpen(true)}
                  style={{
                    ...styles.primaryCta,
                    backgroundColor: colors.uiAccentColor,
                    color: buttonTextColor,
                  }}
                  title="Start a new game with a custom seed"
                  aria-label="New game"
                >
                  + New Game
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <MazeSizeWarning width={maze.width} height={maze.height} />

      <div
        style={{
          ...styles.mazeContainer,
          ...(isMobile ? styles.mazeContainerMobile : null),
        }}
      >
        <Maze
          ref={mazeRef}
          maze={maze}
          playerPos={gameState.playerPos}
          robePos={gameState.robePos.x >= 0 ? gameState.robePos : null}
          scepterPos={gameState.scepterPos.x >= 0 ? gameState.scepterPos : null}
          goalPos={gameState.goalPos}
          hasRobe={gameState.hasRobe}
          hasScepter={gameState.hasScepter}
          colors={colors}
          zoom={1}
          visited={visited}
          enableTouchTransform={isMobile}
          enableMouseTransform={!isMobile}
          showKinglyHint={showKinglyHint}
        />
      </div>

      {isMobile && !seedBarOpen && (
        <Controls
          onMove={handleMove}
          onHistory={() => setHistorySidebarOpen(true)}
          onShare={handleCopyLink}
          onRestart={handlePlayAgain}
          disabled={gameState.gameWon}
          accentColor={colors.uiAccentColor}
          wallColor={colors.wallColor}
          textBackgroundColor={colors.textBackgroundColor}
          copied={copied}
        />
      )}

      <WinModal
        isOpen={gameState.gameWon && !winModalDismissed}
        moveCount={gameState.moveCount}
        onNewMaze={handleNewMaze}
        onDismiss={() => setWinModalDismissed(true)}
        colors={colors}
        onCopyLink={handleCopyLink}
        copied={copied}
        maze={maze}
        moves={gameState.moves}
        startPos={initialPositions.startPos}
        robePos={initialPositions.robePos}
        scepterPos={initialPositions.scepterPos}
        goalPos={initialPositions.goalPos}
        visited={visited}
        onViewCollection={() => {
          setWinModalDismissed(true);
          navigate('/mazes');
        }}
      />

      <HistorySidebar
        isOpen={historySidebarOpen}
        currentSeed={seed}
        colors={colors}
        onSelectSeed={handleHistorySelect}
        onClose={() => setHistorySidebarOpen(false)}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 16px',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flexShrink: 0,
  },
  headerDesktop: {
    padding: '6px 16px',
    gap: 0,
    minHeight: '52px',
  },
  headerMobile: {
    padding: '6px 12px',
    gap: '4px',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  headerRowDesktop: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    minHeight: '40px',
  },
  wordmarkRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  wordmarkRowMobile: {
    justifyContent: 'space-between',
    gap: '12px',
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
    transition: 'opacity 0.15s ease',
  },
  statsGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  statsGroupDesktop: {
    gap: '14px',
    whiteSpace: 'nowrap',
  },
  statsGroupMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px',
    minWidth: 0,
    flexShrink: 1,
  },
  mobileStatsRow: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  mobileIconButton: {
    width: '40px',
    height: '40px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.45)',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '18px',
    lineHeight: 1,
    flexShrink: 0,
  },
  mobilePrimaryCta: {
    padding: '8px 14px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    minHeight: '40px',
  },
  stat: {
    fontSize: '15px',
    color: '#ddd',
  },
  statDesktop: {
    fontSize: '14px',
    color: '#ddd',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  statIcon: {
    fontSize: '14px',
    lineHeight: 1,
  },
  statSprite: {
    width: '16px',
    height: '16px',
    objectFit: 'contain',
    imageRendering: 'pixelated',
    verticalAlign: 'middle',
    display: 'inline-block',
  },
  statMobile: {
    fontSize: '14px',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    color: '#f0f0f0',
  },
  statMobileMoves: {
    padding: '3px 10px',
    borderRadius: '999px',
    fontWeight: 700,
  },
  headerSpacer: {
    flex: 1,
  },
  kbd: {
    display: 'inline-block',
    padding: '2px 6px',
    fontSize: '11px',
    fontFamily: 'monospace',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: '3px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  iconButtonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  iconButton: {
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
    transition: 'background-color 0.15s ease, transform 0.1s ease',
  },
  helpWrapper: {
    position: 'relative',
    display: 'inline-flex',
  },
  helpPopover: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    minWidth: '180px',
    padding: '8px 10px',
    border: '1px solid',
    borderRadius: '6px',
    fontSize: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
    zIndex: 10,
    whiteSpace: 'nowrap',
  },
  helpRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  primaryCta: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    transition: 'filter 0.15s ease, transform 0.1s ease',
  },
  mazeContainer: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  mazeContainerMobile: {
    paddingBottom: 'calc(86px + env(safe-area-inset-bottom, 0px))',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    color: '#ccc',
    fontSize: '18px',
  },
};
