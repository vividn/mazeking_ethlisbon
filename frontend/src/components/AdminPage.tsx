import {
  useAccount,
  useConnect,
  useReadContract,
  useWriteContract,
} from 'wagmi';
import { isAddress, type Address } from 'viem';
import MazeKingNFTAbi from '../lib/abi/MazeKingNFT.json';
import { getContractAddress } from '../lib/contracts';
import { useState } from 'react';

/**
 * Post-deployment wiring, signed from a browser wallet.
 *
 * This exists for the steps that genuinely cannot be scripted. Granting the
 * registrar its role and pointing an ENS name at a resolver must both come from
 * the account that owns them, and that account is a person's wallet rather than
 * a key sitting in a deploy script. Foundry cannot sign for a browser wallet, so
 * without a page like this those steps get done by pasting a private key
 * somewhere it should not be.
 *
 * It is deliberately a checklist rather than a dashboard. Every row reads the
 * chain, says what it found, and offers exactly the transaction that fixes it —
 * so "is production wired up?" is answered by looking, not by remembering.
 */
export function AdminPage() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const nft = chain ? getContractAddress(chain.id, 'nft') : undefined;

  if (!isConnected) {
    return (
      <Frame>
        <p style={text}>
          Connect the wallet that owns the deployment. Everything here is signed
          by you; nothing is stored.
        </p>
        <button
          style={button}
          onClick={() => {
            const first = connectors[0];
            if (first) connect({ connector: first });
          }}
        >
          Connect Wallet
        </button>
      </Frame>
    );
  }

  if (!nft) {
    return (
      <Frame>
        <p style={text}>
          No MazeKing deployment is known for {chain?.name ?? 'this network'}.
          Switch networks, or deploy first.
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <p style={{ ...text, opacity: 0.8 }}>
        {chain?.name} · contract <code>{nft}</code> · signed by{' '}
        <code>
          {address?.slice(0, 6)}…{address?.slice(-4)}
        </code>
      </p>

      <OwnerCheck nft={nft} account={address as Address} />
      <RegistrarRow nft={nft} />
      <AddressRow
        nft={nft}
        label="Badge awarder"
        why="Without it every mint awards nothing, silently — the badge machinery runs and returns no badges."
        readFn="badgeAwarder"
        writeFn="setBadgeAwarder"
      />
      <AddressRow
        nft={nft}
        label="Renderer"
        why="Without it tokens fall back to the base URI instead of the on-chain SVG, and the ENS avatar record resolves empty."
        readFn="renderer"
        writeFn="setRenderer"
      />
      <AddressRow
        nft={nft}
        label="Verifier"
        why="Minting reverts entirely without one."
        readFn="verifierContract"
        writeFn="setVerifier"
      />
    </Frame>
  );
}

/**
 * The first thing worth knowing: whether this wallet can actually do any of it.
 * Finding out from a reverted transaction is a slower and more alarming way to
 * learn the same fact.
 */
function OwnerCheck({ nft, account }: { nft: Address; account: Address }) {
  const { data: ownerRole } = useReadContract({
    address: nft,
    abi: MazeKingNFTAbi,
    functionName: 'OWNER_ROLE',
  });
  const { data: hasOwner } = useReadContract({
    address: nft,
    abi: MazeKingNFTAbi,
    functionName: 'hasRole',
    args: ownerRole ? [ownerRole, account] : undefined,
    query: { enabled: Boolean(ownerRole) },
  });

  if (hasOwner === undefined) return null;
  return (
    <div style={{ ...row, borderColor: hasOwner ? '#3a6' : '#a33' }}>
      <strong style={label}>Owner</strong>
      <span style={text}>
        {hasOwner
          ? 'This wallet holds OWNER_ROLE.'
          : 'This wallet does NOT hold OWNER_ROLE — every write below will revert.'}
      </span>
    </div>
  );
}

/** Granting the registrar its role is the step that makes badges reachable. */
function RegistrarRow({ nft }: { nft: Address }) {
  const [value, setValue] = useState('');
  const { writeContract, isPending } = useWriteContract();
  const { data: role } = useReadContract({
    address: nft,
    abi: MazeKingNFTAbi,
    functionName: 'REGISTRAR_ROLE',
  });
  const candidate = isAddress(value) ? (value as Address) : undefined;
  const { data: alreadyHas } = useReadContract({
    address: nft,
    abi: MazeKingNFTAbi,
    functionName: 'hasRole',
    args: role && candidate ? [role, candidate] : undefined,
    query: { enabled: Boolean(role && candidate) },
  });

  return (
    <div style={row}>
      <strong style={label}>Registrar</strong>
      <span style={text}>
        The attestor's signing address. It needs this role to sign statements
        about mazes, and needs no balance at all — it never sends a transaction.
        Use a different key from the deployer.
      </span>
      <div style={inputRow}>
        <input
          style={input}
          placeholder="0x… attestor address"
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
        />
        <button
          style={button}
          disabled={!candidate || !role || isPending || alreadyHas === true}
          onClick={() =>
            writeContract({
              address: nft,
              abi: MazeKingNFTAbi,
              functionName: 'grantRole',
              args: [role, candidate],
            })
          }
        >
          {alreadyHas === true ? 'Already granted' : 'Grant role'}
        </button>
      </div>
      {value && !candidate && (
        <span style={{ ...text, color: '#f88' }}>Not a valid address.</span>
      )}
    </div>
  );
}

/** A contract pointer: shows what is set, and lets you set it. */
function AddressRow({
  nft,
  label: name,
  why,
  readFn,
  writeFn,
}: {
  nft: Address;
  label: string;
  why: string;
  readFn: string;
  writeFn: string;
}) {
  const [value, setValue] = useState('');
  const { writeContract, isPending } = useWriteContract();
  const { data: current } = useReadContract({
    address: nft,
    abi: MazeKingNFTAbi,
    functionName: readFn,
  });
  const candidate = isAddress(value) ? (value as Address) : undefined;
  const unset =
    typeof current === 'string' &&
    current.toLowerCase() === '0x0000000000000000000000000000000000000000';

  return (
    <div style={{ ...row, borderColor: unset ? '#a63' : '#444' }}>
      <strong style={label}>{name}</strong>
      <span style={text}>
        {unset ? `Not set. ${why}` : `Set to ${String(current)}`}
      </span>
      <div style={inputRow}>
        <input
          style={input}
          placeholder="0x…"
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
        />
        <button
          style={button}
          disabled={!candidate || isPending}
          onClick={() =>
            writeContract({
              address: nft,
              abi: MazeKingNFTAbi,
              functionName: writeFn,
              args: [candidate],
            })
          }
        >
          Set
        </button>
      </div>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={page}>
      <div style={inner}>
        <h1 style={heading}>Deployment wiring</h1>
        <p style={{ ...text, opacity: 0.75 }}>
          Steps that must be signed by the owning wallet. Each row reads the
          chain first, so what you see is what is actually deployed — not what
          was intended.
        </p>
        {children}
        <p style={{ ...text, opacity: 0.6, marginTop: '18px' }}>
          ENS records for <code>mazeking.eth</code> are set through the ENS app
          or <code>scripts/ens-setup.mjs</code>, since they are writes to the
          ENS registry rather than to this contract. The name owner is the only
          account that can make them.
        </p>
      </div>
    </div>
  );
}

const page: React.CSSProperties = {
  width: '100%',
  height: '100%',
  overflowY: 'auto',
  padding: '32px 20px',
  boxSizing: 'border-box',
  backgroundColor: '#141414',
  color: '#e8e8e8',
  fontFamily: 'monospace',
};
const inner: React.CSSProperties = {
  maxWidth: '760px',
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
};
const heading: React.CSSProperties = { margin: 0, fontSize: '22px' };
const row: React.CSSProperties = {
  border: '1px solid #444',
  borderRadius: '8px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};
const label: React.CSSProperties = { fontSize: '14px' };
const text: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: 1.5,
  margin: 0,
};
const inputRow: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};
const input: React.CSSProperties = {
  flex: '1 1 22em',
  minWidth: 0,
  padding: '8px 10px',
  fontFamily: 'inherit',
  fontSize: '13px',
  background: 'transparent',
  border: '1px solid #555',
  borderRadius: '6px',
  color: 'inherit',
};
const button: React.CSSProperties = {
  padding: '8px 14px',
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 700,
  border: '1px solid #666',
  borderRadius: '6px',
  background: '#222',
  color: '#eee',
  cursor: 'pointer',
};
