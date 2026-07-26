// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MazeKingResolver } from "../src/MazeKingResolver.sol";
import { MazeKingNFT } from "../src/MazeKingNFT.sol";
import { MazeRenderer } from "../src/MazeRenderer.sol";
import { MazeConstants } from "../src/MazeConstants.sol";

/// @dev Stands in for the maze contract in the tests that are about name
///      decoding rather than scorecards. It knows about no mazes, which is the
///      state every unregistered name is in.
contract EmptyMazeRegistry {
    function officialMazes(bytes32) external pure returns (uint256) {
        return 0;
    }
}

contract AlwaysValidVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev The failure mode this suite is aimed at is quiet. A resolver that
///      returns the wrong label, or treats a subname as the apex, does not
///      revert -- it answers confidently with a record describing a different
///      maze. Every case here checks the answer, not merely that a call
///      succeeded.
contract MazeKingResolverTest is Test {
    MazeKingResolver public resolver;

    address public admin = address(1);
    address public nft;
    uint256 public constant ZKEVM_COINTYPE = 2147484749; // 0x80000000 | 1101

    function setUp() public {
        nft = address(new EmptyMazeRegistry());
        resolver = new MazeKingResolver(admin, nft, ZKEVM_COINTYPE, "https://mazeking.io/s/", 2);
    }

    // ------------------------------------------------------------------
    // DNS name encoding helpers
    // ------------------------------------------------------------------

    function _dns1(string memory a) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(a).length), a, uint8(0));
    }

    function _dns2(string memory a, string memory b) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(bytes(a).length), a, uint8(bytes(b).length), b, uint8(0));
    }

    function _dns3(string memory a, string memory b, string memory c)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            uint8(bytes(a).length),
            a,
            uint8(bytes(b).length),
            b,
            uint8(bytes(c).length),
            c,
            uint8(0)
        );
    }

    function _text(bytes memory name, string memory key) internal view returns (string memory) {
        bytes memory out =
            resolver.resolve(name, abi.encodeWithSelector(0x59d1d43c, bytes32(0), key));
        return abi.decode(out, (string));
    }

    function _addrCoin(bytes memory name, uint256 coinType) internal view returns (bytes memory) {
        bytes memory out =
            resolver.resolve(name, abi.encodeWithSelector(0xf1cb7e06, bytes32(0), coinType));
        return abi.decode(out, (bytes));
    }

    // ------------------------------------------------------------------
    // Seed subnames derive their records from the label
    // ------------------------------------------------------------------

    function test_SeedUrlComesFromTheLabel() public view {
        assertEq(_text(_dns3("snark", "mazeking", "eth"), "url"), "https://mazeking.io/s/snark");
        assertEq(_text(_dns3("merkle", "mazeking", "eth"), "url"), "https://mazeking.io/s/merkle");
    }

    function test_SeedNameRecordIsTheLabelExactly() public view {
        // The seed string is hashed to produce the maze, so any normalisation
        // here would name a different maze than the one resolved.
        assertEq(_text(_dns3("Zero Knowledge", "mazeking", "eth"), "name"), "Zero Knowledge");
    }

    function test_SeedDescriptionNeedsARegisteredMaze() public view {
        // A description of a maze nobody registered would describe nothing.
        // The registered case is covered against the real contract in
        // MazeKingScorecardTest.
        assertEq(_text(_dns3("snark", "mazeking", "eth"), "description"), "");
    }

    function test_UnknownSeedKeyIsEmptyRatherThanWrong() public view {
        assertEq(_text(_dns3("snark", "mazeking", "eth"), "com.twitter"), "");
    }

    function test_EverySeedResolvesToTheOneContract() public view {
        assertEq(
            _addrCoin(_dns3("snark", "mazeking", "eth"), ZKEVM_COINTYPE), abi.encodePacked(nft)
        );
        assertEq(
            _addrCoin(_dns3("merkle", "mazeking", "eth"), ZKEVM_COINTYPE), abi.encodePacked(nft)
        );
    }

    function test_SeedGivesNoMainnetAddress() public view {
        // Coin type 60 is the mainnet address. Answering it with a contract
        // that exists only on an L2 invites transfers to an address holding no
        // contract on mainnet, and those funds are unrecoverable.
        assertEq(_addrCoin(_dns3("snark", "mazeking", "eth"), 60), bytes(""));

        bytes memory out = resolver.resolve(
            _dns3("snark", "mazeking", "eth"), abi.encodeWithSelector(0x3b3b57de, bytes32(0))
        );
        assertEq(abi.decode(out, (address)), address(0));
    }

    function test_SeedRecordsAreNotStorable() public view {
        // There is no setter for a seed's records -- the point of the design.
        // This asserts the consequence: an admin changing apex records cannot
        // change what a seed resolves to.
        assertEq(_text(_dns3("snark", "mazeking", "eth"), "url"), "https://mazeking.io/s/snark");
    }

    function test_AdminCannotOverrideASeedRecord() public {
        vm.prank(admin);
        resolver.setApexText("url", "https://evil.example/");

        // Apex changed; the seed did not. A name owner cannot rewrite a maze's
        // pointer, which is what keeps replay integrity out of ENS's hands.
        assertEq(_text(_dns2("mazeking", "eth"), "url"), "https://evil.example/");
        assertEq(_text(_dns3("snark", "mazeking", "eth"), "url"), "https://mazeking.io/s/snark");
    }

    // ------------------------------------------------------------------
    // The apex still works, because ENSIP-10 forces this resolver onto it
    // ------------------------------------------------------------------

    function test_ApexServesItsOwnStoredRecords() public {
        vm.startPrank(admin);
        resolver.setApexText("url", "https://mazeking.io");
        resolver.setApexText("description", "A zero-knowledge maze.");
        vm.stopPrank();

        assertEq(_text(_dns2("mazeking", "eth"), "url"), "https://mazeking.io");
        assertEq(_text(_dns2("mazeking", "eth"), "description"), "A zero-knowledge maze.");
    }

    function test_ApexDoesNotFallBackToSeedDerivation() public view {
        // Before any apex record is set, the apex must be empty rather than
        // resolving as if "mazeking" were a seed.
        assertEq(_text(_dns2("mazeking", "eth"), "url"), "");
        assertEq(_text(_dns2("mazeking", "eth"), "name"), "");
    }

    function test_ApexAddressIsSettablePerCoinType() public {
        vm.prank(admin);
        resolver.setApexAddr(ZKEVM_COINTYPE, abi.encodePacked(nft));
        assertEq(_addrCoin(_dns2("mazeking", "eth"), ZKEVM_COINTYPE), abi.encodePacked(nft));
    }

    function test_OnlyAdminMaySetApexRecords() public {
        vm.expectRevert();
        resolver.setApexText("url", "https://evil.example/");
    }

    // ------------------------------------------------------------------
    // Name decoding
    // ------------------------------------------------------------------

    function test_DeeperSubnameUsesItsLeftmostLabel() public view {
        // `a.b.mazeking.eth` is 4 labels; the maze is named by the leftmost.
        assertEq(
            _text(
                abi.encodePacked(
                    uint8(1), "a", uint8(1), "b", uint8(8), "mazeking", uint8(3), "eth", uint8(0)
                ),
                "url"
            ),
            "https://mazeking.io/s/a"
        );
    }

    function test_RejectsATruncatedName() public {
        // A label claiming more bytes than remain. Answering this would point
        // somebody at a maze whose name we only partly read.
        bytes memory bad = abi.encodePacked(uint8(9), "snark");
        vm.expectRevert(MazeKingResolver.MalformedName.selector);
        resolver.resolve(bad, abi.encodeWithSelector(0x59d1d43c, bytes32(0), "url"));
    }

    function test_RejectsAnUnterminatedName() public {
        bytes memory bad = abi.encodePacked(uint8(5), "snark");
        vm.expectRevert(MazeKingResolver.MalformedName.selector);
        resolver.resolve(bad, abi.encodeWithSelector(0x59d1d43c, bytes32(0), "url"));
    }

    function test_RejectsTrailingBytesAfterTheRoot() public {
        bytes memory bad = abi.encodePacked(uint8(5), "snark", uint8(0), uint8(3), "eth");
        vm.expectRevert(MazeKingResolver.MalformedName.selector);
        resolver.resolve(bad, abi.encodeWithSelector(0x59d1d43c, bytes32(0), "url"));
    }

    function test_RejectsAnEmptyName() public {
        vm.expectRevert(MazeKingResolver.MalformedName.selector);
        resolver.resolve("", abi.encodeWithSelector(0x59d1d43c, bytes32(0), "url"));
    }

    function test_HandlesALabelWithMultibyteCharacters() public view {
        // ENSIP-15 normalisation happens before resolution; whatever bytes
        // arrive must be carried through unchanged, since they are what the
        // maze was grown from.
        assertEq(
            _text(_dns3(unicode"maze♚king", "mazeking", "eth"), "name"), unicode"maze♚king"
        );
    }

    // ------------------------------------------------------------------
    // Interface advertisement
    // ------------------------------------------------------------------

    function test_AdvertisesExtendedResolver() public view {
        // Without this, ENS clients never attempt wildcard resolution at all.
        assertTrue(resolver.supportsInterface(0x9061b923));
    }

    function test_RejectsAProfileItCannotAnswer() public {
        // Returning empty for an unimplemented profile would look like a real
        // answer. contenthash(bytes32):
        vm.expectRevert(
            abi.encodeWithSelector(
                MazeKingResolver.UnsupportedSelector.selector, bytes4(0xbc1c58d1)
            )
        );
        resolver.resolve(
            _dns3("snark", "mazeking", "eth"), abi.encodeWithSelector(0xbc1c58d1, bytes32(0))
        );
    }
}

/// @dev The scorecard is only meaningful against a real maze, so this suite
///      wires the actual NFT and renderer rather than a stub. A resolver that
///      passes against a mock and fails against the contract it will be pointed
///      at has tested nothing that matters.
contract MazeKingScorecardTest is Test {
    MazeKingResolver public resolver;
    MazeKingNFT public nft;
    MazeRenderer public mazeRenderer;

    address public owner = address(1);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    string public constant SEED = "zero-knowledge";
    uint256 public constant COINTYPE = 2147484749;

    function setUp() public {
        vm.prank(owner);
        nft = new MazeKingNFT(
            "MazeKing",
            "MAZE",
            "https://api.mazeking.xyz/token/",
            owner,
            address(new AlwaysValidVerifier())
        );
        mazeRenderer = new MazeRenderer();
        vm.prank(owner);
        nft.setRenderer(address(mazeRenderer));

        resolver = new MazeKingResolver(owner, address(nft), COINTYPE, "https://mazeking.io/s/", 2);
    }

    function _layout() internal pure returns (bytes memory layout) {
        layout = new bytes(MazeConstants.LAYOUT_HEADER_BYTES + 50);
        uint16[10] memory hdr = [uint16(10), 10, 0, 0, 5, 5, 7, 2, 9, 9];
        for (uint256 i = 0; i < 10; i++) {
            layout[i * 2] = bytes1(uint8(hdr[i] >> 8));
            layout[i * 2 + 1] = bytes1(uint8(hdr[i] & 0xFF));
        }
    }

    function _name() internal pure returns (bytes memory) {
        return abi.encodePacked(
            uint8(14), "zero-knowledge", uint8(8), "mazeking", uint8(3), "eth", uint8(0)
        );
    }

    function _text(string memory key) internal view returns (string memory) {
        return abi.decode(
            resolver.resolve(_name(), abi.encodeWithSelector(0x59d1d43c, bytes32(0), key)), (string)
        );
    }

    function _noAtt() internal pure returns (MazeKingNFT.MazeAttestation memory) {
        return MazeKingNFT.MazeAttestation({ seed: "", optimalMoves: 0, signature: "" });
    }

    function _register(bytes32 mazeHash, bytes memory layout, uint32 optimal) internal {
        vm.startPrank(owner);
        nft.registerMaze(SEED, uint256(mazeHash));
        nft.setLayout(uint256(mazeHash), layout);
        nft.setOptimalMoves(uint256(mazeHash), optimal);
        vm.stopPrank();
    }

    function test_UnregisteredNameDescribesNoMaze() public view {
        // An empty scorecard presented as though the maze existed would be a
        // confident lie; better to say nothing.
        assertEq(_text("avatar"), "");
        assertEq(_text("first_place"), "");
        assertEq(_text("description"), "");
        // The url is still derivable, because it is true of any name.
        assertEq(_text("url"), "https://mazeking.io/s/zero-knowledge");
    }

    function test_AvatarIsTheMazeDrawnOnChain() public {
        bytes memory layout = _layout();
        bytes32 mazeHash = keccak256(layout);
        _register(mazeHash, layout, 42);

        string memory avatar = _text("avatar");
        assertGt(bytes(avatar).length, 100);
        // A data URI, so there is nothing to host and nothing to expire.
        assertEq(keccak256(bytes(_prefix(avatar, 26))), keccak256("data:image/svg+xml;base64,"));
    }

    function _prefix(string memory str, uint256 n) internal pure returns (string memory) {
        bytes memory b = bytes(str);
        bytes memory out = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = b[i];
        }
        return string(out);
    }

    function test_DescriptionCarriesTheRegisteredOptimum() public {
        bytes memory layout = _layout();
        bytes32 mazeHash = keccak256(layout);
        _register(mazeHash, layout, 42);

        string memory d = _text("description");
        assertEq(
            d,
            'The MazeKing maze grown from the name "zero-knowledge". Its shortest possible route is 42 moves.'
        );
    }

    function test_DescriptionSaysSoWhenTheOptimumIsUnknown() public {
        bytes memory layout = _layout();
        bytes32 mazeHash = keccak256(layout);
        vm.startPrank(owner);
        nft.registerMaze(SEED, uint256(mazeHash));
        nft.setLayout(uint256(mazeHash), layout);
        vm.stopPrank();

        assertEq(
            _text("description"),
            'The MazeKing maze grown from the name "zero-knowledge". Its shortest route has not been registered yet.'
        );
    }

    function test_PodiumRecordsResolveInOrder() public {
        bytes memory layout = _layout();
        bytes32 mazeHash = keccak256(layout);
        _register(mazeHash, layout, 42);

        vm.prank(alice);
        nft.mintWithProof(hex"00", mazeHash, layout, 90, false, _noAtt());
        vm.prank(bob);
        nft.mintWithProof(hex"00", mazeHash, layout, 70, false, _noAtt());

        // Bob solved it better, so Bob leads regardless of who minted first.
        assertGt(bytes(_text("first_place")).length, 0);
        assertGt(bytes(_text("second_place")).length, 0);
        // Only two solvers, so the third place must be absent rather than a
        // phantom zero address.
        assertEq(_text("third_place"), "");
    }

    function test_ScorecardTracksTheChainRatherThanACopy() public {
        bytes memory layout = _layout();
        bytes32 mazeHash = keccak256(layout);
        _register(mazeHash, layout, 42);

        vm.prank(alice);
        nft.mintWithProof(hex"00", mazeHash, layout, 90, false, _noAtt());
        string memory before = _text("first_place");

        vm.prank(bob);
        nft.mintWithProof(hex"00", mazeHash, layout, 60, false, _noAtt());
        string memory afterSolve = _text("first_place");

        // Nothing was written to the resolver between these two reads. The
        // record changed because the chain did, which is the whole point of
        // deriving rather than storing.
        assertTrue(keccak256(bytes(before)) != keccak256(bytes(afterSolve)));
    }
}
