// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MazeKingNFT } from "../src/MazeKingNFT.sol";
import { MazeConstants } from "../src/MazeConstants.sol";
import { IBadgeAwarder } from "../src/IBadgeAwarder.sol";
import { DefaultBadgeAwarder } from "../src/DefaultBadgeAwarder.sol";
import { MazeRenderer } from "../src/MazeRenderer.sol";

/// @title MockVerifier
/// @notice Mock verifier for testing
contract MockVerifier {
    bool public shouldPass;

    constructor(bool _shouldPass) {
        shouldPass = _shouldPass;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return shouldPass;
    }

    function setShouldPass(bool _shouldPass) external {
        shouldPass = _shouldPass;
    }
}

/// @notice Verifier stub that models the one property a real SNARK verifier
///         gives us: a proof is valid only against the exact public-input
///         vector it was produced for. Accepts only when publicInputs[2]
///         carries the address the proof was made for.
contract SenderBindingVerifier {
    address public provenFor;

    constructor(address _provenFor) {
        provenFor = _provenFor;
    }

    function verify(bytes calldata, bytes32[] calldata publicInputs) external view returns (bool) {
        require(publicInputs.length == 3, "expected 3 public inputs");
        return publicInputs[2] == bytes32(uint256(uint160(provenFor)));
    }
}

/// @notice Asserts the exact public-input vector it is handed. The verifier
///         interface is `view` (the NFT staticcalls it), so this cannot record
///         to storage — it checks against expectations fixed at construction
///         instead, and a successful mint is the proof that the wiring is right.
contract ExpectingVerifier {
    bytes32 public expectedMazeHash;
    bytes32 public expectedMoveCount;
    bytes32 public expectedSender;

    constructor(bytes32 _mazeHash, bytes32 _moveCount, bytes32 _sender) {
        expectedMazeHash = _mazeHash;
        expectedMoveCount = _moveCount;
        expectedSender = _sender;
    }

    function verify(bytes calldata, bytes32[] calldata publicInputs) external view returns (bool) {
        require(publicInputs.length == 3, "expected 3 public inputs");
        require(publicInputs[0] == expectedMazeHash, "publicInputs[0] != mazeHash");
        require(publicInputs[1] == expectedMoveCount, "publicInputs[1] != moveCount");
        require(publicInputs[2] == expectedSender, "publicInputs[2] != msg.sender");
        return true;
    }
}

contract MazeKingNFTTest is Test {
    MazeKingNFT public nft;
    MockVerifier public verifier;
    address public owner = address(1);
    address public user = address(2);

    function setUp() public {
        // Deploy mock verifier
        verifier = new MockVerifier(true);

        // Deploy NFT with verifier
        vm.prank(owner);
        nft = new MazeKingNFT(
            "MazeKing", "MAZE", "https://api.mazeking.xyz/token/", owner, address(verifier)
        );
    }

    function test_InitialSetup() public view {
        assertEq(nft.name(), "MazeKing");
        assertEq(nft.symbol(), "MAZE");
        assertEq(nft.verifierContract(), address(verifier));
        assertTrue(nft.hasRole(nft.OWNER_ROLE(), owner));
        assertTrue(nft.hasRole(nft.WITHDRAWER_ROLE(), owner));
        assertTrue(nft.hasRole(nft.REGISTRAR_ROLE(), owner));
        assertTrue(nft.hasRole(nft.DEFAULT_ADMIN_ROLE(), owner));
    }

    function test_SetURI() public {
        vm.prank(owner);
        nft.setURI("https://new.uri/");
    }

    function test_RevertSetURIWithoutRole() public {
        vm.prank(user);
        vm.expectRevert();
        nft.setURI("https://new.uri/");
    }

    function test_Withdraw() public {
        vm.deal(address(nft), 1 ether);

        vm.prank(owner);
        nft.withdraw(payable(owner));

        assertEq(address(nft).balance, 0);
        assertEq(owner.balance, 1 ether);
    }

    function test_RevertWithdrawWithoutRole() public {
        vm.deal(address(nft), 1 ether);

        vm.prank(user);
        vm.expectRevert();
        nft.withdraw(payable(user));
    }

    function test_RevertWithdrawNoBalance() public {
        vm.prank(owner);
        vm.expectRevert(MazeKingNFT.NoBalance.selector);
        nft.withdraw(payable(owner));
    }

    function test_ReceiveETH() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        (bool success,) = address(nft).call{ value: 0.5 ether }("");
        assertTrue(success);
        assertEq(address(nft).balance, 0.5 ether);
    }

    // ==================================================
    // ZK Proof Minting Tests
    // ==================================================

    /// @dev Default mock layout: 10x10 maze, all zeros for packed cells (we
    ///      don't actually verify path validity here — the MockVerifier
    ///      always returns true).
    function _mockLayout() internal pure returns (bytes memory) {
        bytes memory layout = new bytes(MazeConstants.LAYOUT_HEADER_BYTES + 50);
        // BE u16 header (10 fields):
        //   width=10, height=10, sx=0, sy=0, robe=(5,5), scepter=(7,2), goal=(9,9)
        uint16[10] memory hdr = [uint16(10), 10, 0, 0, 5, 5, 7, 2, 9, 9];
        for (uint256 i = 0; i < 10; i++) {
            layout[i * 2] = bytes1(uint8(hdr[i] >> 8));
            layout[i * 2 + 1] = bytes1(uint8(hdr[i] & 0xFF));
        }
        return layout;
    }

    /// @dev Deterministic stand-in for the off-chain Pedersen hash. The
    ///      MockVerifier ignores the actual hash, so any deterministic
    ///      function of the layout suffices to give each layout a stable
    ///      tokenId in tests.
    function _mockMazeHash(bytes memory layout) internal pure returns (bytes32) {
        return keccak256(layout);
    }

    function test_MintWithProof() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        bytes memory proof = hex"1234567890";

        vm.prank(user);
        nft.mintWithProof(proof, mazeHash, layout, 100, false, _noAttestation());

        uint256 expectedTokenId = uint256(mazeHash);

        // Verify NFT minted
        assertEq(nft.balanceOf(user, expectedTokenId), 1);

        // Verify stats — no awarder configured by default, so badges stay 0
        (uint16 minMoves, uint16 timesSolved, uint32 badges,) = nft.stats(expectedTokenId, user);
        assertEq(minMoves, 100);
        assertEq(timesSolved, 1);
        assertEq(badges, 0);
    }

    /// The regression this whole change exists for. Proofs ride in public
    /// calldata; before sender-binding, an observer could copy one out of the
    /// mempool and front-run the prover to steal the token and its badges.
    function test_MintWithProof_StolenProofRevertsForThief() public {
        address alice = address(0xA11CE);
        address bob = address(0xB0B);

        SenderBindingVerifier bindingVerifier = new SenderBindingVerifier(alice);
        vm.prank(owner);
        nft.setVerifier(address(bindingVerifier));

        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        bytes memory proof = hex"1234567890";

        // Alice proved it, so Alice can mint it.
        vm.prank(alice);
        nft.mintWithProof(proof, mazeHash, layout, 100, false, _noAttestation());
        assertEq(nft.balanceOf(alice, uint256(mazeHash)), 1);

        // Bob replays the identical proof bytes. This is the attack, and it
        // must fail: the proof commits to Alice's address, not his.
        vm.prank(bob);
        vm.expectRevert("Invalid proof");
        nft.mintWithProof(proof, mazeHash, layout, 100, false, _noAttestation());
        assertEq(nft.balanceOf(bob, uint256(mazeHash)), 0);
    }

    /// Guards the wiring itself: the contract must hand the verifier three
    /// public inputs, with the caller's address in slot 2.
    function test_MintWithProof_ForwardsSenderAsThirdPublicInput() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        ExpectingVerifier expecting = new ExpectingVerifier(
            mazeHash, bytes32(uint256(100)), bytes32(uint256(uint160(user)))
        );
        vm.prank(owner);
        nft.setVerifier(address(expecting));

        // Mint succeeds only if the contract passed exactly
        // [mazeHash, moveCount, msg.sender].
        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());
        assertEq(nft.balanceOf(user, uint256(mazeHash)), 1);
    }

    /// Opt-in bearer mode: a proof produced without a wallet (bound to the
    /// zero sentinel) can be minted by whoever holds it. This is the
    /// "practice proof" path — the user is knowingly accepting that it is
    /// copyable, in exchange for being able to prove before connecting.
    function test_MintWithProof_BearerProofMintsForAnyone() public {
        address stranger = address(0xBEEF);

        // Verifier that only accepts the unbound sentinel — i.e. a proof
        // produced with sender = 0.
        SenderBindingVerifier unbound = new SenderBindingVerifier(address(0));
        vm.prank(owner);
        nft.setVerifier(address(unbound));

        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        vm.prank(stranger);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, true, _noAttestation());
        assertEq(nft.balanceOf(stranger, uint256(mazeHash)), 1);
    }

    /// The property that keeps the two modes from weakening each other: a
    /// proof bound to an address cannot be laundered through the bearer path.
    /// Without this, bearer mode would reopen the hole for *every* proof.
    function test_MintWithProof_BoundProofCannotBeReplayedAsBearer() public {
        address alice = address(0xA11CE);

        SenderBindingVerifier boundToAlice = new SenderBindingVerifier(alice);
        vm.prank(owner);
        nft.setVerifier(address(boundToAlice));

        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        // Alice's own bound mint works.
        vm.prank(alice);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());

        // Same proof, submitted as bearer — publicInputs[2] becomes 0, which
        // is not what Alice's proof committed to.
        vm.prank(address(0xBEEF));
        vm.expectRevert("Invalid proof");
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, true, _noAttestation());
    }

    /// And the mirror: a bearer proof cannot be spent in bound mode, because
    /// publicInputs[2] would carry the caller instead of the sentinel.
    function test_MintWithProof_BearerProofCannotBeSpentAsBound() public {
        SenderBindingVerifier unbound = new SenderBindingVerifier(address(0));
        vm.prank(owner);
        nft.setVerifier(address(unbound));

        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        vm.prank(user);
        vm.expectRevert("Invalid proof");
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());
    }

    function test_MazesOf_ListsSolvedMazes() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        assertEq(nft.mazeCountOf(user), 0);
        assertEq(nft.mazesOf(user).length, 0);

        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());

        uint256[] memory owned = nft.mazesOf(user);
        assertEq(owned.length, 1);
        assertEq(owned[0], uint256(mazeHash));
        assertEq(nft.mazeCountOf(user), 1);

        // Another solver's collection is independent.
        assertEq(nft.mazeCountOf(address(0xFEE1)), 0);
    }

    function test_MazesOf_ResolvingTheSameMazeTwiceDoesNotDuplicate() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        vm.startPrank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 80, false, _noAttestation());
        vm.stopPrank();

        assertEq(nft.mazeCountOf(user), 1);
    }

    function test_Transfer_Reverts_TokensAreSoulbound() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());

        // The token asserts that `user` solved this maze. Handing it to someone
        // else would hand over a claim they did not earn.
        vm.prank(user);
        vm.expectRevert(MazeKingNFT.NonTransferable.selector);
        nft.safeTransferFrom(user, address(0xFEE1), tokenId, 1, "");

        assertEq(nft.balanceOf(user, tokenId), 1);
        assertEq(nft.balanceOf(address(0xFEE1), tokenId), 0);
    }

    function test_BatchTransfer_Reverts_TokensAreSoulbound() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());

        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = uint256(mazeHash);
        amounts[0] = 1;

        vm.prank(user);
        vm.expectRevert(MazeKingNFT.NonTransferable.selector);
        nft.safeBatchTransferFrom(user, address(0xFEE1), ids, amounts, "");
    }

    /// Burning is blocked too, and not out of strictness. `stats` survives a
    /// burn, so the solve is never actually erased — while the mint path reads
    /// `balanceOf == 0` as a first solve, so re-solving afterwards overwrites
    /// minMoves and resets timesSolved. Measured before this was disallowed: a
    /// 22-move best became 90, and a count of 2 became 1.
    function test_Burn_Reverts_TokensAreMintOnly() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());

        // ERC1155Burnable is no longer inherited, so there is no burn entry
        // point at all. The underlying transfer-to-zero is refused too —
        // by OpenZeppelin's own zero-address receiver check, which fires
        // before _update, so the specific error is ERC1155InvalidReceiver
        // rather than NonTransferable. What matters is that the balance is
        // untouched by either route.
        vm.prank(user);
        vm.expectRevert();
        nft.safeTransferFrom(user, address(0), tokenId, 1, "");

        assertEq(nft.balanceOf(user, tokenId), 1);
    }

    /// A solver's best run cannot be destroyed by any sequence of actions,
    /// which is the property blocking burn is really protecting.
    function test_BestScoreSurvivesResolving() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 22, false, _noAttestation());
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 90, false, _noAttestation());
        vm.stopPrank();

        (uint16 best, uint16 solves,,) = nft.stats(tokenId, user);
        assertEq(best, 22);
        assertEq(solves, 3);
        assertEq(nft.mazeCountOf(user), 1);
    }

    function test_AllMazes_ListsEveryMazeOnce() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        assertEq(nft.mazeCount(), 0);

        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());
        assertEq(nft.mazeCount(), 1);

        // A second solver of the SAME maze must not add a second entry — the
        // list is of mazes, not of solves.
        vm.prank(address(0xFEE1));
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 80, false, _noAttestation());
        assertEq(nft.mazeCount(), 1);

        // The same solver re-solving must not either.
        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 70, false, _noAttestation());
        assertEq(nft.mazeCount(), 1);

        uint256[] memory all = nft.allMazes();
        assertEq(all.length, 1);
        assertEq(all[0], uint256(mazeHash));
    }

    function test_AllMazes_DistinctMazesEachAppear() public {
        bytes memory a = _mockLayout();
        bytes memory b = _mockLayout();
        b[21] = bytes1(uint8(0x7F)); // perturb the cell bytes -> different hash
        bytes32 ha = _mockMazeHash(a);
        bytes32 hb = _mockMazeHash(b);
        assertTrue(ha != hb);

        vm.startPrank(user);
        nft.mintWithProof(hex"1234567890", ha, a, 100, false, _noAttestation());
        nft.mintWithProof(hex"1234567890", hb, b, 100, false, _noAttestation());
        vm.stopPrank();

        assertEq(nft.mazeCount(), 2);
    }

    /// A registrar-published maze belongs in the gallery before anyone solves
    /// it, and re-publishing its layout must not list it twice.
    function test_AllMazes_IncludesRegistrarPublishedMazes() public {
        bytes memory layout = _mockLayout();
        uint256 tokenId = uint256(_mockMazeHash(layout));

        vm.prank(owner);
        nft.setLayout(tokenId, layout);
        assertEq(nft.mazeCount(), 1);

        vm.prank(owner);
        nft.setLayout(tokenId, layout);
        assertEq(nft.mazeCount(), 1);

        // And a later mint of that same maze still does not duplicate it.
        vm.prank(user);
        nft.mintWithProof(
            hex"1234567890", _mockMazeHash(layout), layout, 100, false, _noAttestation()
        );
        assertEq(nft.mazeCount(), 1);
    }

    function test_AllMazesSlice_Pages() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());

        assertEq(nft.allMazesSlice(0, 10).length, 1);
        assertEq(nft.allMazesSlice(5, 10).length, 0);
        assertEq(nft.allMazesSlice(0, 0).length, 0);
    }

    function test_MazesOfSlice_Pages() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());

        assertEq(nft.mazesOfSlice(user, 0, 10).length, 1);
        // start past the end returns empty rather than reverting
        assertEq(nft.mazesOfSlice(user, 5, 10).length, 0);
        assertEq(nft.mazesOfSlice(user, 0, 0).length, 0);
    }

    // ==================================================
    // Registrar attestations (EIP-712)
    // ==================================================

    uint256 internal constant REGISTRAR_PK = 0xA11CE5;

    string internal constant SEED = "zero-knowledge";

    /// @dev An empty signature means "no attestation", which every pre-existing
    ///      mint test relies on: registration is opt-in and skipping it must
    ///      leave minting exactly as it was.
    function _noAttestation() internal pure returns (MazeKingNFT.MazeAttestation memory) {
        return MazeKingNFT.MazeAttestation({ seed: "", optimalMoves: 0, signature: "" });
    }

    function _attest(bytes32 mazeHash, bytes memory layout, uint32 optimal, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        return _attest(SEED, mazeHash, layout, optimal, pk);
    }

    function _attest(
        string memory seed,
        bytes32 mazeHash,
        bytes memory layout,
        uint32 optimal,
        uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 digest = nft.attestationDigest(seed, mazeHash, keccak256(layout), optimal);
        (uint8 v, bytes32 r, bytes32 sVal) = vm.sign(pk, digest);
        return abi.encodePacked(r, sVal, v);
    }

    function _grantRegistrar(uint256 pk) internal returns (address who) {
        who = vm.addr(pk);
        // Read the role id BEFORE pranking: vm.prank applies to the next call,
        // and evaluating nft.REGISTRAR_ROLE() inline would consume it.
        bytes32 role = nft.REGISTRAR_ROLE();
        vm.prank(owner);
        nft.grantRole(role, who);
    }

    /// The point of the whole design: a maze becomes badge-capable during the
    /// player's own mint, with no transaction from the registrar.
    function test_Attestation_RegistersDuringMint() public {
        _grantRegistrar(REGISTRAR_PK);
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        assertEq(nft.optimalMoves(tokenId), 0);
        assertFalse(nft.registrarApproved(tokenId));

        bytes memory sig = _attest(mazeHash, layout, 42, REGISTRAR_PK);
        vm.prank(user);
        nft.mintWithProof(
            hex"1234567890",
            mazeHash,
            layout,
            100,
            false,
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 42, signature: sig })
        );

        assertEq(nft.optimalMoves(tokenId), 42);
        assertTrue(nft.registrarApproved(tokenId));
        assertEq(nft.balanceOf(user, tokenId), 1);
    }

    /// A signature from a key without REGISTRAR_ROLE must not register a maze,
    /// or players could assert their own optimum and mint themselves crowns.
    function test_Attestation_RejectsNonRegistrarSigner() public {
        uint256 impostorPk = 0xBADBEEF;
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        // Sign before expectRevert — _attest reads attestationDigest from the
        // contract, and that call would otherwise absorb the expectation.
        bytes memory sig = _attest(mazeHash, layout, 1, impostorPk);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(MazeKingNFT.BadAttestation.selector, vm.addr(impostorPk))
        );
        nft.mintWithProof(
            hex"1234567890",
            mazeHash,
            layout,
            100,
            false,
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 1, signature: sig })
        );
    }

    /// The signature covers the layout by hash, so a caller cannot pair a valid
    /// attestation with different layout bytes.
    function test_Attestation_RejectsSwappedLayout() public {
        _grantRegistrar(REGISTRAR_PK);
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        bytes memory other = _mockLayout();
        other[25] = bytes1(uint8(0x5A));

        bytes memory sig = _attest(mazeHash, layout, 42, REGISTRAR_PK);
        vm.prank(user);
        vm.expectRevert();
        nft.mintWithProof(
            hex"1234567890",
            mazeHash,
            other,
            100,
            false,
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 42, signature: sig })
        );
    }

    /// Likewise the optimum: raising it after signing would make a worse solve
    /// look optimal.
    function test_Attestation_RejectsAlteredOptimalMoves() public {
        _grantRegistrar(REGISTRAR_PK);
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        bytes memory sig = _attest(mazeHash, layout, 42, REGISTRAR_PK);
        vm.prank(user);
        vm.expectRevert();
        nft.mintWithProof(
            hex"1234567890",
            mazeHash,
            layout,
            100,
            false,
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 999, signature: sig })
        );
    }

    /// Anyone may carry an attestation; the authority is the signature, not the
    /// caller.
    function test_Attestation_RegisterIsPermissionlessToSubmit() public {
        _grantRegistrar(REGISTRAR_PK);
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        bytes memory sig = _attest(mazeHash, layout, 77, REGISTRAR_PK);
        vm.prank(address(0xFEE1));
        nft.registerWithAttestation(
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 77, signature: sig }),
            mazeHash,
            layout
        );

        assertEq(nft.optimalMoves(uint256(mazeHash)), 77);
        assertEq(nft.mazeCount(), 1);
    }

    /// Minting without an attestation must keep working, for mazes already
    /// registered.
    function test_Attestation_EmptySignatureSkipsRegistration() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        vm.prank(user);
        nft.mintWithProof(hex"1234567890", mazeHash, layout, 100, false, _noAttestation());

        assertEq(nft.balanceOf(user, uint256(mazeHash)), 1);
        assertEq(nft.optimalMoves(uint256(mazeHash)), 0);
    }

    /// Registration is idempotent, which matters because popular seeds will be
    /// attested by many players at once.
    function test_Attestation_IsIdempotent() public {
        _grantRegistrar(REGISTRAR_PK);
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        bytes memory sig = _attest(mazeHash, layout, 42, REGISTRAR_PK);

        vm.prank(address(0xFEE1));
        nft.registerWithAttestation(
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 42, signature: sig }),
            mazeHash,
            layout
        );
        vm.prank(address(0xFEE2));
        nft.registerWithAttestation(
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 42, signature: sig }),
            mazeHash,
            layout
        );

        assertEq(nft.mazeCount(), 1);
        assertEq(nft.optimalMoves(uint256(mazeHash)), 42);
    }

    function test_MintWithProof_InvalidProof() public {
        verifier.setShouldPass(false);

        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        bytes memory proof = hex"1234567890";

        vm.prank(user);
        vm.expectRevert("Invalid proof");
        nft.mintWithProof(proof, mazeHash, layout, 100, false, _noAttestation());
    }

    function test_MintWithProof_TwiceUpdatesBest() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        bytes memory proof = hex"1234567890";

        vm.prank(user);
        nft.mintWithProof(proof, mazeHash, layout, 100, false, _noAttestation());

        uint256 tokenId = uint256(mazeHash);

        (uint16 minMoves1, uint16 timesSolved1,,) = nft.stats(tokenId, user);
        assertEq(minMoves1, 100);
        assertEq(timesSolved1, 1);

        vm.prank(user);
        nft.mintWithProof(proof, mazeHash, layout, 80, false, _noAttestation());

        (uint16 minMoves2, uint16 timesSolved2,,) = nft.stats(tokenId, user);
        assertEq(minMoves2, 80);
        assertEq(timesSolved2, 2);
        assertEq(nft.balanceOf(user, tokenId), 1);

        vm.prank(user);
        nft.mintWithProof(proof, mazeHash, layout, 90, false, _noAttestation());

        (uint16 minMoves3, uint16 timesSolved3,,) = nft.stats(tokenId, user);
        assertEq(minMoves3, 80);
        assertEq(timesSolved3, 3);
    }

    function test_SetVerifier() public {
        MockVerifier newVerifier = new MockVerifier(true);

        vm.prank(owner);
        nft.setVerifier(address(newVerifier));

        assertEq(nft.verifierContract(), address(newVerifier));
    }

    function test_RevertSetVerifierWithoutRole() public {
        MockVerifier newVerifier = new MockVerifier(true);

        vm.prank(user);
        vm.expectRevert();
        nft.setVerifier(address(newVerifier));
    }

    function test_RegisterMaze() public {
        string memory seed = "test-maze-seed";
        uint256 tokenId = 12345;

        vm.prank(owner);
        nft.registerMaze(seed, tokenId);

        bytes32 seedHash = keccak256(bytes(seed));
        assertEq(nft.officialMazes(seedHash), tokenId);
    }

    function test_RevertRegisterMazeTwice() public {
        string memory seed = "test-maze-seed";
        uint256 tokenId = 12345;

        vm.prank(owner);
        nft.registerMaze(seed, tokenId);

        vm.prank(owner);
        vm.expectRevert("Already registered");
        nft.registerMaze(seed, tokenId);
    }

    function test_RevertRegisterMazeWithoutRole() public {
        string memory seed = "test-maze-seed";
        uint256 tokenId = 12345;

        vm.prank(user);
        vm.expectRevert();
        nft.registerMaze(seed, tokenId);
    }

    // ==================================================
    // Badge Awarder Integration Tests
    // ==================================================

    function test_SetBadgeAwarder() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));

        vm.prank(owner);
        nft.setBadgeAwarder(address(awarder));

        assertEq(nft.badgeAwarder(), address(awarder));
    }

    function test_RevertSetBadgeAwarderWithoutRole() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));

        vm.prank(user);
        vm.expectRevert();
        nft.setBadgeAwarder(address(awarder));
    }

    function test_RegistrarSetters() public {
        uint256 tokenId = 42;

        vm.startPrank(owner);
        nft.setOptimalMoves(tokenId, 50);
        nft.setRegistered(tokenId, true);
        nft.setRegistrarApproved(tokenId, true);
        vm.stopPrank();

        assertEq(nft.optimalMoves(tokenId), 50);
        assertTrue(nft.registered(tokenId));
        assertTrue(nft.registrarApproved(tokenId));
    }

    function test_RevertSetOptimalMovesWithoutRole() public {
        vm.prank(user);
        vm.expectRevert();
        nft.setOptimalMoves(1, 10);
    }

    function test_RevertSetRegisteredWithoutRole() public {
        vm.prank(user);
        vm.expectRevert();
        nft.setRegistered(1, true);
    }

    function test_RevertSetRegistrarApprovedWithoutRole() public {
        vm.prank(user);
        vm.expectRevert();
        nft.setRegistrarApproved(1, true);
    }

    function test_DisqualifyMaze() public {
        uint256 tokenId = 7777;

        assertFalse(nft.disqualified(tokenId));

        vm.expectEmit(true, false, false, true);
        emit MazeKingNFT.MazeDisqualified(tokenId, true);
        vm.prank(owner);
        nft.disqualifyMaze(tokenId, true);
        assertTrue(nft.disqualified(tokenId));

        vm.expectEmit(true, false, false, true);
        emit MazeKingNFT.MazeDisqualified(tokenId, false);
        vm.prank(owner);
        nft.disqualifyMaze(tokenId, false);
        assertFalse(nft.disqualified(tokenId));
    }

    function test_RevertDisqualifyMazeWithoutRole() public {
        vm.prank(user);
        vm.expectRevert();
        nft.disqualifyMaze(1, true);
    }

    function test_MintWithProof_AwardsRegisteredBadge() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(owner);
        nft.setBadgeAwarder(address(awarder));
        nft.setRegistrarApproved(tokenId, true);
        vm.stopPrank();

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 100, false, _noAttestation());

        (,, uint32 badges,) = nft.stats(tokenId, user);
        assertEq(badges, nft.BADGE_REGISTERED());
    }

    function test_MintWithProof_AwardsRobotOnPerfect() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(owner);
        nft.setBadgeAwarder(address(awarder));
        nft.setOptimalMoves(tokenId, 100);
        vm.stopPrank();

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 100, false, _noAttestation());

        (,, uint32 badges,) = nft.stats(tokenId, user);
        assertEq(badges & nft.BADGE_ROBOT(), nft.BADGE_ROBOT());
        assertEq(badges & nft.BADGE_GOLD(), 0);
        assertEq(badges & nft.BADGE_SILVER(), 0);
        assertEq(badges & nft.BADGE_COPPER(), 0);
    }

    /// @dev These call the awarder directly rather than minting through it.
    ///      `awardBadges` is a pure view over (solver, mazeHash, moveCount), so
    ///      testing it head-on states the rule without depending on the shape of
    ///      `mintWithProof` -- which other work is widening in parallel. Badge
    ///      delivery through a mint is already covered by the robot/gold/silver
    ///      cases below.
    function test_BadgeBug_AwardedBelowTheOptimum() public {
        // A solve shorter than the optimum is impossible if the optimum is
        // right, so this badge doubles as an on-chain bug report. It used to
        // fall through the awarder earning nothing at all.
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        uint256 tokenId = uint256(_mockMazeHash(_mockLayout()));

        vm.prank(owner);
        nft.setOptimalMoves(tokenId, 100);

        uint32 badges = awarder.awardBadges(user, tokenId, 99);

        assertEq(badges & nft.BADGE_BUG(), nft.BADGE_BUG());
        // Not also a perfect solve, nor any medal: those all describe a solve
        // the optimum explains, and this one does not.
        assertEq(badges & nft.BADGE_ROBOT(), 0);
        assertEq(badges & nft.BADGE_GOLD(), 0);
        assertEq(badges & nft.BADGE_SILVER(), 0);
        assertEq(badges & nft.BADGE_COPPER(), 0);
    }

    function test_BadgeBug_NotAwardedOnAnHonestSolve() public {
        // The crown must stay unearnable while the optimum holds. Exactly
        // optimal is the boundary and the one most likely to be got wrong.
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        uint256 tokenId = uint256(_mockMazeHash(_mockLayout()));

        vm.prank(owner);
        nft.setOptimalMoves(tokenId, 100);

        assertEq(awarder.awardBadges(user, tokenId, 100) & nft.BADGE_BUG(), 0);
        assertEq(awarder.awardBadges(user, tokenId, 100) & nft.BADGE_ROBOT(), nft.BADGE_ROBOT());
        assertEq(awarder.awardBadges(user, tokenId, 140) & nft.BADGE_BUG(), 0);
    }

    function test_BadgeBug_NotAwardedWhenOptimumUnknown() public {
        // With no registered optimum there is no claim to disprove, so an
        // unregistered maze must not hand out the crown for any move count.
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        uint256 tokenId = uint256(_mockMazeHash(_mockLayout()));

        assertEq(awarder.awardBadges(user, tokenId, 1) & nft.BADGE_BUG(), 0);
    }

    function test_BadgeBug_DoesNotCollideWithOtherBadges() public view {
        // Each badge is a distinct bit; a collision would silently award two.
        uint32 others = nft.BADGE_REGISTERED() | nft.BADGE_ROBOT() | nft.BADGE_GOLD()
            | nft.BADGE_SILVER() | nft.BADGE_COPPER() | nft.BADGE_STONE();
        assertEq(nft.BADGE_BUG() & others, 0);
    }

    function test_MintWithProof_AwardsGold() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(owner);
        nft.setBadgeAwarder(address(awarder));
        nft.setOptimalMoves(tokenId, 100);
        vm.stopPrank();

        // 104 < 105 (1.04x) -> GOLD
        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 104, false, _noAttestation());

        (,, uint32 badges,) = nft.stats(tokenId, user);
        assertEq(badges & nft.BADGE_GOLD(), nft.BADGE_GOLD());
        assertEq(badges & nft.BADGE_ROBOT(), 0);
        assertEq(badges & nft.BADGE_SILVER(), 0);
    }

    function test_MintWithProof_AwardsSilver() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(owner);
        nft.setBadgeAwarder(address(awarder));
        nft.setOptimalMoves(tokenId, 100);
        vm.stopPrank();

        // 110 (1.10x) is in [1.05x, 1.15x) -> SILVER
        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 110, false, _noAttestation());

        (,, uint32 badges,) = nft.stats(tokenId, user);
        assertEq(badges & nft.BADGE_SILVER(), nft.BADGE_SILVER());
        assertEq(badges & nft.BADGE_GOLD(), 0);
        assertEq(badges & nft.BADGE_COPPER(), 0);
    }

    function test_MintWithProof_AwardsCopper() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(owner);
        nft.setBadgeAwarder(address(awarder));
        nft.setOptimalMoves(tokenId, 100);
        vm.stopPrank();

        // 120 (1.20x) is in [1.15x, 1.25x) -> COPPER
        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 120, false, _noAttestation());

        (,, uint32 badges,) = nft.stats(tokenId, user);
        assertEq(badges & nft.BADGE_COPPER(), nft.BADGE_COPPER());
        assertEq(badges & nft.BADGE_SILVER(), 0);
    }

    function test_MintWithProof_NoMedalAtOrAboveCopperThreshold() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(owner);
        nft.setBadgeAwarder(address(awarder));
        nft.setOptimalMoves(tokenId, 100);
        vm.stopPrank();

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 125, false, _noAttestation());

        (,, uint32 badges,) = nft.stats(tokenId, user);
        assertEq(badges & nft.BADGE_COPPER(), 0);
        assertEq(badges & nft.BADGE_SILVER(), 0);
        assertEq(badges & nft.BADGE_GOLD(), 0);
    }

    function test_MintWithProof_AwardsStoneAtMaxMoves() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(owner);
        nft.setBadgeAwarder(address(awarder));

        vm.prank(user);
        nft.mintWithProof(
            hex"00", mazeHash, layout, uint16(MazeConstants.MAX_MOVES), false, _noAttestation()
        );

        (,, uint32 badges,) = nft.stats(tokenId, user);
        assertEq(badges & nft.BADGE_STONE(), nft.BADGE_STONE());
    }

    function test_MintWithProof_BadgesAccumulateAcrossSolves() public {
        DefaultBadgeAwarder awarder = new DefaultBadgeAwarder(address(nft));
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(owner);
        nft.setBadgeAwarder(address(awarder));
        nft.setOptimalMoves(tokenId, 100);
        vm.stopPrank();

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 110, false, _noAttestation());
        (,, uint32 b1,) = nft.stats(tokenId, user);
        assertEq(b1, nft.BADGE_SILVER());

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 100, false, _noAttestation());
        (,, uint32 b2,) = nft.stats(tokenId, user);
        assertEq(b2, nft.BADGE_SILVER() | nft.BADGE_ROBOT());

        vm.prank(owner);
        nft.setRegistrarApproved(tokenId, true);
        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 100, false, _noAttestation());
        (,, uint32 b3,) = nft.stats(tokenId, user);
        assertEq(b3, nft.BADGE_SILVER() | nft.BADGE_ROBOT() | nft.BADGE_REGISTERED());
    }

    function test_MintWithProof_NoAwarderConfigured() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 100, false, _noAttestation());

        (,, uint32 badges,) = nft.stats(tokenId, user);
        assertEq(badges, 0);
    }

    // ==================================================
    // On-chain SVG Rendering Tests (ma-6cr.7)
    // ==================================================

    /// @dev Deterministic 4x4 layout (header + 8 packed bytes). We craft it
    ///      directly in canonical layout-bytes form (the same shape the
    ///      caller passes to `mintWithProof`). The renderer uses these
    ///      bytes, so the cell pattern matters; the proof verifier is mocked.
    function _smallMazeLayout() internal pure returns (bytes memory) {
        bytes memory layout = new bytes(20 + 8);
        // Header: width=4, height=4, sx=0, sy=0, robe=(2,1), scepter=(0,2), goal=(3,3)
        uint16[10] memory hdr = [uint16(4), 4, 0, 0, 2, 1, 0, 2, 3, 3];
        for (uint256 i = 0; i < 10; i++) {
            layout[i * 2] = bytes1(uint8(hdr[i] >> 8));
            layout[i * 2 + 1] = bytes1(uint8(hdr[i] & 0xFF));
        }
        // Packed cells (high nibble = even, low = odd; bits = south|east|type[2]):
        //   0xC = south+east walls, Normal
        //   0x9 = south wall, Text
        //   0x6 = east wall, ZkText
        //   0x3 = no walls, CrownText
        uint8[8] memory cells = [0xC9, 0x63, 0xC0, 0x49, 0xCC, 0x33, 0xC9, 0x66];
        for (uint256 i = 0; i < 8; i++) {
            layout[20 + i] = bytes1(cells[i]);
        }
        return layout;
    }

    function test_MintStoresLayout() public {
        bytes memory layout = _smallMazeLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 50, false, _noAttestation());

        bytes memory stored = nft.layouts(tokenId);
        assertEq(stored.length, 28);

        assertEq(uint8(stored[0]), 0);
        assertEq(uint8(stored[1]), 4);
        assertEq(uint8(stored[2]), 0);
        assertEq(uint8(stored[3]), 4);

        assertEq(uint8(stored[20]), 0xC9);
    }

    function test_MintLayoutWrittenOnce() public {
        bytes memory layout = _smallMazeLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 50, false, _noAttestation());
        bytes memory firstLayout = nft.layouts(tokenId);

        address user2 = address(0x2222);
        vm.prank(user2);
        nft.mintWithProof(hex"00", mazeHash, layout, 60, false, _noAttestation());
        bytes memory secondLayout = nft.layouts(tokenId);

        assertEq(firstLayout.length, secondLayout.length);
        assertEq(keccak256(firstLayout), keccak256(secondLayout));
    }

    function test_RevertSetLayoutWithoutRole() public {
        vm.prank(user);
        vm.expectRevert();
        nft.setLayout(1, _smallMazeLayout());
    }

    function test_SetLayoutStoresAndEmits() public {
        bytes memory layout = _smallMazeLayout();
        uint256 tokenId = 42;

        vm.expectEmit(true, false, false, true);
        emit MazeKingNFT.LayoutStored(tokenId, layout.length);
        vm.prank(owner);
        nft.setLayout(tokenId, layout);

        assertEq(keccak256(nft.layouts(tokenId)), keccak256(layout));
    }

    function test_SetLayoutOverwrites() public {
        bytes memory griefed = hex"deadbeef";
        bytes memory canonical = _smallMazeLayout();
        uint256 tokenId = 99;

        vm.startPrank(owner);
        nft.setLayout(tokenId, griefed);
        assertEq(keccak256(nft.layouts(tokenId)), keccak256(griefed));

        nft.setLayout(tokenId, canonical);
        vm.stopPrank();

        assertEq(keccak256(nft.layouts(tokenId)), keccak256(canonical));
    }

    /// @notice Registered-maze path: registrar pre-stores the canonical layout,
    ///         minter omits the layout (empty), and the vetted layout is what renders.
    function test_SetLayoutThenMintEmptyRendersSetLayout() public {
        MazeRenderer rendererContract = new MazeRenderer();
        bytes memory layout = _smallMazeLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.startPrank(owner);
        nft.setRenderer(address(rendererContract));
        nft.setLayout(tokenId, layout);
        vm.stopPrank();

        // Minter passes an empty layout; the pre-stored layout must survive.
        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, "", 50, false, _noAttestation());

        assertEq(keccak256(nft.layouts(tokenId)), keccak256(layout));

        string memory expected = rendererContract.renderSvg(tokenId, layout);
        string memory actual = rendererContract.renderSvg(tokenId, nft.layouts(tokenId));
        assertEq(keccak256(bytes(actual)), keccak256(bytes(expected)));
    }

    function test_UriFallsBackWithoutRenderer() public {
        bytes memory layout = _smallMazeLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 50, false, _noAttestation());

        assertEq(nft.uri(tokenId), "https://api.mazeking.xyz/token/");
    }

    function test_UriRendersOnChainSVG() public {
        MazeRenderer rendererContract = new MazeRenderer();

        vm.prank(owner);
        nft.setRenderer(address(rendererContract));

        bytes memory layout = _smallMazeLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 50, false, _noAttestation());

        string memory tokenUri = nft.uri(tokenId);
        bytes memory uriBytes = bytes(tokenUri);

        assertGt(uriBytes.length, 100);
        bytes memory prefix = bytes("data:application/json;base64,");
        for (uint256 i = 0; i < prefix.length; i++) {
            assertEq(uriBytes[i], prefix[i], "tokenURI prefix mismatch");
        }
    }

    function test_RendererRenderSvgContainsExpectedShape() public {
        MazeRenderer rendererContract = new MazeRenderer();
        bytes memory layout = _smallMazeLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layout, 50, false, _noAttestation());
        bytes memory storedLayout = nft.layouts(tokenId);

        string memory svg = rendererContract.renderSvg(tokenId, storedLayout);
        bytes memory s = bytes(svg);

        // Must start with <svg ...
        assertTrue(s.length > 100);
        assertEq(s[0], "<");
        assertEq(s[1], "s");
        assertEq(s[2], "v");
        assertEq(s[3], "g");

        // Must end with </svg>
        bytes memory closing = bytes("</svg>");
        for (uint256 i = 0; i < closing.length; i++) {
            assertEq(s[s.length - closing.length + i], closing[i], "missing svg close");
        }

        // viewBox dimensions are width*16 = 64 by height*16 = 64.
        assertTrue(_contains(svg, "viewBox=\"0 0 64 64\""));
        // The wall group should be present.
        assertTrue(_contains(svg, "<g stroke="));
        // Text-cell fills should appear in the SVG (cellType 1/2/3 produce rects).
        assertTrue(_contains(svg, "<rect x="));
        // Entity overlays (player/robe/scepter/goal) intentionally NOT rendered:
        // the SVG is the static maze structure, not a snapshot of mid-game state.
        assertFalse(_contains(svg, "<circle"));
    }

    function test_SetRenderer() public {
        MazeRenderer r = new MazeRenderer();
        vm.prank(owner);
        nft.setRenderer(address(r));
        assertEq(nft.renderer(), address(r));
    }

    function test_RevertSetRendererWithoutRole() public {
        MazeRenderer r = new MazeRenderer();
        vm.prank(user);
        vm.expectRevert();
        nft.setRenderer(address(r));
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (h.length < n.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    // ==================================================
    // Podium (top three solves per maze)
    // ==================================================

    function _solve(address who, bytes32 mazeHash, bytes memory layout, uint16 moves) internal {
        vm.prank(who);
        nft.mintWithProof(hex"00", mazeHash, layout, moves, false, _noAttestation());
    }

    function test_Podium_RanksBestFirst() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        _solve(address(0xA1), mazeHash, layout, 120);
        _solve(address(0xB2), mazeHash, layout, 90);
        _solve(address(0xC3), mazeHash, layout, 105);

        MazeKingNFT.Score[3] memory board = nft.podium(uint256(mazeHash));
        assertEq(board[0].solver, address(0xB2));
        assertEq(board[1].solver, address(0xC3));
        assertEq(board[2].solver, address(0xA1));
        assertEq(board[0].moveCount, 90);
    }

    function test_Podium_TieGoesToWhoeverArrivedFirst() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        _solve(address(0xA1), mazeHash, layout, 100);
        vm.warp(block.timestamp + 60);
        _solve(address(0xB2), mazeHash, layout, 100);

        MazeKingNFT.Score[3] memory board = nft.podium(uint256(mazeHash));
        // Equal scores, so the earlier solve leads. Any other tie-break could
        // be gamed after the fact by whoever moves last.
        assertEq(board[0].solver, address(0xA1));
        assertEq(board[1].solver, address(0xB2));
    }

    function test_Podium_HoldsOnlyTheBestThree() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        _solve(address(0xA1), mazeHash, layout, 100);
        _solve(address(0xB2), mazeHash, layout, 110);
        _solve(address(0xC3), mazeHash, layout, 120);
        _solve(address(0xD4), mazeHash, layout, 95);

        MazeKingNFT.Score[3] memory board = nft.podium(uint256(mazeHash));
        assertEq(board[0].solver, address(0xD4));
        assertEq(board[2].solver, address(0xB2));
        // The worst solve was pushed off entirely.
        for (uint256 i = 0; i < 3; i++) {
            assertTrue(board[i].solver != address(0xC3));
        }
    }

    function test_Podium_OneSlotPerSolver() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        // Without this rule one person grinding a maze fills all three slots
        // and it stops being a leaderboard.
        _solve(address(0xA1), mazeHash, layout, 100);
        _solve(address(0xA1), mazeHash, layout, 95);
        _solve(address(0xA1), mazeHash, layout, 90);

        MazeKingNFT.Score[3] memory board = nft.podium(uint256(mazeHash));
        assertEq(board[0].solver, address(0xA1));
        assertEq(board[0].moveCount, 90);
        assertEq(board[1].solver, address(0));
        assertEq(board[2].solver, address(0));
    }

    function test_Podium_AWorseRepeatDoesNotDemoteYourOwnBest() public {
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);

        _solve(address(0xA1), mazeHash, layout, 90);
        _solve(address(0xA1), mazeHash, layout, 150);

        MazeKingNFT.Score[3] memory board = nft.podium(uint256(mazeHash));
        assertEq(board[0].moveCount, 90);
    }

    function test_Podium_EmptyBeforeAnyoneSolves() public view {
        MazeKingNFT.Score[3] memory board = nft.podium(uint256(bytes32(uint256(1))));
        for (uint256 i = 0; i < 3; i++) {
            assertEq(board[i].solver, address(0));
        }
    }

    // ==================================================
    // The attestation binds the seed to the maze
    // ==================================================

    function test_Attestation_BindsTheSeedToTheMaze() public {
        // Without this there is no on-chain path from a name to a maze: the
        // token id is a Pedersen hash computed off chain, so a resolver handed
        // a label has nothing to look it up by.
        _grantRegistrar(REGISTRAR_PK);
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        bytes memory sig = _attest(mazeHash, layout, 77, REGISTRAR_PK);

        vm.prank(address(0xFEE1));
        nft.registerWithAttestation(
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 77, signature: sig }),
            mazeHash,
            layout
        );

        assertEq(nft.officialMazes(keccak256(bytes(SEED))), uint256(mazeHash));
    }

    function test_Attestation_RejectsASwappedSeed() public {
        // The seed is inside the signed statement, so claiming a different name
        // for the same maze must not verify.
        _grantRegistrar(REGISTRAR_PK);
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        bytes memory sig = _attest(mazeHash, layout, 77, REGISTRAR_PK);

        vm.expectRevert();
        nft.registerWithAttestation(
            MazeKingNFT.MazeAttestation({
                seed: "some-other-name", optimalMoves: 77, signature: sig
            }),
            mazeHash,
            layout
        );
    }

    function test_Attestation_SeedBindingIsIdempotent() public {
        _grantRegistrar(REGISTRAR_PK);
        bytes memory layout = _mockLayout();
        bytes32 mazeHash = _mockMazeHash(layout);
        bytes memory sig = _attest(mazeHash, layout, 77, REGISTRAR_PK);
        MazeKingNFT.MazeAttestation memory att =
            MazeKingNFT.MazeAttestation({ seed: SEED, optimalMoves: 77, signature: sig });

        nft.registerWithAttestation(att, mazeHash, layout);
        // registerMaze reverts on a second registration; re-attesting must not.
        nft.registerWithAttestation(att, mazeHash, layout);

        assertEq(nft.officialMazes(keccak256(bytes(SEED))), uint256(mazeHash));
    }
}
