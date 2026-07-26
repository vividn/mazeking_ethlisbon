// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MazeKingResolver } from "../src/MazeKingResolver.sol";

/// @dev The failure mode this suite is aimed at is quiet. A resolver that
///      returns the wrong label, or treats a subname as the apex, does not
///      revert -- it answers confidently with a record describing a different
///      maze. Every case here checks the answer, not merely that a call
///      succeeded.
contract MazeKingResolverTest is Test {
    MazeKingResolver public resolver;

    address public admin = address(1);
    address public nft = address(0xBEEF);
    uint256 public constant ZKEVM_COINTYPE = 2147484749; // 0x80000000 | 1101

    function setUp() public {
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

    function test_SeedDescriptionCarriesTheLabel() public view {
        string memory d = _text(_dns3("snark", "mazeking", "eth"), "description");
        assertTrue(bytes(d).length > 0);
        assertEq(
            d,
            'The MazeKing maze grown from the name "snark". Its layout is fixed by that name and committed on chain; this record only points at it.'
        );
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
