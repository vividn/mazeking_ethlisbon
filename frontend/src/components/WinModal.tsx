import React, { useEffect, useRef } from 'react';
import type { ColorScheme, MazeData, Move, Position } from '../types';
import { useZkProof } from '../hooks/useZkProof';
import { MintBlock } from './MintBlock';
import { pickTextColor } from '../lib/contrastText';
import kingUrl from '../glyphs/king.png?url';

interface WinModalProps {
  isOpen: boolean;
  moveCount: number;
  colors: ColorScheme;
  maze: MazeData;
  moves: Move[];
  startPos: Position;
  robePos: Position;
  scepterPos: Position;
  goalPos: Position;
  /** Close the modal (e.g. via Escape or backdrop). */
  onDismiss: () => void;
  /**
   * When true, useZkProof runs in mock mode (4s timeout, random 9088-byte
   * proof). Used by the localhost DEBUG button. Mint button is rendered but
   * a click resolves immediately without touching a wallet.
   */
  mockMode?: boolean;
}

function getSubtitleVariant(moveCount: number, maze: MazeData): string {
  const area = maze.width * maze.height;
  if (moveCount <= area * 0.35) return 'A royal-class solve';
  if (moveCount <= area * 0.65) return 'Worthy of the throne';
  if (moveCount <= area * 1.1) return 'A king is born';
  return 'You have conquered the maze';
}

interface ConfettiCanvasProps {
  colors: ColorScheme;
  active: boolean;
}

function ConfettiCanvas({ colors, active }: ConfettiCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const palette = [
      colors.uiAccentColor,
      colors.keyColor,
      colors.goalColor,
      colors.playerColor,
      colors.pathColor,
    ];

    const COUNT = 28;
    const particles = Array.from({ length: COUNT }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.4,
      y: h * 0.35 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 4,
      vy: -2 - Math.random() * 4,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.2,
      color: palette[Math.floor(Math.random() * palette.length)],
      life: 0,
    }));

    const TTL = 110;
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of particles) {
        p.life++;
        if (p.life > TTL) continue;
        alive = true;
        p.vy += 0.12;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        const fade = Math.max(0, 1 - p.life / TTL);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [active, colors]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100dvh',
        pointerEvents: 'none',
        zIndex: 1001,
      }}
    />
  );
}

export function WinModal({
  isOpen,
  moveCount,
  colors,
  maze,
  moves,
  startPos,
  robePos,
  scepterPos,
  goalPos,
  onDismiss,
  mockMode = false,
}: WinModalProps) {
  const {
    state: proofState,
    startProofGeneration,
    reset: resetProof,
  } = useZkProof(maze, moves, startPos, robePos, scepterPos, goalPos, {
    mockMode,
  });


  // Escape closes the modal. Skip while a real proof is mid-flight so we
  // don't tear down the in-flight pipeline mid-keypress.
  const isProving =
    proofState.stage !== 'idle' &&
    proofState.stage !== 'complete' &&
    proofState.stage !== 'error';
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (!isProving || mockMode)) {
        e.preventDefault();
        resetProof();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isProving, mockMode, resetProof, onDismiss]);

  if (!isOpen) return null;

  const subtitle = getSubtitleVariant(moveCount, maze);

  const closeButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: '8px',
    right: '10px',
    zIndex: 2,
    width: '32px',
    height: '32px',
    lineHeight: '28px',
    fontSize: '24px',
    fontFamily: 'monospace',
    background: 'transparent',
    color: pickTextColor(colors.textBackgroundColor),
    border: '1px solid',
    borderColor: pickTextColor(colors.textBackgroundColor),
    borderRadius: '50%',
    cursor: 'pointer',
    opacity: 0.75,
  };

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.modalOverlayColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
    animation: 'fadeIn 0.3s ease-out',
  };

  const modalStyle: React.CSSProperties = {
    backgroundColor: colors.pathColor,
    borderRadius: '16px',
    padding: '22px 24px',
    maxWidth: '680px',
    width: '92%',
    maxHeight: '95vh',
    overflowY: 'auto',
    boxShadow: `0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 2px ${colors.uiAccentColor}`,
    position: 'relative',
    animation: 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
  };

  const kingHeroStyle: React.CSSProperties = {
    display: 'block',
    width: 'auto',
    height: 'auto',
    maxWidth: '120px',
    maxHeight: '110px',
    filter: 'drop-shadow(0 6px 12px rgba(0, 0, 0, 0.35))',
    flexShrink: 0,
  };

  const heroTextStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minWidth: 0,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '30px',
    fontWeight: 'bold',
    margin: 0,
    color: colors.playerColor,
    textShadow: '2px 2px 4px rgba(0, 0, 0, 0.2)',
    lineHeight: 1.05,
  };

  const heroSubtitleStyle: React.CSSProperties = {
    fontSize: '16px',
    margin: '6px 0 0',
    color: colors.wallColor,
  };

  const variantSubtitleStyle: React.CSSProperties = {
    fontSize: '13px',
    margin: '4px 0 0',
    color: colors.wallColor,
    fontStyle: 'italic',
  };






  return (
    <>
      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(40px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes kingEntrance {
            from { opacity: 0; transform: scale(0.85); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes proofRoyalBreath {
            0%, 100% { opacity: 0.30; transform: scale(1); }
            50%      { opacity: 0.60; transform: scale(1.04); }
          }
          .win-king-hero {
            animation: kingEntrance 250ms ease-out both;
            transform-origin: center bottom;
          }
          .win-hero-row {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 16px;
            margin: 0 0 14px;
          }
          @media (max-width: 540px) {
            .win-hero-row {
              flex-direction: column;
              text-align: center;
              gap: 8px;
            }
            .win-proof-row {
              flex-direction: column !important;
              align-items: stretch !important;
            }
            .win-proof-column {
              align-self: center;
            }
          }
          @keyframes stampIn {
            0%   { transform: rotate(20deg) scale(2); opacity: 0; }
            60%  { transform: rotate(-12deg) scale(0.92); opacity: 1; }
            100% { transform: rotate(-8deg) scale(1); opacity: 1; }
          }
          .win-stamp {
            animation: stampIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.25s both;
          }
          .win-action-button:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 14px rgba(0, 0, 0, 0.28);
          }
          .win-action-button:active:not(:disabled) {
            transform: translateY(0);
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
          }
          .win-action-button:disabled {
            opacity: 0.55;
            cursor: not-allowed;
            transform: none;
          }
          @media (prefers-reduced-motion: reduce) {
            .win-modal,
            .win-king-hero,
            .win-stamp,
            [data-testid="proof-placeholder"] > * {
              animation: none !important;
            }
          }
        `}
      </style>
      <ConfettiCanvas colors={colors} active={isOpen} />
      {/* Clicking the backdrop dismisses. The win state is not lost by
          closing — the crown stays on the player and the header keeps a way
          back in — so dismissing is how you go start another maze or visit
          your collection. */}
      <div
        style={overlayStyle}
        onClick={onDismiss}
        data-testid="win-modal-overlay"
      >
        <div
          className="win-modal"
          style={modalStyle}
          role="dialog"
          aria-labelledby="win-title"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            data-testid="win-modal-close"
            style={closeButtonStyle}
          >
            ×
          </button>
          {/* Hero */}
          <div className="win-hero-row">
            <img
              className="win-king-hero"
              src={kingUrl}
              alt=""
              aria-hidden="true"
              style={kingHeroStyle}
            />
            <div style={heroTextStyle}>
              <h2 id="win-title" style={titleStyle}>
                Coronation!
              </h2>
              <p style={heroSubtitleStyle}>
                This KaZtle is yours in {moveCount} moves — and you can prove
                it!
              </p>
              <p style={variantSubtitleStyle}>{subtitle}</p>
            </div>
          </div>

          {/* Box 2: Proof + Actions */}
          <MintBlock
            colors={colors}
            moveCount={moveCount}
            proofState={proofState}
            startProofGeneration={startProofGeneration}
            resetProof={resetProof}
            mockMode={mockMode}
          />
        </div>
      </div>
    </>
  );
}
