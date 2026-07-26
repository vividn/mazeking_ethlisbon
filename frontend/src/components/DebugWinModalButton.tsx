import { useMemo, useState } from 'react';
import { isLocalhost } from '../lib/debugSeed';
import { generateMaze } from '../lib/mazeGenerator';
import { useMazePaletteForSeed } from '../hooks/useMazePaletteForSeed';
import { WinModal } from './WinModal';

const DEBUG_SEED = 'zkDEBUG-winmodal';

/**
 * Floating localhost-only button that opens the WinModal with a synthetic
 * maze and `mockMode=true`. Lets us iterate on the modal without playing
 * through a maze. Hidden in production by `isLocalhost()`.
 */
export function DebugWinModalButton() {
  // `?debugwin=1` opens it on load, so the modal can be captured by a headless
  // browser that cannot click. Localhost-only, like the button itself.
  const [open, setOpen] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debugwin') === '1'
  );
  const [iteration, setIteration] = useState(0);

  const generated = useMemo(() => generateMaze(DEBUG_SEED), []);
  const colors = useMazePaletteForSeed(DEBUG_SEED);

  if (!isLocalhost()) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIteration((i) => i + 1);
          setOpen(true);
        }}
        style={{
          position: 'fixed',
          bottom: '12px',
          right: '12px',
          zIndex: 999,
          padding: '8px 12px',
          backgroundColor: '#ff00aa',
          color: '#fff',
          border: '2px dashed #fff',
          borderRadius: '8px',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          fontFamily: 'monospace',
        }}
        aria-label="DEBUG: open the win modal with a mock proof"
        data-testid="debug-win-modal-button"
        title="DEV ONLY (localhost) — open WinModal with mock proof"
      >
        🐞 DEBUG: Win Modal
      </button>
      {open && (
        <WinModal
          key={iteration}
          isOpen
          mockMode
          moveCount={42}
          colors={colors}
          maze={generated.maze}
          moves={[]}
          startPos={generated.kingPos}
          robePos={generated.robePos}
          scepterPos={generated.scepterPos}
          goalPos={generated.goalPos}
          onDismiss={() => setOpen(false)}
        />
      )}
    </>
  );
}
