import React, { useState } from 'react';
import { useAccount, useConnect, useSwitchChain } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import type { ColorScheme } from '../types';
import type { ProofState } from '../hooks/useZkProof';
import { useMintNFT } from '../hooks/useMintNFT';
import { ProofImage } from './ProofImage';
import { areContractsDeployed } from '../lib/contracts';
import { pickTextColor } from '../lib/contrastText';
import crownUrl from '../glyphs/crown.png?url';

interface ProofPlaceholderProps {
  size: number;
  accentColor: string;
  /** When true, render the pulsing crown sprite (proving state). */
  animated: boolean;
  /** Foreground content (e.g. the Generate ZK Proof CTA). */
  children?: React.ReactNode;
  ariaLabel: string;
}

/**
 * Pre-proof placeholder: solid black box at the proof image's final
 * dimensions. While `animated` a low-contrast crown breathes at center.
 */
function ProofPlaceholder({
  size,
  accentColor,
  animated,
  children,
  ariaLabel,
}: ProofPlaceholderProps) {
  return (
    <div
      data-testid="proof-placeholder"
      style={{
        width: size,
        height: size,
        backgroundColor: '#000',
        borderRadius: '8px',
        border: `2px solid ${accentColor}`,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      role="status"
      aria-label={ariaLabel}
    >
      {animated && (
        <img
          src={crownUrl}
          alt=""
          aria-hidden
          style={{
            width: '40%',
            height: '40%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
            opacity: 0.4,
            animation: 'proofRoyalBreath 1.5s ease-in-out infinite',
          }}
        />
      )}
      {children && (
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// Single quiet line for every proving stage — multi-stage rotation read as
// engineering noise and clashed with the modal's medieval tone.
const PROOF_HELPER_TEXT = 'Sealing the certificate…';

const PROOF_IMAGE_SIZE = 140;

interface MintBlockProps {
  colors: ColorScheme;
  moveCount: number;
  proofState: ProofState;
  startProofGeneration: () => Promise<void>;
  resetProof: () => void;
  mockMode: boolean;
  /** Rendered in the button column below the mint button + errors. */
  children?: React.ReactNode;
}

export function MintBlock({
  colors,
  moveCount,
  proofState,
  startProofGeneration,
  resetProof,
  mockMode,
  children,
}: MintBlockProps) {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();

  const {
    mintWithProof,
    isPending,
    isConfirming,
    isSuccess,
    errorMessage: mintErrorMessage,
  } = useMintNFT();

  const contractsDeployed = chain ? areContractsDeployed(chain.id) : false;
  const onSepolia = chain?.id === sepolia.id;
  const sepoliaSupported = areContractsDeployed(sepolia.id);
  const proofReady = proofState.stage === 'complete';
  const minting = isPending || isConfirming;

  // How the completed proof relates to the connected wallet.
  //   'bearer'  – proved with no wallet; mintable by anyone who copies it.
  //   'matches' – bound to the connected account; the safe path.
  //   'stale'   – bound to a DIFFERENT account (user switched wallets), so it
  //               cannot verify and must be regenerated.
  const proofBinding = !proofReady
    ? 'none'
    : proofState.boundTo == null
      ? 'bearer'
      : address && proofState.boundTo.toLowerCase() === address.toLowerCase()
        ? 'matches'
        : 'stale';

  const [bearerAcknowledged, setBearerAcknowledged] = useState(false);

  const handleMint = async () => {
    if (mockMode) {
      console.log('[mockMode] Skipping real mint; visual review only.');
      return;
    }
    if (!isConnected) {
      const connector = connectors[0];
      if (connector) connect({ connector });
      return;
    }
    if (!onSepolia && sepoliaSupported) {
      switchChain({ chainId: sepolia.id });
      return;
    }
    if (
      !proofReady ||
      !proofState.proof ||
      !proofState.mazeHash ||
      !proofState.layoutBytes
    ) {
      return;
    }
    // Two-step confirm: a bearer proof is copyable, so the first click
    // surfaces the warning and only the second one spends it.
    if (proofBinding === 'bearer' && !bearerAcknowledged) {
      setBearerAcknowledged(true);
      return;
    }
    if (proofBinding === 'stale') {
      // Regenerating is the only option: the proof commits to the previous
      // account, so it can never verify for this one.
      await startProofGeneration();
      return;
    }
    try {
      await mintWithProof(
        proofState.proof,
        proofState.mazeHash,
        proofState.layoutBytes,
        moveCount,
        proofBinding === 'bearer'
      );
    } catch (err) {
      console.error('mintWithProof threw:', err);
    }
  };

  // Mint button label + disabled reason kept in one place to stay in sync.
  let mintLabel = 'Mint NFT';
  let mintDisabledReason: string | null = null;
  let mintDisabled = false;
  if (isSuccess) {
    mintLabel = '✓ Minted';
    mintDisabled = true;
  } else if (mockMode) {
    mintLabel = proofReady ? 'Mint NFT (mock)' : 'Mint NFT';
    mintDisabled = !proofReady;
    mintDisabledReason = proofReady
      ? null
      : proofState.stage === 'idle'
        ? 'Generate proof first'
        : 'Generating proof…';
  } else if (!proofReady) {
    mintDisabled = true;
    mintDisabledReason =
      proofState.stage === 'idle'
        ? 'Generate proof first'
        : 'Generating proof…';
  } else if (!isConnected) {
    mintLabel = 'Connect Wallet';
  } else if (proofBinding === 'stale') {
    mintLabel = 'Re-prove for this wallet';
  } else if (proofBinding === 'bearer') {
    mintLabel = bearerAcknowledged ? 'Mint anyway' : 'Mint NFT';
  } else if (!onSepolia) {
    mintLabel = sepoliaSupported ? 'Switch to Sepolia' : 'Wrong network';
    mintDisabled = !sepoliaSupported;
    mintDisabledReason = sepoliaSupported
      ? null
      : `Contracts not deployed on ${chain?.name ?? 'this network'}`;
  } else if (!contractsDeployed) {
    mintDisabled = true;
    mintDisabledReason = `Contracts not deployed on ${chain?.name ?? 'this network'}`;
  } else if (minting) {
    mintLabel = isPending ? 'Preparing…' : 'Confirming…';
    mintDisabled = true;
  }

  const boxStyle: React.CSSProperties = {
    backgroundColor: colors.textBackgroundColor,
    borderRadius: '12px',
    padding: '14px',
    marginBottom: '14px',
    boxShadow: `inset 0 0 0 2px ${colors.uiAccentColor}, 0 8px 24px rgba(0, 0, 0, 0.25)`,
  };

  const proofBoxInnerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    gap: '14px',
    alignItems: 'stretch',
  };

  const proofColumnStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    flex: '0 0 auto',
  };

  const helperTextStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#e6e6e6',
    minHeight: '16px',
    textAlign: 'center',
    fontWeight: 500,
  };

  const buttonColumnStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minWidth: 0,
  };

  const baseActionButtonStyle: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: '15px',
    fontWeight: 700,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.22)',
    fontFamily: 'inherit',
    minHeight: '44px',
    width: '100%',
  };

  const mintButtonStyle: React.CSSProperties = {
    ...baseActionButtonStyle,
    backgroundColor: colors.uiAccentColor,
    color: pickTextColor(colors.uiAccentColor),
    fontSize: '16px',
  };

  const retryButtonStyle: React.CSSProperties = {
    ...baseActionButtonStyle,
    backgroundColor: colors.wallColor,
    color: pickTextColor(colors.wallColor),
    marginTop: '6px',
    fontSize: '12px',
    padding: '6px 10px',
    minHeight: '32px',
  };

  const generateProofButtonStyle: React.CSSProperties = {
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: 700,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    backgroundColor: colors.uiAccentColor,
    color: pickTextColor(colors.uiAccentColor),
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  };

  const reasonTextStyle: React.CSSProperties = {
    fontSize: '11px',
    color: pickTextColor(colors.textBackgroundColor),
    lineHeight: 1.3,
    marginTop: '-4px',
    paddingLeft: '4px',
  };

  const errorBannerStyle: React.CSSProperties = {
    backgroundColor: 'rgba(255, 0, 0, 0.12)',
    border: '1px solid rgba(255, 80, 80, 0.6)',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#ff8080',
    fontSize: '12px',
    marginTop: '4px',
  };

  return (
    <div style={boxStyle} data-testid="proof-actions-box">
      <div className="win-proof-row" style={{ ...proofBoxInnerStyle, flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        <div className="win-proof-column" style={proofColumnStyle}>
          {proofReady && proofState.imageDataUrl && proofState.proof ? (
            <ProofImage
              imageDataUrl={proofState.imageDataUrl}
              proofSizeBytes={proofState.proof.length}
              colors={colors}
            />
          ) : proofState.stage === 'idle' ? (
            <>
              <ProofPlaceholder
                size={PROOF_IMAGE_SIZE}
                accentColor={colors.uiAccentColor}
                animated={false}
                ariaLabel="Generate zero-knowledge proof"
              />
            </>
          ) : (
            <>
              <ProofPlaceholder
                size={PROOF_IMAGE_SIZE}
                accentColor={colors.uiAccentColor}
                animated={proofState.stage !== 'error'}
                ariaLabel="Generating proof"
              />
              <div style={helperTextStyle} aria-live="polite">
                {proofState.stage === 'error'
                  ? 'Proof generation failed.'
                  : PROOF_HELPER_TEXT}
              </div>
            </>
          )}
        </div>

        <div style={{ ...buttonColumnStyle, width: '100%', alignItems: 'stretch' }}>
          {/* Generating the proof is the first action and belongs directly
              under the window it fills, rather than inside the placeholder
              where it read as part of the artwork. */}
          {proofState.stage === 'idle' && (
            <button
              type="button"
              className="win-action-button"
              style={generateProofButtonStyle}
              onClick={() => void startProofGeneration()}
              data-testid="generate-proof-button"
              aria-label="Generate zero-knowledge proof of your solution"
            >
              Generate ZK Proof
            </button>
          )}
          {/* Connecting is its own step rather than a label the mint button
              borrows, so the order of operations is visible before minting. */}
          {!isConnected && !mockMode && (
            <button
              type="button"
              className="win-action-button"
              style={mintButtonStyle}
              onClick={() => {
                const first = connectors[0];
                if (first) connect({ connector: first });
              }}
              data-testid="win-connect-wallet"
            >
              Connect Wallet
            </button>
          )}
          <button
            className="win-action-button"
            style={mintButtonStyle}
            onClick={handleMint}
            disabled={mintDisabled || (!isConnected && !mockMode)}
            aria-label={mintLabel}
            data-testid="mint-button"
          >
            {!isConnected && !mockMode ? 'Mint NFT' : mintLabel}
          </button>
          {mintDisabledReason && (
            <div style={reasonTextStyle}>{mintDisabledReason}</div>
          )}
          {proofBinding === 'bearer' && bearerAcknowledged && (
            <div style={{ ...reasonTextStyle, lineHeight: 1.4 }}>
              This proof was made without a wallet, so it isn't tied to your
              address — anyone who copies it from the transaction could mint it
              too. Fine for a fun mint; if you'd rather it be yours alone,
              re-solve with your wallet connected.
            </div>
          )}
          {proofBinding === 'stale' && (
            <div style={{ ...reasonTextStyle, lineHeight: 1.4 }}>
              This proof is bound to a different wallet, so it can't be minted
              from this one. Re-proving takes a moment.
            </div>
          )}
          {!mockMode && isConnected && address && (
            <div style={{ ...reasonTextStyle, opacity: 0.85 }}>
              {address.slice(0, 6)}…{address.slice(-4)}
              {chain?.name ? ` · ${chain.name}` : ''}
            </div>
          )}
          {mintErrorMessage && !mockMode && (
            <div role="alert" style={errorBannerStyle}>
              {mintErrorMessage}
            </div>
          )}
          {proofState.stage === 'error' && !mockMode && (
            <div role="alert" style={errorBannerStyle}>
              {proofState.error ?? 'Proof generation failed.'}
              <button
                className="win-action-button"
                style={retryButtonStyle}
                onClick={() => {
                  resetProof();
                  void startProofGeneration();
                }}
              >
                Try again
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
