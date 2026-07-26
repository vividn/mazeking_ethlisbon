// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

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
    function _seedText(string memory label, string memory key)
        internal
        view
        returns (string memory)
    {
        bytes32 k = keccak256(bytes(key));

        if (k == keccak256("url")) {
            return string.concat(seedUrlPrefix, label);
        }
        if (k == keccak256("description")) {
            return string.concat(
                'The MazeKing maze grown from the name "',
                label,
                '". Its layout is fixed by that name and committed on chain; this record only points at it.'
            );
        }
        if (k == keccak256("name")) {
            return label;
        }
        return "";
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
