import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useOwnedMazes, type OwnedMaze } from '../hooks/useOwnedMazes';
import { useMazePaletteForSeed } from '../hooks/useMazePaletteForSeed';
import { useAppOutlet } from '../App';
import { PageHeader } from './PageHeader';
import { KaztleText } from './KaztleText';
import { MazeLightbox } from './MazeLightbox';
import { decodeBadges } from '../lib/badges';

function shortId(tokenId: bigint): string {
  const hex = tokenId.toString(16).padStart(64, '0');
  return `0x${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

export function MyMazesPage() {
  const { isConnected, address } = useAccount();
  const { loading, error, mazes } = useOwnedMazes(true);
  const { seed, selectReplay } = useAppOutlet();
  const colors = useMazePaletteForSeed(seed);
  const [zoomed, setZoomed] = useState<OwnedMaze | null>(null);

  useEffect(() => {
    document.body.style.backgroundColor = colors.pageBackgroundColor;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colors.headerBackgroundColor);
  }, [colors]);

  const textColor = colors.wallColor;

  const renderTile = (maze: OwnedMaze) => {
    const movesLabel =
      maze.minMoves !== null ? `${maze.minMoves} moves` : 'unsolved';
    const earned = decodeBadges(maze.badges);
    return (
      <button
        key={maze.tokenId.toString()}
        className="my-mazes-tile"
        onClick={() => setZoomed(maze)}
        title={`Inspect maze ${shortId(maze.tokenId)}`}
        style={{ ...styles.tile, color: textColor }}
      >
        <div style={{ ...styles.thumb, backgroundColor: 'rgba(0,0,0,0.25)' }}>
          {maze.imageUrl ? (
            <img
              src={maze.imageUrl}
              alt={`Maze ${shortId(maze.tokenId)}`}
              style={styles.thumbImg}
              draggable={false}
            />
          ) : (
            <div style={{ ...styles.thumbPlaceholder, color: textColor }}>
              No image
            </div>
          )}
        </div>
        <div style={{ ...styles.movesLabel, color: textColor }}>
          {movesLabel}
        </div>
        {earned.length > 0 && (
          <div style={styles.badgeRow}>
            {earned.map((b) => (
              <span key={b.key} style={styles.badge} title={b.description}>
                {b.glyph}
              </span>
            ))}
          </div>
        )}
      </button>
    );
  };

  let body: React.ReactNode;
  if (!isConnected) {
    body = (
      <div style={{ ...styles.empty, color: textColor }}>
        Connect a wallet to see the mazes you've minted.
      </div>
    );
  } else if (loading) {
    body = (
      <div style={{ ...styles.empty, color: textColor }}>
        Loading your mazes…
      </div>
    );
  } else if (error) {
    body = <div style={{ ...styles.empty, color: textColor }}>{error}</div>;
  } else if (mazes.length === 0) {
    body = (
      <div style={{ ...styles.empty, color: textColor }}>
        No minted mazes yet for {address?.slice(0, 6)}…{address?.slice(-4)}.
      </div>
    );
  } else {
    body = <div style={styles.grid}>{mazes.map(renderTile)}</div>;
  }

  return (
    <div
      style={{ ...styles.page, backgroundColor: colors.pageBackgroundColor }}
    >
      <style>
        {`
          .my-mazes-tile {
            background: rgba(255, 255, 255, 0.08);
            border: none;
            border-radius: 8px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            text-align: left;
            font-family: inherit;
            cursor: zoom-in;
            transition: background-color 0.15s ease;
          }
          .my-mazes-tile:hover {
            background-color: rgba(255, 255, 255, 0.16);
          }
        `}
      </style>
      <PageHeader
        title={
          <>
            Your <KaztleText word="kaztles" colors={colors} />
          </>
        }
        colors={colors}
        current="mazes"
      />
      <div style={styles.body}>{body}</div>
      {zoomed && (
        <MazeLightbox
          imageUrl={zoomed.imageUrl}
          seed={null}
          fallbackLabel={shortId(zoomed.tokenId)}
          colors={colors}
          onClose={() => setZoomed(null)}
          canReplayWithoutSeed={zoomed.layout !== null}
          onPlay={
            zoomed.layout
              ? () =>
                  selectReplay({
                    layout: zoomed.layout as Uint8Array,
                    tokenId: zoomed.tokenId,
                  })
              : undefined
          }
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  body: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 20px 40px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '14px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  tile: {
    width: '100%',
  },
  thumb: {
    width: '100%',
    aspectRatio: '1 / 1',
    borderRadius: '6px',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated',
  },
  thumbPlaceholder: {
    fontSize: '12px',
    opacity: 0.6,
  },
  movesLabel: {
    fontSize: '12px',
    fontFamily: 'monospace',
    opacity: 0.85,
    textAlign: 'center',
    minHeight: '16px',
  },
  badgeRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: '4px',
    marginTop: '2px',
    minHeight: '20px',
  },
  badge: {
    fontSize: '16px',
    lineHeight: '20px',
    cursor: 'help',
  },
  empty: {
    padding: '40px 20px',
    textAlign: 'center',
    opacity: 0.7,
    fontSize: '14px',
  },
};
