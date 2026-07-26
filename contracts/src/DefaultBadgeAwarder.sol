// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IBadgeAwarder } from "./IBadgeAwarder.sol";
import { MazeConstants } from "./MazeConstants.sol";

/// @notice Subset of MazeKingNFT used by the default awarder
interface IMazeKingBadgeView {
    function registrarApproved(uint256 tokenId) external view returns (bool);
    function optimalMoves(uint256 tokenId) external view returns (uint32);
    function BADGE_REGISTERED() external view returns (uint32);
    function BADGE_ROBOT() external view returns (uint32);
    function BADGE_GOLD() external view returns (uint32);
    function BADGE_SILVER() external view returns (uint32);
    function BADGE_COPPER() external view returns (uint32);
    function BADGE_STONE() external view returns (uint32);
    function BADGE_BUG() external view returns (uint32);
}

/// @title DefaultBadgeAwarder
/// @notice Ships the 7 basic MazeKing badges:
///         REGISTERED, ROBOT, GOLD, SILVER, COPPER, STONE, BUG
/// @dev Pure-stateless strategy: reads admin-set state from the NFT contract.
///      Replaceable via MazeKingNFT.setBadgeAwarder for future strategies.
contract DefaultBadgeAwarder is IBadgeAwarder {
    IMazeKingBadgeView public immutable nft;

    constructor(address _nft) {
        nft = IMazeKingBadgeView(_nft);
    }

    /// @inheritdoc IBadgeAwarder
    function awardBadges(address, uint256 mazeHash, uint32 moveCount)
        external
        view
        override
        returns (uint32 newBadges)
    {
        if (nft.registrarApproved(mazeHash)) {
            newBadges |= nft.BADGE_REGISTERED();
        }

        uint32 optimal = nft.optimalMoves(mazeHash);
        if (optimal > 0) {
            if (moveCount < optimal) {
                // Unreachable if the optimum is right: it is a breadth-first
                // search over the product graph (x, y, hasRobe, hasScepter),
                // so nothing shorter exists. Reaching this branch means the
                // registrar attested a wrong optimum, and the proof that
                // arrived here is the counterexample. Award the crown rather
                // than silently dropping the solve on the floor -- a mint that
                // disproves our own claim is worth recording, and it used to
                // fall through this function earning nothing at all.
                newBadges |= nft.BADGE_BUG();
            } else if (moveCount == optimal) {
                newBadges |= nft.BADGE_ROBOT();
            } else {
                // Tiered medals — highest tier wins (mutually exclusive).
                // Compare moveCount * 100 against optimal * threshold to avoid
                // fractional math.
                uint256 scaled = uint256(moveCount) * 100;
                uint256 base = uint256(optimal);
                if (scaled < base * 105) {
                    newBadges |= nft.BADGE_GOLD();
                } else if (scaled < base * 115) {
                    newBadges |= nft.BADGE_SILVER();
                } else if (scaled < base * 125) {
                    newBadges |= nft.BADGE_COPPER();
                }
            }
        }

        if (moveCount == MazeConstants.MAX_MOVES) {
            newBadges |= nft.BADGE_STONE();
        }
    }
}
