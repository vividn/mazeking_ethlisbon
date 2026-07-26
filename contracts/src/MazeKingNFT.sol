// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import {
    ERC1155Burnable
} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import { ERC1155Supply } from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import { MazeConstants } from "./MazeConstants.sol";
import { IBadgeAwarder } from "./IBadgeAwarder.sol";

/// @title MazeKingNFT
/// @notice ERC-1155 NFT contract for MazeKing game achievements
/// @dev Uses AccessControl for role-based permissions
contract MazeKingNFT is ERC1155, AccessControl, ERC1155Burnable, ERC1155Supply {
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    string public name;
    string public symbol;

    // ZK Proof verifier contract address (updatable)
    address public verifierContract;

    // Pluggable badge-awarding strategy (updatable; address(0) disables awards)
    address public badgeAwarder;

    // On-chain SVG renderer (updatable; address(0) falls back to base URI)
    address public renderer;

    // Compact maze layout per tokenId (header + packed cells, see _encodeLayout)
    mapping(uint256 => bytes) public layouts;

    // Maze registry: seed hash -> official maze token ID
    mapping(bytes32 => uint256) public officialMazes;

    // Stats tracking: tokenId => user => Stats
    mapping(uint256 => mapping(address => Stats)) public stats;

    // Per-maze admin state (keyed by tokenId / maze hash)
    mapping(uint256 => uint32) public optimalMoves;
    mapping(uint256 => bool) public registered;
    mapping(uint256 => bool) public registrarApproved;

    // Owner enumeration — the token ids each address has ever minted, in mint
    // order. Lets a client list a collection with one view call instead of
    // scanning ERC-1155 transfer logs over a block range.
    mapping(address => uint256[]) private _mintedBy;
    // Set once per (address, tokenId) so a transfer-then-remint cannot append
    // a duplicate entry.
    mapping(address => mapping(uint256 => bool)) private _hasMinted;
    // Mazes flagged by the registrar as unacceptable (filtered from public views).
    // Tokens already minted remain owned; this is a display-layer signal.
    mapping(uint256 => bool) public disqualified;

    // Stats struct for tracking user achievements per maze
    struct Stats {
        uint16 minMoves; // Minimum moves achieved
        uint16 timesSolved; // Number of times solved
        uint32 badges; // Bitfield for 32 badge types
        uint128 usdcDonated; // USDC donated (future use)
    }

    // Badge constants (bitfield positions)
    uint32 public constant BADGE_REGISTERED = 1 << 0; // 0. Maze is officially registered
    uint32 public constant BADGE_ROBOT = 1 << 1; // 1. Robot/Perfect (optimal moves)
    uint32 public constant BADGE_GOLD = 1 << 2; // 2. Gold (<1.05x optimal)
    uint32 public constant BADGE_SILVER = 1 << 3; // 3. Silver (<1.15x optimal)
    uint32 public constant BADGE_COPPER = 1 << 4; // 4. Copper (<1.25x optimal)
    uint32 public constant BADGE_STONE = 1 << 5; // 5. Stone (max possible moves)
    // Badges 6-31 reserved for future use (placement, special achievements, etc.)

    /// @dev A maze token asserts that its holder solved the maze; transferring
    ///      it would transfer a claim its recipient did not earn.
    error NonTransferable();

    error WithdrawalFailed();
    error NoBalance();

    event Withdrawal(address indexed to, uint256 amount);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event BadgeAwarderUpdated(address indexed oldAwarder, address indexed newAwarder);
    event RendererUpdated(address indexed oldRenderer, address indexed newRenderer);
    event LayoutStored(uint256 indexed tokenId, uint256 layoutBytes);
    event MazeRegistered(bytes32 indexed seedHash, string seed, uint256 indexed tokenId);
    event OptimalMovesSet(uint256 indexed tokenId, uint32 optimalMoves);
    event RegisteredSet(uint256 indexed tokenId, bool value);
    event RegistrarApprovedSet(uint256 indexed tokenId, bool value);
    event MazeDisqualified(uint256 indexed tokenId, bool flag);
    event ProofVerified(address indexed solver, uint256 indexed tokenId, uint16 moveCount);
    event FirstSolve(address indexed solver, uint256 indexed tokenId, uint16 moveCount);
    event NewBestScore(address indexed solver, uint256 indexed tokenId, uint16 newBest);
    event BadgesAwarded(address indexed solver, uint256 indexed tokenId, uint32 newBadges);

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _uri,
        address _owner,
        address _verifier
    ) ERC1155(_uri) {
        name = _name;
        symbol = _symbol;
        verifierContract = _verifier;

        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(OWNER_ROLE, _owner);
        _grantRole(WITHDRAWER_ROLE, _owner);
        _grantRole(REGISTRAR_ROLE, _owner);
    }

    /// @notice Update the base URI
    /// @param newuri New URI
    function setURI(string memory newuri) external onlyRole(OWNER_ROLE) {
        _setURI(newuri);
    }

    /// @notice Mint NFT by verifying a ZK proof of maze completion.
    /// @dev Hash-as-public-input architecture (ma-6cr.6):
    ///      - Public inputs are exactly `[mazeHash, moveCount]`.
    ///      - The Pedersen hash binding inside the circuit guarantees the
    ///        prover knew a layout whose canonical bytes hash to `mazeHash`.
    ///      - `layout` is the canonical layout bytes (20-byte header +
    ///        zero-padded packed cells). The first minter's `layout` is
    ///        stored under `tokenId = uint256(mazeHash)` (option α: the
    ///        contract trusts the first caller to pair `mazeHash` with the
    ///        layout it actually represents — a wrong pairing only affects
    ///        rendering, not the proof).
    /// @param proof      The ZK proof bytes from the Honk backend.
    /// @param mazeHash   Pedersen hash of the canonical layout.
    /// @param layout     Canonical layout bytes (header + packed cells).
    /// @param moveCount  Number of moves taken (must match the proof).
    /// @param bearer     Whether the proof was produced UNBOUND. See the
    ///                   sender-binding note below; false is the safe default.
    function mintWithProof(
        bytes calldata proof,
        bytes32 mazeHash,
        bytes calldata layout,
        uint16 moveCount,
        bool bearer
    ) external {
        require(verifierContract != address(0), "Verifier not set");

        // 1. Verify proof on-chain with public inputs =
        //    [mazeHash, moveCount, sender].
        //
        //    The third input binds the proof to whoever may mint it. A proof
        //    is only valid against the exact public inputs it was produced
        //    for, which is the whole mechanism:
        //
        //      bearer == false  ->  publicInputs[2] = msg.sender.
        //        The normal path. Proofs travel in public calldata, and this
        //        is what stops an observer lifting one from the mempool and
        //        front-running the mint. Only the prover can spend it.
        //
        //      bearer == true   ->  publicInputs[2] = 0.
        //        Opt-in. Lets someone prove without a wallet connected (a
        //        "practice proof") and still mint it later. Such a proof IS a
        //        bearer credential — anyone who copies it can mint it — which
        //        the UI warns about before use.
        //
        //    The two modes do not weaken each other. A bound proof commits to
        //    an address, so it can never be replayed through the bearer path;
        //    a bearer proof commits to zero, so it can never be replayed
        //    through the bound path. The risk stays confined to proofs whose
        //    author deliberately made them bearer.
        //
        //    NOTE: zero is safe as the unbound sentinel because no transaction
        //    can originate from address(0), so the bearer branch can never be
        //    reached accidentally by a normal caller in bound mode.
        bytes32[] memory publicInputs = new bytes32[](MazeConstants.PUBLIC_INPUTS_LENGTH);
        publicInputs[0] = mazeHash;
        publicInputs[1] = bytes32(uint256(moveCount));
        publicInputs[2] = bearer ? bytes32(0) : bytes32(uint256(uint160(msg.sender)));

        IVerifier verifier = IVerifier(verifierContract);
        bool isValid = verifier.verify(proof, publicInputs);
        require(isValid, "Invalid proof");

        // 2. tokenId is the maze hash (one hash -> one identity).
        uint256 tokenId = uint256(mazeHash);

        // 3. Check if first mint for this user
        bool isFirstMint = balanceOf(msg.sender, tokenId) == 0;

        if (isFirstMint) {
            _mint(msg.sender, tokenId, 1, "");
        }

        // 3b. Enumeration. ERC-1155 has no way to list an address's tokens, so
        //     without this a client must scan transfer logs — which needs a
        //     block range, silently misses anything older than that range, and
        //     breaks entirely on RPCs with narrow eth_getLogs limits.
        //
        //     Guarded by its own flag rather than `isFirstMint`: isFirstMint is
        //     `balanceOf == 0`, which becomes true again if a holder BURNS a
        //     maze, and re-solving would then push a duplicate. Tokens are
        //     soulbound so transfers cannot cause this, but burning is
        //     deliberately still permitted. The flag is set once, never cleared.
        //
        //     Records mazes SOLVED, not currently held — burning does not
        //     remove an entry. Callers wanting present holdings should filter
        //     by balanceOf, which is one cheap multicall.
        if (!_hasMinted[msg.sender][tokenId]) {
            _hasMinted[msg.sender][tokenId] = true;
            _mintedBy[msg.sender].push(tokenId);
        }

        // 4. Store the maze layout on first mint of this maze (any user).
        //    Layout is shared across all solvers; subsequent mints are O(1).
        if (layouts[tokenId].length == 0) {
            layouts[tokenId] = layout;
            emit LayoutStored(tokenId, layout.length);
        }

        // 5. Update stats
        Stats storage userStats = stats[tokenId][msg.sender];

        if (isFirstMint) {
            userStats.minMoves = moveCount;
            userStats.timesSolved = 1;
            emit FirstSolve(msg.sender, tokenId, moveCount);
        } else {
            if (moveCount < userStats.minMoves) {
                userStats.minMoves = moveCount;
                emit NewBestScore(msg.sender, tokenId, moveCount);
            }
            userStats.timesSolved++;
        }

        // 6. Delegate badge awards to the configured strategy
        if (badgeAwarder != address(0)) {
            uint32 newBadges =
                IBadgeAwarder(badgeAwarder).awardBadges(msg.sender, tokenId, uint32(moveCount));
            if (newBadges != 0) {
                userStats.badges |= newBadges;
                emit BadgesAwarded(msg.sender, tokenId, newBadges);
            }
        }

        emit ProofVerified(msg.sender, tokenId, moveCount);
    }

    /// @notice Update the pluggable badge-awarding strategy
    /// @param _awarder New awarder contract address (address(0) disables awards)
    function setBadgeAwarder(address _awarder) external onlyRole(OWNER_ROLE) {
        address oldAwarder = badgeAwarder;
        badgeAwarder = _awarder;
        emit BadgeAwarderUpdated(oldAwarder, _awarder);
    }

    /// @notice Update the on-chain SVG renderer
    /// @param _renderer New renderer (address(0) falls back to ERC1155 base URI)
    function setRenderer(address _renderer) external onlyRole(OWNER_ROLE) {
        address oldRenderer = renderer;
        renderer = _renderer;
        emit RendererUpdated(oldRenderer, _renderer);
    }

    /// @notice ERC1155 metadata URI for `tokenId`. When a renderer is configured
    ///         and we have a stored layout, we return a fully on-chain SVG data
    ///         URI; otherwise we fall back to the base URI.
    function uri(uint256 tokenId) public view override returns (string memory) {
        bytes memory layout = layouts[tokenId];
        address r = renderer;
        if (r != address(0) && layout.length != 0) {
            return IMazeRenderer(r).tokenURI(tokenId, layout);
        }
        return super.uri(tokenId);
    }

    /// @notice Every maze this address has solved, in mint order.
    /// @dev Enumeration for clients: one call replaces a transfer-log scan.
    ///      Entries persist through transfers — this is "solved", not "held".
    ///      Filter by `balanceOf` if you need present ownership.
    function mazesOf(address owner) external view returns (uint256[] memory) {
        return _mintedBy[owner];
    }

    /// @notice How many distinct mazes this address has solved.
    /// @dev Cheap enough for a header badge; avoids returning the whole array.
    function mazeCountOf(address owner) external view returns (uint256) {
        return _mintedBy[owner].length;
    }

    /// @notice Page through `mazesOf` for addresses with large collections.
    /// @dev Returns fewer than `limit` items when the end is reached, and an
    ///      empty array when `start` is past the end.
    function mazesOfSlice(address owner, uint256 start, uint256 limit)
        external
        view
        returns (uint256[] memory page)
    {
        uint256[] storage all = _mintedBy[owner];
        if (start >= all.length) return new uint256[](0);
        uint256 end = start + limit;
        if (end > all.length) end = all.length;
        page = new uint256[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = all[i];
        }
    }

    /// @notice Record the optimal (minimum) move count for a maze
    /// @param tokenId The maze tokenId
    /// @param moves Optimal move count (0 = unknown)
    function setOptimalMoves(uint256 tokenId, uint32 moves) external onlyRole(REGISTRAR_ROLE) {
        optimalMoves[tokenId] = moves;
        emit OptimalMovesSet(tokenId, moves);
    }

    /// @notice Store the canonical maze layout for a tokenId (registrar-authoritative)
    /// @dev Makes the registrar the source of truth for a registered maze's layout,
    ///      closing the render-spoof: minters can omit the layout and the vetted one
    ///      is rendered. May overwrite, so the registrar can correct a griefed layout.
    /// @param tokenId The maze tokenId
    /// @param layout Compact maze layout bytes (header + packed cells)
    function setLayout(uint256 tokenId, bytes calldata layout) external onlyRole(REGISTRAR_ROLE) {
        layouts[tokenId] = layout;
        emit LayoutStored(tokenId, layout.length);
    }

    /// @notice Mark a maze as registered (officially recognized)
    /// @param tokenId The maze tokenId
    /// @param value Registered flag
    function setRegistered(uint256 tokenId, bool value) external onlyRole(REGISTRAR_ROLE) {
        registered[tokenId] = value;
        emit RegisteredSet(tokenId, value);
    }

    /// @notice Mark a maze as approved by the registrar for award eligibility
    /// @dev The default badge awarder grants BADGE_REGISTERED based on this flag
    /// @param tokenId The maze tokenId
    /// @param value Approval flag
    function setRegistrarApproved(uint256 tokenId, bool value) external onlyRole(REGISTRAR_ROLE) {
        registrarApproved[tokenId] = value;
        emit RegistrarApprovedSet(tokenId, value);
    }

    /// @notice Flag (or unflag) a maze as disqualified from public views
    /// @dev Token ownership is unaffected; clients should filter `disqualified == true`
    ///      from public galleries while still allowing local play.
    /// @param tokenId The maze tokenId / maze hash
    /// @param flag True to disqualify, false to restore
    function disqualifyMaze(uint256 tokenId, bool flag) external onlyRole(REGISTRAR_ROLE) {
        disqualified[tokenId] = flag;
        emit MazeDisqualified(tokenId, flag);
    }

    /// @notice Update the verifier contract address
    /// @param _verifier New verifier contract address
    function setVerifier(address _verifier) external onlyRole(OWNER_ROLE) {
        address oldVerifier = verifierContract;
        verifierContract = _verifier;
        emit VerifierUpdated(oldVerifier, _verifier);
    }

    /// @notice Register an official maze seed to its token ID
    /// @param seed The maze seed string
    /// @param tokenId The token ID for this maze
    function registerMaze(string calldata seed, uint256 tokenId) external onlyRole(REGISTRAR_ROLE) {
        // solhint-disable-next-line asm-keccak256
        bytes32 seedHash = keccak256(bytes(seed));
        require(officialMazes[seedHash] == 0, "Already registered");
        officialMazes[seedHash] = tokenId;
        emit MazeRegistered(seedHash, seed, tokenId);
    }

    /// @notice Withdraw contract balance
    /// @param to Recipient address
    function withdraw(address payable to) external onlyRole(WITHDRAWER_ROLE) {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoBalance();

        (bool success,) = to.call{ value: balance }("");
        if (!success) revert WithdrawalFailed();

        emit Withdrawal(to, balance);
    }

    /// @notice Receive ETH
    receive() external payable { }

    // Required overrides for multiple inheritance

    /// @dev Soulbound. A maze token is a claim that *this* account solved the
    ///      maze, so transferring it would make the claim false — the badges
    ///      and best-move count hanging off it belong to the solver, not to
    ///      whoever holds the token.
    ///
    ///      Minting (`from == 0`) and burning (`to == 0`) stay open. A holder
    ///      may discard their own record if they want to; what they cannot do
    ///      is pass it to someone who did not earn it.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        if (from != address(0) && to != address(0)) revert NonTransferable();
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

/// @title IVerifier
/// @notice Interface for ZK proof verifier contract
interface IVerifier {
    /// @notice Verify a ZK proof
    /// @param proof The proof bytes
    /// @param publicInputs Array of public inputs
    /// @return True if proof is valid
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool);
}

/// @title IMazeRenderer
/// @notice Interface for the on-chain SVG renderer
interface IMazeRenderer {
    function tokenURI(uint256 tokenId, bytes calldata layout) external view returns (string memory);
}
