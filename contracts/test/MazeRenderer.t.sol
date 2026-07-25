// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MazeRenderer } from "../src/MazeRenderer.sol";
import { MazeKingNFT } from "../src/MazeKingNFT.sol";
import { MazeConstants } from "../src/MazeConstants.sol";

/// @dev Always-pass verifier. The renderer itself is verifier-independent;
///      this exists so the mismatched-layout test can drive a real mint.
contract MockVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev Test harness exposing internal MazeRenderer functions. Fields beyond
///      width/height (entity positions) are not rendered (ma-e7r), so off-by-
///      one drift in those fields can't be detected via SVG output alone —
///      the harness lets us assert per-field round-trip directly.
contract MazeRendererHarness is MazeRenderer {
    function decodeHeader(bytes calldata layout) external pure returns (Header memory) {
        return _decodeHeader(layout);
    }

    function readU16(bytes calldata layout, uint256 offset) external pure returns (uint16) {
        return _readU16(layout, offset);
    }

    function cellAt(bytes calldata layout, uint256 idx) external pure returns (uint8) {
        return _cellAt(layout, idx);
    }
}

/// @title MazeRendererTest
/// @notice Foundry tests for `MazeRenderer.sol` (ma-vzm). Locks:
///   - golden SVG output for canonical fixtures (drift detector for any
///     bytecode change to the renderer)
///   - per-field header round-trip (decoder agrees with the canonical TS
///     `serializeLayoutBytes` byte order — a 1-byte off-by-one in
///     `_decodeHeader` would silently break every mint's image)
///   - off-by-one regressions at boundary byte values in each header position
///   - documented "mismatched layout still mints, renderer reflects stored
///     layout" behavior — regression-only, do NOT change behavior
contract MazeRendererTest is Test {
    MazeRenderer internal renderer;
    MazeRendererHarness internal harness;

    function setUp() public {
        renderer = new MazeRenderer();
        harness = new MazeRendererHarness();
    }

    // -----------------------------------------------------------------
    // Layout-bytes helpers (mirror `serializeLayoutBytes` in tokenId.ts).
    //
    // Canonical layout format (also documented in MazeRenderer.sol):
    //   bytes[ 0..20] = 10 BE u16: width, height, startX, startY, robeX,
    //                              robeY, scepterX, scepterY, goalX, goalY
    //   bytes[20..]   = packed_cells: ceil(width*height/2) bytes
    //                  high nibble = even cell idx, low = odd
    //                  within a nibble: bit3 south wall, bit2 east wall,
    //                  bits1-0 cell type (0=Normal,1=Text,2=ZkText,3=CrownText)
    // -----------------------------------------------------------------

    struct HeaderInput {
        uint16 width;
        uint16 height;
        uint16 startX;
        uint16 startY;
        uint16 robeX;
        uint16 robeY;
        uint16 scepterX;
        uint16 scepterY;
        uint16 goalX;
        uint16 goalY;
    }

    function _writeU16(bytes memory out, uint256 offset, uint16 value) internal pure {
        out[offset] = bytes1(uint8(value >> 8));
        out[offset + 1] = bytes1(uint8(value & 0xFF));
    }

    function _writeHeader(bytes memory out, HeaderInput memory h) internal pure {
        _writeU16(out, 0, h.width);
        _writeU16(out, 2, h.height);
        _writeU16(out, 4, h.startX);
        _writeU16(out, 6, h.startY);
        _writeU16(out, 8, h.robeX);
        _writeU16(out, 10, h.robeY);
        _writeU16(out, 12, h.scepterX);
        _writeU16(out, 14, h.scepterY);
        _writeU16(out, 16, h.goalX);
        _writeU16(out, 18, h.goalY);
    }

    function _buildLayout(HeaderInput memory h, bytes memory packedCells)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory layout = new bytes(20 + packedCells.length);
        _writeHeader(layout, h);
        for (uint256 i = 0; i < packedCells.length; i++) {
            layout[20 + i] = packedCells[i];
        }
        return layout;
    }

    /// @dev Build a TS-style canonical layout: the same bytes the TS encoder
    ///      emits — header + packed cells, zero-padded to LAYOUT_TOTAL_BYTES.
    function _buildPaddedLayout(HeaderInput memory h, bytes memory packedCells)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory layout = new bytes(MazeConstants.LAYOUT_TOTAL_BYTES);
        _writeHeader(layout, h);
        for (uint256 i = 0; i < packedCells.length && i < MazeConstants.MAX_PACKED_BYTES; i++) {
            layout[20 + i] = packedCells[i];
        }
        return layout;
    }

    // -----------------------------------------------------------------
    // Canonical fixtures
    // -----------------------------------------------------------------

    /// @dev Fixture 1: 2x2 maze, all Normal cells, no walls. Smallest valid
    ///      layout — exercises the renderer's empty-walls / empty-fills path.
    function _fixtureMinimal() internal pure returns (bytes memory) {
        HeaderInput memory h = HeaderInput({
            width: 2,
            height: 2,
            startX: 0,
            startY: 0,
            robeX: 1,
            robeY: 0,
            scepterX: 0,
            scepterY: 1,
            goalX: 1,
            goalY: 1
        });
        bytes memory cells = new bytes(2);
        cells[0] = 0x00;
        cells[1] = 0x00;
        return _buildLayout(h, cells);
    }

    /// @dev Fixture 2: 4x4 maze with all four cell types and both wall
    ///      directions present. Same packed pattern as `_smallMazeLayout` in
    ///      MazeKingNFT.t.sol so we don't drift on shared truth.
    function _fixtureAverage() internal pure returns (bytes memory) {
        HeaderInput memory h = HeaderInput({
            width: 4,
            height: 4,
            startX: 0,
            startY: 0,
            robeX: 2,
            robeY: 1,
            scepterX: 0,
            scepterY: 2,
            goalX: 3,
            goalY: 3
        });
        bytes memory cells = new bytes(8);
        cells[0] = 0xC9;
        cells[1] = 0x63;
        cells[2] = 0xC0;
        cells[3] = 0x49;
        cells[4] = 0xCC;
        cells[5] = 0x33;
        cells[6] = 0xC9;
        cells[7] = 0x66;
        return _buildLayout(h, cells);
    }

    /// @dev Fixture 3: 8x8 maze. Cells cycle through all 4 types and all 4
    ///      wall-bit combos so every render path is exercised at scale; still
    ///      small enough to keep the golden string readable in this file.
    function _fixtureMaxCell() internal pure returns (bytes memory) {
        HeaderInput memory h = HeaderInput({
            width: 8,
            height: 8,
            startX: 0,
            startY: 0,
            robeX: 4,
            robeY: 4,
            scepterX: 7,
            scepterY: 0,
            goalX: 7,
            goalY: 7
        });
        // 64 cells -> 32 packed bytes. Pattern cycles 0x00, 0x05, 0xAA, 0xFF
        // across packed bytes (= cells [0,0], [0,5], [A,A], [F,F]) — gives
        // every cell-type and wall-combo, plus south-wall + east-wall coverage
        // on the bottom row and right column for the wrap-edge code paths.
        bytes memory cells = new bytes(32);
        bytes1[4] memory pat = [bytes1(0x00), bytes1(0x05), bytes1(0xAA), bytes1(0xFF)];
        for (uint256 i = 0; i < 32; i++) {
            cells[i] = pat[i % 4];
        }
        return _buildLayout(h, cells);
    }

    // -----------------------------------------------------------------
    // Golden SVG tests (≥3 fixtures, full SVG locked)
    // -----------------------------------------------------------------

    function test_GoldenSvg_Minimal2x2() public view {
        string memory svg = renderer.renderSvg(1, _fixtureMinimal());
        // 2x2, no walls, no non-Normal cells. tokenId=1 -> baseHue=1.
        // wall=hsl(1,25%,22%); mazeBg=hsl(31,22%,80%) (baseHue+30).
        string memory expected = string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">',
                '<rect width="100%" height="100%" fill="hsl(31,22%,80%)"/>',
                '<g stroke="hsl(1,25%,22%)" stroke-width="2" stroke-linecap="square">',
                "</g></svg>"
            )
        );
        assertEq(svg, expected, "minimal 2x2 SVG drift");
    }

    function test_GoldenSvg_Average4x4() public view {
        string memory svg = renderer.renderSvg(0xCAFE, _fixtureAverage());
        // tokenId=0xCAFE -> baseHue=126. Mixed cell types and walls.
        // Output captured from a clean run; regenerate by replacing the
        // string and observing the assertEq diff if the renderer changes.
        string memory expected = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">'
            '<rect width="100%" height="100%" fill="hsl(156,22%,80%)"/>'
            '<rect x="16" y="0" width="16" height="16" fill="hsl(326,80%,60%)"/>'
            '<rect x="32" y="0" width="16" height="16" fill="hsl(86,80%,55%)"/>'
            '<rect x="48" y="0" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="16" width="16" height="16" fill="hsl(326,80%,60%)"/>'
            '<rect x="32" y="32" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="32" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="16" y="48" width="16" height="16" fill="hsl(326,80%,60%)"/>'
            '<rect x="32" y="48" width="16" height="16" fill="hsl(86,80%,55%)"/>'
            '<rect x="48" y="48" width="16" height="16" fill="hsl(86,80%,55%)"/>'
            '<g stroke="hsl(126,25%,22%)" stroke-width="2" stroke-linecap="square">'
            '<line x1="0" y1="16" x2="16" y2="16"/>' '<line x1="16" y1="0" x2="16" y2="16"/>'
            '<line x1="16" y1="16" x2="32" y2="16"/>' '<line x1="48" y1="0" x2="48" y2="16"/>'
            '<line x1="0" y1="32" x2="16" y2="32"/>' '<line x1="16" y1="16" x2="16" y2="32"/>'
            '<line x1="48" y1="16" x2="48" y2="32"/>' '<line x1="48" y1="32" x2="64" y2="32"/>'
            '<line x1="0" y1="48" x2="16" y2="48"/>' '<line x1="16" y1="32" x2="16" y2="48"/>'
            '<line x1="16" y1="48" x2="32" y2="48"/>' '<line x1="32" y1="32" x2="32" y2="48"/>'
            '<line x1="0" y1="64" x2="16" y2="64"/>' '<line x1="16" y1="48" x2="16" y2="64"/>'
            '<line x1="16" y1="64" x2="32" y2="64"/>' '<line x1="48" y1="48" x2="48" y2="64"/>'
            '<line x1="64" y1="48" x2="64" y2="64"/>' '<line x1="0" y1="0" x2="16" y2="0"/>'
            '<line x1="16" y1="0" x2="32" y2="0"/>' '<line x1="0" y1="48" x2="0" y2="64"/>'
            "</g></svg>";
        assertEq(svg, expected, "average 4x4 SVG drift");
    }

    function test_GoldenSvg_MaxCell8x8() public view {
        string memory svg = renderer.renderSvg(100, _fixtureMaxCell());
        // tokenId=100 -> baseHue=100. Cell pattern cycles 4 packed bytes.
        // Captured from a clean run.
        string memory expected = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" shape-rendering="crispEdges">'
            '<rect width="100%" height="100%" fill="hsl(130,22%,80%)"/>'
            '<rect x="48" y="0" width="16" height="16" fill="hsl(300,80%,60%)"/>'
            '<rect x="64" y="0" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="80" y="0" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="96" y="0" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="112" y="0" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="16" width="16" height="16" fill="hsl(300,80%,60%)"/>'
            '<rect x="64" y="16" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="80" y="16" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="96" y="16" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="112" y="16" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="32" width="16" height="16" fill="hsl(300,80%,60%)"/>'
            '<rect x="64" y="32" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="80" y="32" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="96" y="32" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="112" y="32" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="48" width="16" height="16" fill="hsl(300,80%,60%)"/>'
            '<rect x="64" y="48" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="80" y="48" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="96" y="48" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="112" y="48" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="64" width="16" height="16" fill="hsl(300,80%,60%)"/>'
            '<rect x="64" y="64" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="80" y="64" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="96" y="64" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="112" y="64" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="80" width="16" height="16" fill="hsl(300,80%,60%)"/>'
            '<rect x="64" y="80" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="80" y="80" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="96" y="80" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="112" y="80" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="96" width="16" height="16" fill="hsl(300,80%,60%)"/>'
            '<rect x="64" y="96" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="80" y="96" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="96" y="96" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="112" y="96" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="48" y="112" width="16" height="16" fill="hsl(300,80%,60%)"/>'
            '<rect x="64" y="112" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="80" y="112" width="16" height="16" fill="hsl(60,80%,55%)"/>'
            '<rect x="96" y="112" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<rect x="112" y="112" width="16" height="16" fill="hsl(48,85%,55%)"/>'
            '<g stroke="hsl(100,25%,22%)" stroke-width="2" stroke-linecap="square">'
            '<line x1="64" y1="0" x2="64" y2="16"/>' '<line x1="64" y1="16" x2="80" y2="16"/>'
            '<line x1="80" y1="16" x2="96" y2="16"/>' '<line x1="96" y1="16" x2="112" y2="16"/>'
            '<line x1="112" y1="0" x2="112" y2="16"/>' '<line x1="112" y1="16" x2="128" y2="16"/>'
            '<line x1="128" y1="0" x2="128" y2="16"/>' '<line x1="64" y1="16" x2="64" y2="32"/>'
            '<line x1="64" y1="32" x2="80" y2="32"/>' '<line x1="80" y1="32" x2="96" y2="32"/>'
            '<line x1="96" y1="32" x2="112" y2="32"/>' '<line x1="112" y1="16" x2="112" y2="32"/>'
            '<line x1="112" y1="32" x2="128" y2="32"/>' '<line x1="128" y1="16" x2="128" y2="32"/>'
            '<line x1="64" y1="32" x2="64" y2="48"/>' '<line x1="64" y1="48" x2="80" y2="48"/>'
            '<line x1="80" y1="48" x2="96" y2="48"/>' '<line x1="96" y1="48" x2="112" y2="48"/>'
            '<line x1="112" y1="32" x2="112" y2="48"/>' '<line x1="112" y1="48" x2="128" y2="48"/>'
            '<line x1="128" y1="32" x2="128" y2="48"/>' '<line x1="64" y1="48" x2="64" y2="64"/>'
            '<line x1="64" y1="64" x2="80" y2="64"/>' '<line x1="80" y1="64" x2="96" y2="64"/>'
            '<line x1="96" y1="64" x2="112" y2="64"/>' '<line x1="112" y1="48" x2="112" y2="64"/>'
            '<line x1="112" y1="64" x2="128" y2="64"/>' '<line x1="128" y1="48" x2="128" y2="64"/>'
            '<line x1="64" y1="64" x2="64" y2="80"/>' '<line x1="64" y1="80" x2="80" y2="80"/>'
            '<line x1="80" y1="80" x2="96" y2="80"/>' '<line x1="96" y1="80" x2="112" y2="80"/>'
            '<line x1="112" y1="64" x2="112" y2="80"/>' '<line x1="112" y1="80" x2="128" y2="80"/>'
            '<line x1="128" y1="64" x2="128" y2="80"/>' '<line x1="64" y1="80" x2="64" y2="96"/>'
            '<line x1="64" y1="96" x2="80" y2="96"/>' '<line x1="80" y1="96" x2="96" y2="96"/>'
            '<line x1="96" y1="96" x2="112" y2="96"/>' '<line x1="112" y1="80" x2="112" y2="96"/>'
            '<line x1="112" y1="96" x2="128" y2="96"/>' '<line x1="128" y1="80" x2="128" y2="96"/>'
            '<line x1="64" y1="96" x2="64" y2="112"/>' '<line x1="64" y1="112" x2="80" y2="112"/>'
            '<line x1="80" y1="112" x2="96" y2="112"/>' '<line x1="96" y1="112" x2="112" y2="112"/>'
            '<line x1="112" y1="96" x2="112" y2="112"/>'
            '<line x1="112" y1="112" x2="128" y2="112"/>'
            '<line x1="128" y1="96" x2="128" y2="112"/>' '<line x1="64" y1="112" x2="64" y2="128"/>'
            '<line x1="64" y1="128" x2="80" y2="128"/>' '<line x1="80" y1="128" x2="96" y2="128"/>'
            '<line x1="96" y1="128" x2="112" y2="128"/>'
            '<line x1="112" y1="112" x2="112" y2="128"/>'
            '<line x1="112" y1="128" x2="128" y2="128"/>'
            '<line x1="128" y1="112" x2="128" y2="128"/>' '<line x1="64" y1="0" x2="80" y2="0"/>'
            '<line x1="80" y1="0" x2="96" y2="0"/>' '<line x1="96" y1="0" x2="112" y2="0"/>'
            '<line x1="112" y1="0" x2="128" y2="0"/>' '<line x1="0" y1="0" x2="0" y2="16"/>'
            '<line x1="0" y1="16" x2="0" y2="32"/>' '<line x1="0" y1="32" x2="0" y2="48"/>'
            '<line x1="0" y1="48" x2="0" y2="64"/>' '<line x1="0" y1="64" x2="0" y2="80"/>'
            '<line x1="0" y1="80" x2="0" y2="96"/>' '<line x1="0" y1="96" x2="0" y2="112"/>'
            '<line x1="0" y1="112" x2="0" y2="128"/>' "</g></svg>";
        assertEq(svg, expected, "max-cell 8x8 SVG drift");
    }

    /// @dev Lock the full tokenURI base64 wrapping for the minimal fixture.
    ///      The SVG goldens above cover renderer drift; this one catches
    ///      drift in the JSON envelope (name / description / image keys).
    function test_GoldenTokenUri_Minimal2x2() public view {
        string memory uri = renderer.tokenURI(1, _fixtureMinimal());
        string memory expected = "data:application/json;base64,"
            "eyJuYW1lIjoiTWF6ZUtpbmcgIzB4MDAwMDAwMDAiLCJkZXNjcmlwdGlvbiI6Ik9u"
            "LWNoYWluIFNWRyBtYXplIHJlbmRlcmVkIGZyb20gYSBaSy12ZXJpZmllZCBsYXlv"
            "dXQuIDJ4MiBncmlkLiIsImltYWdlIjoiZGF0YTppbWFnZS9zdmcreG1sO2Jhc2U2"
            "NCxQSE4yWnlCNGJXeHVjejBpYUhSMGNEb3ZMM2QzZHk1M015NXZjbWN2TWpBd01D"
            "OXpkbWNpSUhacFpYZENiM2c5SWpBZ01DQXpNaUF6TWlJZ2MyaGhjR1V0Y21WdVpH"
            "VnlhVzVuUFNKamNtbHpjRVZrWjJWeklqNDhjbVZqZENCM2FXUjBhRDBpTVRBd0pT"
            "SWdhR1ZwWjJoMFBTSXhNREFsSWlCbWFXeHNQU0pvYzJ3b016RXNNaklsTERnd0pT"
            "a2lMejQ4WnlCemRISnZhMlU5SW1oemJDZ3hMREkxSlN3eU1pVXBJaUJ6ZEhKdmEy"
            "VXRkMmxrZEdnOUlqSWlJSE4wY205clpTMXNhVzVsWTJGd1BTSnpjWFZoY21VaVBq"
            "d3ZaejQ4TDNOMlp6ND0ifQ==";
        assertEq(uri, expected, "minimal tokenURI drift");
    }

    /// @dev TS-encoded layouts are 1520 bytes (zero-padded). The renderer
    ///      should ignore the trailing zero pad — output must match the
    ///      unpadded layout byte-for-byte.
    function test_PaddedLayoutMatchesUnpadded() public view {
        HeaderInput memory h = HeaderInput({
            width: 4,
            height: 4,
            startX: 0,
            startY: 0,
            robeX: 2,
            robeY: 1,
            scepterX: 0,
            scepterY: 2,
            goalX: 3,
            goalY: 3
        });
        bytes memory cells = new bytes(8);
        cells[0] = 0xC9;
        cells[1] = 0x63;
        cells[2] = 0xC0;
        cells[3] = 0x49;
        cells[4] = 0xCC;
        cells[5] = 0x33;
        cells[6] = 0xC9;
        cells[7] = 0x66;

        string memory svgUnpadded = renderer.renderSvg(7, _buildLayout(h, cells));
        string memory svgPadded = renderer.renderSvg(7, _buildPaddedLayout(h, cells));
        assertEq(svgPadded, svgUnpadded, "padded layout SVG must match unpadded");
    }

    // -----------------------------------------------------------------
    // Header round-trip: per-field encode/decode integrity
    // -----------------------------------------------------------------

    /// @dev Each header field at its own non-zero value -> harness returns
    ///      exact-decoded values. Catches off-by-one in the field offsets.
    function test_HeaderRoundTrip_AllFieldsDistinct() public view {
        HeaderInput memory h = HeaderInput({
            width: 7,
            height: 11,
            startX: 13,
            startY: 17,
            robeX: 19,
            robeY: 23,
            scepterX: 29,
            scepterY: 31,
            goalX: 37,
            goalY: 41
        });
        bytes memory cells = new bytes((uint256(h.width) * uint256(h.height) + 1) / 2);
        bytes memory layout = _buildLayout(h, cells);

        MazeRenderer.Header memory got = harness.decodeHeader(layout);
        assertEq(got.width, h.width, "width");
        assertEq(got.height, h.height, "height");
        assertEq(got.startX, h.startX, "startX");
        assertEq(got.startY, h.startY, "startY");
        assertEq(got.robeX, h.robeX, "robeX");
        assertEq(got.robeY, h.robeY, "robeY");
        assertEq(got.scepterX, h.scepterX, "scepterX");
        assertEq(got.scepterY, h.scepterY, "scepterY");
        assertEq(got.goalX, h.goalX, "goalX");
        assertEq(got.goalY, h.goalY, "goalY");
    }

    /// @dev Each field maxed individually (uint16 max = 0xFFFF) while the
    ///      others stay nominal. Catches sign-extension or shift bugs in
    ///      `_readU16`.
    function test_HeaderRoundTrip_FieldsMaxedIndividually() public view {
        HeaderInput memory base = HeaderInput({
            width: 5,
            height: 5,
            startX: 1,
            startY: 1,
            robeX: 2,
            robeY: 2,
            scepterX: 3,
            scepterY: 3,
            goalX: 4,
            goalY: 4
        });
        // We only need a layout long enough for the header; renderSvg is not
        // called here so the cell count doesn't have to satisfy the require.
        bytes memory cells = new bytes(13);

        // Skip width/height — `_decodeHeader` requires them > 0 and the layout
        // length matches `width * height`. Setting either to 0xFFFF would
        // demand a 2GB+ layout. We test those separately via SVG.
        for (uint256 i = 2; i < 10; i++) {
            HeaderInput memory h = base;
            uint16 maxed = type(uint16).max;
            if (i == 2) h.startX = maxed;
            else if (i == 3) h.startY = maxed;
            else if (i == 4) h.robeX = maxed;
            else if (i == 5) h.robeY = maxed;
            else if (i == 6) h.scepterX = maxed;
            else if (i == 7) h.scepterY = maxed;
            else if (i == 8) h.goalX = maxed;
            else if (i == 9) h.goalY = maxed;

            MazeRenderer.Header memory got = harness.decodeHeader(_buildLayout(h, cells));
            uint16 expected = maxed;
            uint16 actual;
            if (i == 2) actual = got.startX;
            else if (i == 3) actual = got.startY;
            else if (i == 4) actual = got.robeX;
            else if (i == 5) actual = got.robeY;
            else if (i == 6) actual = got.scepterX;
            else if (i == 7) actual = got.scepterY;
            else if (i == 8) actual = got.goalX;
            else actual = got.goalY;
            assertEq(actual, expected, "maxed field decoded incorrectly");

            // Other fields must stay at base values.
            assertEq(got.width, base.width, "width drifted");
            assertEq(got.height, base.height, "height drifted");
        }
    }

    /// @dev width=30 / height=30 (the boundary called out in the bead) decodes
    ///      correctly and renderSvg succeeds end-to-end.
    function test_HeaderRoundTrip_BoundaryWidthHeight() public view {
        HeaderInput memory h = HeaderInput({
            width: 30,
            height: 30,
            startX: 0,
            startY: 0,
            robeX: 15,
            robeY: 15,
            scepterX: 29,
            scepterY: 0,
            goalX: 29,
            goalY: 29
        });
        // 900 cells -> 450 packed bytes.
        bytes memory cells = new bytes(450);
        // Set a few non-zero cells to engage every render path.
        cells[0] = 0xCC;
        cells[100] = 0x55;
        cells[200] = 0xAA;
        cells[449] = 0xFF;

        bytes memory layout = _buildLayout(h, cells);
        MazeRenderer.Header memory got = harness.decodeHeader(layout);
        assertEq(got.width, 30, "width @ boundary");
        assertEq(got.height, 30, "height @ boundary");

        string memory svg = renderer.renderSvg(42, layout);
        // viewBox = 30*16 by 30*16 = 480x480
        assertTrue(_contains(svg, 'viewBox="0 0 480 480"'), "boundary viewBox");
        assertTrue(_contains(svg, "<svg"), "svg open");
        assertTrue(_contains(svg, "</svg>"), "svg close");
    }

    /// @dev Off-by-one regression. For every header byte position (20 of them)
    ///      and every boundary value in {0, 1, 0xFE, 0xFF}, set that single
    ///      byte and confirm the affected field's decoded uint16 equals the
    ///      expected high*256 + low value.
    function test_HeaderOffByOne_BoundaryBytes() public view {
        // Base: nominal layout long enough for a 5x5 cell grid; we mutate one
        // header byte at a time. width and height bytes are skipped (0 width
        // or 0 height triggers `Empty maze` revert in _decodeHeader, which is
        // tested separately).
        bytes memory base = new bytes(20 + 13);
        HeaderInput memory baseH = HeaderInput({
            width: 5,
            height: 5,
            startX: 0x10,
            startY: 0x20,
            robeX: 0x30,
            robeY: 0x40,
            scepterX: 0x50,
            scepterY: 0x60,
            goalX: 0x70,
            goalY: 0x80
        });
        _writeHeader(base, baseH);

        uint8[4] memory boundary = [uint8(0), 1, 0xFE, 0xFF];

        // Skip bytes 0-3 (width/height); _decodeHeader rejects zero dims.
        for (uint256 pos = 4; pos < 20; pos++) {
            uint256 fieldIdx = pos / 2;
            uint256 fieldStart = fieldIdx * 2;
            for (uint256 b = 0; b < 4; b++) {
                bytes memory layout = _cloneBytes(base);
                layout[pos] = bytes1(boundary[b]);

                MazeRenderer.Header memory got = harness.decodeHeader(layout);
                uint16 affected = _fieldFromHeader(got, fieldIdx);
                uint8 highByte = uint8(layout[fieldStart]);
                uint8 lowByte = uint8(layout[fieldStart + 1]);
                uint16 expected = (uint16(highByte) << 8) | uint16(lowByte);
                assertEq(affected, expected, "off-by-one drift in header decode");
            }
        }
    }

    // -----------------------------------------------------------------
    // Mismatched-layout regression (documented accepted behavior)
    // -----------------------------------------------------------------

    /// @dev A caller passing a layout whose hash doesn't match the proven
    ///      mazeHash → contract still mints (verifier sees the hash, not the
    ///      layout) → renderer reflects whatever was stored. This locks the
    ///      documented behavior; do NOT change it without coordination.
    function test_MismatchedLayoutMintsAndRendersStoredBytes() public {
        MockVerifier verifier = new MockVerifier();
        address owner = address(0xA11CE);
        address user = address(0xB0B);
        vm.prank(owner);
        MazeKingNFT nft = new MazeKingNFT(
            "MazeKing", "MAZE", "https://api.mazeking.xyz/token/", owner, address(verifier)
        );

        vm.prank(owner);
        nft.setRenderer(address(renderer));

        bytes memory layoutA = _fixtureAverage();
        bytes memory layoutB = _fixtureMinimal();
        // Use hash-of-A as the proven hash, but submit layout B.
        bytes32 mazeHash = keccak256(layoutA);
        uint256 tokenId = uint256(mazeHash);

        vm.prank(user);
        nft.mintWithProof(hex"00", mazeHash, layoutB, 50, false);

        // Mint succeeded.
        assertEq(nft.balanceOf(user, tokenId), 1, "mint should succeed despite mismatch");

        // Stored layout is layoutB (not the canonical layoutA).
        bytes memory stored = nft.layouts(tokenId);
        assertEq(keccak256(stored), keccak256(layoutB), "stored layout = submitted layout");
        assertTrue(keccak256(stored) != keccak256(layoutA), "stored layout != hash-attested layout");

        // Renderer reflects the stored (mismatched) layout. The two SVGs
        // must differ so consumers can audit drift visually.
        string memory svgFromStored = renderer.renderSvg(tokenId, stored);
        string memory svgFromAttested = renderer.renderSvg(tokenId, layoutA);
        assertTrue(
            keccak256(bytes(svgFromStored)) != keccak256(bytes(svgFromAttested)),
            "mismatched layout must render visibly different SVG"
        );
    }

    // -----------------------------------------------------------------
    // Revert / robustness tests
    // -----------------------------------------------------------------

    function test_RevertWhenLayoutTooShort() public {
        bytes memory tooShort = new bytes(19);
        vm.expectRevert(bytes("Layout too short"));
        renderer.renderSvg(1, tooShort);
    }

    function test_RevertWhenWidthZero() public {
        // Header with width=0 - even with rest zero, must revert "Empty maze".
        bytes memory layout = new bytes(20);
        vm.expectRevert(bytes("Empty maze"));
        renderer.renderSvg(1, layout);
    }

    function test_RevertWhenLayoutTruncated() public {
        // 2x2 needs 20 + ceil(4/2) = 22 bytes; provide 21.
        HeaderInput memory h = HeaderInput({
            width: 2,
            height: 2,
            startX: 0,
            startY: 0,
            robeX: 0,
            robeY: 0,
            scepterX: 0,
            scepterY: 0,
            goalX: 0,
            goalY: 0
        });
        bytes memory layout = new bytes(21);
        _writeHeader(layout, h);
        vm.expectRevert(bytes("Layout truncated"));
        renderer.renderSvg(1, layout);
    }

    function test_PaletteDiffersByTokenId() public view {
        bytes memory layout = _fixtureMinimal();
        string memory svgA = renderer.renderSvg(1, layout);
        string memory svgB = renderer.renderSvg(180, layout);
        assertTrue(
            keccak256(bytes(svgA)) != keccak256(bytes(svgB)),
            "different tokenIds must produce different palettes"
        );
    }

    function test_TokenUriHasJsonPrefix() public view {
        string memory uri = renderer.tokenURI(1, _fixtureMinimal());
        bytes memory u = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        assertTrue(u.length > prefix.length, "uri longer than prefix");
        for (uint256 i = 0; i < prefix.length; i++) {
            assertEq(u[i], prefix[i], "tokenURI prefix mismatch");
        }
    }

    // -----------------------------------------------------------------
    // Internal helpers (test-only)
    // -----------------------------------------------------------------

    function _cloneBytes(bytes memory src) internal pure returns (bytes memory) {
        bytes memory out = new bytes(src.length);
        for (uint256 i = 0; i < src.length; i++) {
            out[i] = src[i];
        }
        return out;
    }

    function _fieldFromHeader(MazeRenderer.Header memory h, uint256 fieldIdx)
        internal
        pure
        returns (uint16)
    {
        if (fieldIdx == 0) return h.width;
        if (fieldIdx == 1) return h.height;
        if (fieldIdx == 2) return h.startX;
        if (fieldIdx == 3) return h.startY;
        if (fieldIdx == 4) return h.robeX;
        if (fieldIdx == 5) return h.robeY;
        if (fieldIdx == 6) return h.scepterX;
        if (fieldIdx == 7) return h.scepterY;
        if (fieldIdx == 8) return h.goalX;
        return h.goalY;
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
}
