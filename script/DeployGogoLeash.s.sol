// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GogoLeashVault} from "../contracts/GogoLeashVault.sol";

/// Deploys GogoLeashVault with a first deposit. The guardian defaults to the
/// deployer. Caps default to 1 QOR per payment / 3 QOR per day.
///   forge script script/DeployGogoLeash.s.sol --rpc-url qorechain_testnet --broadcast
/// Needs a live EVM window first (node scripts/window.mjs open).
contract DeployGogoLeash is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address guardian = vm.envOr("GUARDIAN", vm.addr(key));
        uint256 perTx = vm.envOr("VAULT_PERTX_WEI", uint256(1 ether));
        uint256 daily = vm.envOr("VAULT_DAILY_WEI", uint256(3 ether));
        uint256 deposit = vm.envOr("VAULT_DEPOSIT_WEI", uint256(2 ether));
        vm.startBroadcast(key);
        GogoLeashVault vault = new GogoLeashVault{value: deposit}(guardian, perTx, daily);
        vm.stopBroadcast();
        console.log("GogoLeashVault", address(vault));
        console.log("guardian     ", guardian);
        console.log("perTxCap     ", perTx);
        console.log("dailyCap     ", daily);
    }
}
