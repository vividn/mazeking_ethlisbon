// SPDX-License-Identifier: MIT
// solhint-disable-next-line unsafe-cheatcode
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";
import { MazeKingNFT } from "../src/MazeKingNFT.sol";
import { DefaultBadgeAwarder } from "../src/DefaultBadgeAwarder.sol";
import { MazeRenderer } from "../src/MazeRenderer.sol";
import { HonkVerifier } from "../src/generated/MazeVerifier.sol";
import { MazeKingResolver } from "../src/MazeKingResolver.sol";

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
    function run() external {
        Addresses memory a;
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        a.deployer = vm.addr(deployerPrivateKey);

        // Who ends up holding the roles. Defaults to the deployer, but a
        // production deploy should hand them to a wallet and let the deploy
        // key be disposable -- there is then no moment where a key that
        // touched a script or a CI variable controls the contract.
        address owner = vm.envOr("OWNER", a.deployer);

        console.log("==================================================");
        console.log("Deploying MazeKing Contracts");
        console.log("==================================================");
        console.log("Deployer:", a.deployer);
        console.log("Owner:", owner);
        console.log("Chain ID:", block.chainid);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy Verifier
        console.log("Deploying HonkVerifier...");
        HonkVerifier verifierContract = new HonkVerifier();
        a.verifier = address(verifierContract);
        console.log("HonkVerifier deployed at:", a.verifier);
        console.log("");

        // Step 2: Deploy NFT
        console.log("Deploying MazeKingNFT...");
        MazeKingNFT nftContract = new MazeKingNFT(
            "MazeKing", "MAZE", "https://api.mazeking.xyz/token/", a.deployer, a.verifier
        );
        a.nft = address(nftContract);
        console.log("MazeKingNFT deployed at:", a.nft);
        console.log("");

        // Step 3: Deploy default badge awarder and wire it
        console.log("Deploying DefaultBadgeAwarder...");
        DefaultBadgeAwarder awarderContract = new DefaultBadgeAwarder(a.nft);
        a.awarder = address(awarderContract);
        console.log("DefaultBadgeAwarder deployed at:", a.awarder);
        nftContract.setBadgeAwarder(a.awarder);
        console.log("Wired badge awarder on NFT");
        console.log("");

        // Step 4: Deploy on-chain SVG renderer and wire it
        console.log("Deploying MazeRenderer...");
        MazeRenderer rendererContract = new MazeRenderer();
        a.renderer = address(rendererContract);
        console.log("MazeRenderer deployed at:", a.renderer);
        nftContract.setRenderer(a.renderer);
        console.log("Wired renderer on NFT");
        console.log("");

        // Step 5: Deploy the ENS wildcard resolver.
        //
        // Coin type 60 is the mainnet address record; ENSIP-11 defines
        // `0x80000000 | chainId` for everything else. Reporting an L2
        // contract under coin type 60 would invite transfers to an address
        // holding no contract on mainnet, and those funds are unrecoverable.
        uint256 coinType = block.chainid == 1 ? 60 : (0x80000000 | block.chainid);
        console.log("Deploying MazeKingResolver...");
        MazeKingResolver resolverContract =
            new MazeKingResolver(owner, a.nft, coinType, "https://mazeking.io/s/", 2);
        a.resolver = address(resolverContract);
        console.log("MazeKingResolver deployed at:", a.resolver);
        console.log("Coin type:", coinType);
        console.log("");

        // Step 6: Hand the contract to its owner.
        //
        // Must come last. Every wiring call above needs OWNER_ROLE, so the
        // deployer keeps it until the wiring is done and only then gives it up.
        if (owner != a.deployer) {
            console.log("Transferring roles to owner...");
            nftContract.grantRole(nftContract.DEFAULT_ADMIN_ROLE(), owner);
            nftContract.grantRole(nftContract.OWNER_ROLE(), owner);
            nftContract.grantRole(nftContract.REGISTRAR_ROLE(), owner);
            nftContract.grantRole(nftContract.WITHDRAWER_ROLE(), owner);

            // DEFAULT_ADMIN_ROLE is what makes the others renounceable, so it
            // goes last.
            nftContract.renounceRole(nftContract.WITHDRAWER_ROLE(), a.deployer);
            nftContract.renounceRole(nftContract.REGISTRAR_ROLE(), a.deployer);
            nftContract.renounceRole(nftContract.OWNER_ROLE(), a.deployer);
            nftContract.renounceRole(nftContract.DEFAULT_ADMIN_ROLE(), a.deployer);
            console.log("Deployer holds no roles; the owner holds all of them.");
            console.log("");
        }

        vm.stopBroadcast();

        // Step 4: Save deployment addresses
        console.log("==================================================");
        console.log("Deployment Complete");
        console.log("==================================================");
        console.log("Verifier:", a.verifier);
        console.log("NFT:", a.nft);
        console.log("BadgeAwarder:", a.awarder);
        console.log("Renderer:", a.renderer);
        console.log("Resolver:", a.resolver);
        console.log("Owner:", owner);
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

        string memory json = _deploymentJson(a);

        string memory filepath =
            string.concat(deploymentsDir, "/", vm.toString(block.chainid), ".json");

        vm.writeFile(filepath, json);
        console.log("Deployment info saved to:", filepath);

        // Also save as latest.json for convenience
        string memory latestPath = string.concat(deploymentsDir, "/latest.json");
        vm.writeFile(latestPath, json);
        console.log("Also saved as:", latestPath);
    }

    /// @dev Grouped so building the deployment file does not need every address
    ///      live on the stack at once, which the EVM cannot manage alongside
    ///      five named return values.
    struct Addresses {
        address verifier;
        address nft;
        address awarder;
        address renderer;
        address resolver;
        address deployer;
    }

    function _deploymentJson(Addresses memory a) internal view returns (string memory) {
        return string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "verifier": "',
            vm.toString(a.verifier),
            '",\n',
            '  "nft": "',
            vm.toString(a.nft),
            '",\n',
            '  "badgeAwarder": "',
            vm.toString(a.awarder),
            '",\n',
            '  "renderer": "',
            vm.toString(a.renderer),
            '",\n',
            '  "resolver": "',
            vm.toString(a.resolver),
            '",\n',
            '  "deployer": "',
            vm.toString(a.deployer),
            '",\n',
            '  "deployBlock": ',
            vm.toString(block.number),
            ",\n",
            '  "timestamp": ',
            vm.toString(block.timestamp),
            "\n",
            "}"
        );
    }
}
