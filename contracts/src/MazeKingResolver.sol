// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice The slice of MazeKing this resolver reads. Deliberately narrow: a
///         resolver should be able to answer questions about a maze and nothing
///         more.
interface IMazeKingScorecard {
    struct Score {
        address solver;
        uint16 moveCount;
        uint40 at;
    }

    function officialMazes(bytes32 seedHash) external view returns (uint256);
    function layouts(uint256 tokenId) external view returns (bytes memory);
    function optimalMoves(uint256 tokenId) external view returns (uint32);
    function podium(uint256 tokenId) external view returns (Score[3] memory);
    function renderer() external view returns (address);
}

interface IMazeRenderer {
    function renderSvg(uint256 tokenId, bytes calldata layout) external view returns (string memory);
}

/// @notice ENSIP-10 wildcard resolution. ENS calls this with the full
///         DNS-encoded name when no resolver is set on the subname itself.
interface IExtendedResolver {
    function resolve(bytes memory name, bytes memory data) external view returns (bytes memory);
}

/// @title MazeKingResolver
/// @notice Resolves `mazeking.eth` and every `<seed>.mazeking.eth` beneath it.
///
/// @dev The design constraint that shapes everything here: **ENS mirrors the
///      maze registry, it is never authoritative for it.** A maze's layout is
///      fixed by its seed and committed on chain; if a name could carry a
///      layout, whoever held the name could rewrite a maze and every replay and
///      score against it would silently become meaningless.
///
///      So subname records are not stored. They are *derived from the label*,
///      in this contract, at read time. There is no per-seed storage to write,
///      which means there is nothing for a name owner -- including this
///      contract's own admin -- to tamper with. The integrity property is
///      structural rather than a matter of policy, which is the only kind worth
///      relying on.
///
///      Apex records (`mazeking.eth` itself) *are* stored and settable. They
///      describe the project, not any maze, so they carry no replay risk. The
///      apex needs to live here because ENSIP-10 requires the resolver to be
///      set on the parent name for wildcard resolution to happen at all --
///      which means this contract necessarily displaces whatever resolver the
///      apex used before, and must therefore serve the apex too.
contract MazeKingResolver is IExtendedResolver, AccessControl {
    /// @dev Number of labels in the base name, e.g. `mazeking.eth` is 2.
    uint256 public immutable baseLabelCount;

    /// @notice The MazeKing NFT contract, reported as the name's address.
    address public mazeNft;

    /// @notice ENSIP-11 coin type for the chain `mazeNft` lives on.
    /// @dev `0x80000000 | chainId`. Deliberately not coin type 60: pointing the
    ///      mainnet address record at a contract that exists only on an L2
    ///      invites transfers to an address holding no contract on mainnet, and
    ///      those funds are unrecoverable.
    uint256 public nftCoinType;

    /// @notice Prefix a seed's URL is built from, e.g. `https://mazeking.io/s/`.
    string public seedUrlPrefix;

    /// @notice Records for the apex name only. Seeds derive theirs.
    mapping(string => string) private _apexText;
    /// @notice Apex addresses by ENSIP-11 coin type.
    mapping(uint256 => bytes) private _apexAddr;

    error UnsupportedSelector(bytes4 selector);
    error MalformedName();

    event ApexTextSet(string indexed key, string value);
    event ApexAddrSet(uint256 indexed coinType, bytes value);
    event NftSet(address nft, uint256 coinType);
    event SeedUrlPrefixSet(string prefix);

    // ENS resolver profile selectors.
    bytes4 private constant ADDR = 0x3b3b57de; // addr(bytes32)
    bytes4 private constant ADDR_COINTYPE = 0xf1cb7e06; // addr(bytes32,uint256)
    bytes4 private constant TEXT = 0x59d1d43c; // text(bytes32,string)
    bytes4 private constant EXTENDED_RESOLVER = 0x9061b923; // ENSIP-10

    constructor(
        address admin,
        address _mazeNft,
        uint256 _nftCoinType,
        string memory _seedUrlPrefix,
        uint256 _baseLabelCount
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        mazeNft = _mazeNft;
        nftCoinType = _nftCoinType;
        seedUrlPrefix = _seedUrlPrefix;
        baseLabelCount = _baseLabelCount;
    }

    // ----------------------------------------------------------------------
    // Administration -- apex only, by construction
    // ----------------------------------------------------------------------

    function setNft(address _mazeNft, uint256 _nftCoinType) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mazeNft = _mazeNft;
        nftCoinType = _nftCoinType;
        emit NftSet(_mazeNft, _nftCoinType);
    }

    function setSeedUrlPrefix(string calldata prefix) external onlyRole(DEFAULT_ADMIN_ROLE) {
        seedUrlPrefix = prefix;
        emit SeedUrlPrefixSet(prefix);
    }

    function setApexText(string calldata key, string calldata value)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _apexText[key] = value;
        emit ApexTextSet(key, value);
    }

    function setApexAddr(uint256 coinType, bytes calldata value)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _apexAddr[coinType] = value;
        emit ApexAddrSet(coinType, value);
    }

    // ----------------------------------------------------------------------
    // Resolution
    // ----------------------------------------------------------------------

    /// @inheritdoc IExtendedResolver
    /// @dev `name` is DNS-encoded: each label prefixed with its length, then a
    ///      zero byte. The node in `data` is ignored -- for a wildcard it is the
    ///      hash of a name that was never registered, so the label in `name` is
    ///      the only thing that identifies which maze is being asked about.
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        (string memory label, uint256 labelCount) = _firstLabel(name);
        bool isApex = labelCount <= baseLabelCount;

        bytes4 selector = bytes4(data[:4]);

        if (selector == TEXT) {
            (, string memory key) = abi.decode(data[4:], (bytes32, string));
            return abi.encode(isApex ? _apexText[key] : _seedText(label, key));
        }

        if (selector == ADDR) {
            // Coin type 60 is the mainnet address. Answering it with an L2
            // contract would make wallets offer transfers into an address that
            // holds no contract on mainnet, so this stays empty unless an admin
            // has deliberately set an apex mainnet address.
            return abi.encode(_bytesToAddress(isApex ? _apexAddr[60] : bytes("")));
        }

        if (selector == ADDR_COINTYPE) {
            (, uint256 coinType) = abi.decode(data[4:], (bytes32, uint256));
            if (isApex) return abi.encode(_apexAddr[coinType]);
            // Every maze lives in the same contract, so every seed name reports
            // the same address -- on the chain that contract is actually on.
            return abi.encode(coinType == nftCoinType ? abi.encodePacked(mazeNft) : bytes(""));
        }

        revert UnsupportedSelector(selector);
    }

    /// @dev Records for `<seed>.mazeking.eth`, all computed from the label.
    ///
    ///      Nothing here is stored. Every answer is read from the maze contract
    ///      at resolution time, so a scorecard cannot go stale and cannot
    ///      disagree with the chain -- the two are the same read.
    function _seedText(string memory label, string memory key)
        internal
        view
        returns (string memory)
    {
        bytes32 k = keccak256(bytes(key));

        if (k == keccak256("url")) {
            return string.concat(seedUrlPrefix, label);
        }
        if (k == keccak256("name")) {
            return label;
        }

        uint256 tokenId = IMazeKingScorecard(mazeNft).officialMazes(keccak256(bytes(label)));
        // A name nobody has registered describes no maze. Answering anyway
        // would present an empty scorecard as though the maze existed.
        if (tokenId == 0) return "";

        if (k == keccak256("avatar")) {
            return _avatar(tokenId);
        }
        if (k == keccak256("description")) {
            return _description(label, tokenId);
        }
        if (k == keccak256("first_place")) {
            return _place(tokenId, 0);
        }
        if (k == keccak256("second_place")) {
            return _place(tokenId, 1);
        }
        if (k == keccak256("third_place")) {
            return _place(tokenId, 2);
        }
        return "";
    }

    /// @dev The maze itself, drawn on chain and inlined as a data URI.
    ///      No hosting, no pinning, nothing to expire: the picture is generated
    ///      from the same layout bytes the proof commits to, so it cannot show
    ///      a different maze than the one being scored.
    function _avatar(uint256 tokenId) internal view returns (string memory) {
        address r = IMazeKingScorecard(mazeNft).renderer();
        if (r == address(0)) return "";
        bytes memory layout = IMazeKingScorecard(mazeNft).layouts(tokenId);
        if (layout.length == 0) return "";
        string memory svg = IMazeRenderer(r).renderSvg(tokenId, layout);
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)));
    }

    function _description(string memory label, uint256 tokenId)
        internal
        view
        returns (string memory)
    {
        uint32 optimal = IMazeKingScorecard(mazeNft).optimalMoves(tokenId);
        string memory tail = optimal == 0
            ? " Its shortest route has not been registered yet."
            : string.concat(
                " Its shortest possible route is ", Strings.toString(uint256(optimal)), " moves."
            );
        return string.concat('The MazeKing maze grown from the name "', label, '".', tail);
    }

    /// @dev One podium line: who, in how many moves, and when.
    ///      Empty rather than a zero address for an unclaimed place, so a
    ///      profile shows two winners rather than a third phantom one.
    function _place(uint256 tokenId, uint256 index) internal view returns (string memory) {
        IMazeKingScorecard.Score memory s = IMazeKingScorecard(mazeNft).podium(tokenId)[index];
        if (s.solver == address(0)) return "";
        return string.concat(
            Strings.toHexString(uint160(s.solver), 20),
            " - ",
            Strings.toString(uint256(s.moveCount)),
            " moves - ",
            Strings.toString(uint256(s.at))
        );
    }

    // ----------------------------------------------------------------------
    // DNS name decoding
    // ----------------------------------------------------------------------

    /// @dev Reads the first label and counts the rest. Reverts on a malformed
    ///      encoding rather than returning a plausible-looking wrong answer: a
    ///      truncated name that silently resolved would point somebody at the
    ///      wrong maze.
    function _firstLabel(bytes calldata name)
        internal
        pure
        returns (string memory label, uint256 labelCount)
    {
        if (name.length == 0) revert MalformedName();

        uint256 offset = 0;
        while (offset < name.length) {
            uint256 len = uint8(name[offset]);
            if (len == 0) {
                // Root terminator: a well-formed name ends exactly here.
                if (offset + 1 != name.length) revert MalformedName();
                return (label, labelCount);
            }
            if (offset + 1 + len > name.length) revert MalformedName();
            if (labelCount == 0) {
                label = string(name[offset + 1:offset + 1 + len]);
            }
            labelCount++;
            offset += 1 + len;
        }
        revert MalformedName();
    }

    function _bytesToAddress(bytes memory b) internal pure returns (address a) {
        if (b.length != 20) return address(0);
        assembly {
            a := div(mload(add(b, 32)), 0x1000000000000000000000000)
        }
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return interfaceId == EXTENDED_RESOLVER || super.supportsInterface(interfaceId);
    }
}
