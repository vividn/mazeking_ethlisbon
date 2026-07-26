// SPDX-License-Identifier: MIT
// solhint-disable-next-line unsafe-cheatcode
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { MazeKingNFT } from "../src/MazeKingNFT.sol";
import { DefaultBadgeAwarder } from "../src/DefaultBadgeAwarder.sol";
import { MazeRenderer } from "../src/MazeRenderer.sol";
import { HonkVerifier } from "../src/generated/MazeVerifier.sol";

/**
 * @title DeployScript
 * @notice Deployment script for MazeKing contracts
 * @dev Deploys both the UltraVerifier and MazeKingNFT contracts
 *
 * Usage:
 *   Local (Anvil):
 *     forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *
 *   Sepolia:
 *     forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL \
 *       --private-key $PRIVATE_KEY --broadcast --verify
 */
contract DeployScript is Script {
    function run()
        external
        returns (address verifier, address nft, address awarder, address renderer)
    {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==================================================");
        console.log("Deploying MazeKing Contracts");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy Verifier
        console.log("Deploying HonkVerifier...");
        HonkVerifier verifierContract = new HonkVerifier();
        verifier = address(verifierContract);
        console.log("HonkVerifier deployed at:", verifier);
        console.log("");

        // Step 2: Deploy NFT
        console.log("Deploying MazeKingNFT...");
        MazeKingNFT nftContract = new MazeKingNFT(
            "MazeKing", "MAZE", "https://api.mazeking.xyz/token/", deployer, verifier
        );
        nft = address(nftContract);
        console.log("MazeKingNFT deployed at:", nft);
        console.log("");

        // Step 3: Deploy default badge awarder and wire it
        console.log("Deploying DefaultBadgeAwarder...");
        DefaultBadgeAwarder awarderContract = new DefaultBadgeAwarder(nft);
        awarder = address(awarderContract);
        console.log("DefaultBadgeAwarder deployed at:", awarder);
        nftContract.setBadgeAwarder(awarder);
        console.log("Wired badge awarder on NFT");
        console.log("");

        // Step 4: Deploy on-chain SVG renderer and wire it
        console.log("Deploying MazeRenderer...");
        MazeRenderer rendererContract = new MazeRenderer();
        renderer = address(rendererContract);
        console.log("MazeRenderer deployed at:", renderer);
        nftContract.setRenderer(renderer);
        console.log("Wired renderer on NFT");
        console.log("");

        vm.stopBroadcast();

        // Step 4: Save deployment addresses
        console.log("==================================================");
        console.log("Deployment Complete");
        console.log("==================================================");
        console.log("Verifier:", verifier);
        console.log("NFT:", nft);
        console.log("BadgeAwarder:", awarder);
        console.log("Renderer:", renderer);
        console.log("Owner:", deployer);
        console.log("");

        // Save to JSON file for frontend
        string memory deploymentsDir = string.concat(vm.projectRoot(), "/deployments");

        // Create deployments directory if it doesn't exist
        if (!vm.isDir(deploymentsDir)) {
            string[] memory mkdirInputs = new string[](3);
            mkdirInputs[0] = "mkdir";
            mkdirInputs[1] = "-p";
            mkdirInputs[2] = deploymentsDir;
            vm.ffi(mkdirInputs);
        }

        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "verifier": "',
            vm.toString(verifier),
            '",\n',
            '  "nft": "',
            vm.toString(nft),
            '",\n',
            '  "badgeAwarder": "',
            vm.toString(awarder),
            '",\n',
            '  "renderer": "',
            vm.toString(renderer),
            '",\n',
            '  "deployer": "',
            vm.toString(deployer),
            '",\n',
            '  "deployBlock": ',
            vm.toString(block.number),
            ",\n",
            '  "timestamp": ',
            vm.toString(block.timestamp),
            "\n",
            "}"
        );

        string memory filepath =
            string.concat(deploymentsDir, "/", vm.toString(block.chainid), ".json");

        vm.writeFile(filepath, json);
        console.log("Deployment info saved to:", filepath);

        // Also save as latest.json for convenience
        string memory latestPath = string.concat(deploymentsDir, "/latest.json");
        vm.writeFile(latestPath, json);
        console.log("Also saved as:", latestPath);
    }
}
