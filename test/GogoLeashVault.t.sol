// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GogoLeashVault} from "../contracts/GogoLeashVault.sol";

/// Stand-in for the pqcVerify precompile. A signature is valid only for the
/// exact message it was made for: the mock accepts
/// keccak256(pubkey || message) as the "signature". A replayed signature
/// (same bytes, new nonce baked into the message) therefore fails, exactly
/// like a real ML-DSA-87 verification over a different message would.
/// Stateless on purpose: `vm.etch` copies only runtime code, not storage.
contract MockPqcVerify {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return signature.length == 32 && keccak256(abi.encodePacked(pubkey, message)) == bytes32(signature);
    }
}

/// Stand-in for the pqcKeyStatus precompile: one registered + proven key.
/// Stateless for the same etch reason as above. Variants cover the negatives.
contract MockPqcKeys {
    function pqcKeyStatus(address) external pure returns (bool, uint8, bytes memory, bool) {
        return (true, 1, hex"11223344", true);
    }
}

/// Same mock, but the guardian never registered a key.
contract MockPqcKeysUnregistered {
    function pqcKeyStatus(address) external pure returns (bool, uint8, bytes memory, bool) {
        return (false, 0, hex"", false);
    }
}

/// Same mock, but the guardian never proved possession of the key.
contract MockPqcKeysUnproven {
    function pqcKeyStatus(address) external pure returns (bool, uint8, bytes memory, bool) {
        return (true, 1, hex"11223344", false);
    }
}

contract GogoLeashVaultTest is Test {
    GogoLeashVault internal vault;
    MockPqcKeys internal keys;
    address internal guardian = address(0xBEEF);
    address internal vendor = address(0xA11CE);
    address internal stranger = address(0x5A5A);
    bytes internal constant BAD_SIG = "attacker-random-pq-signature";

    uint256 internal constant PER_TX = 1 ether;
    uint256 internal constant DAILY = 3 ether;

    function setUp() public {
        vm.etch(0x0000000000000000000000000000000000000a01, address(new MockPqcVerify()).code);
        keys = new MockPqcKeys();
        vm.etch(0x0000000000000000000000000000000000000a02, address(keys).code);
        vault = new GogoLeashVault{value: 10 ether}(guardian, PER_TX, DAILY);
        vm.prank(guardian);
        vault.setAllowlisted(vendor, true);
    }

    /// The "signature" for the vault's current nonce, as the mock expects it.
    function goodSig(address to, uint256 amount) internal view returns (bytes memory) {
        bytes memory message = vault.withdrawalMessage(to, amount, vault.nonce());
        return abi.encodePacked(keccak256(abi.encodePacked(hex"11223344", message)));
    }

    function testGoodSignaturePays() public {
        uint256 before = vendor.balance;
        vault.withdraw(payable(vendor), 0.5 ether, goodSig(vendor, 0.5 ether));
        assertEq(vendor.balance, before + 0.5 ether);
        assertEq(vault.nonce(), 1);
    }

    function testBadSignatureIsRefused() public {
        vm.expectRevert(GogoLeashVault.BadPqcSignature.selector);
        vault.withdraw(payable(vendor), 0.5 ether, BAD_SIG);
    }

    function testSignatureWorksOnce() public {
        bytes memory sig = goodSig(vendor, 0.5 ether);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
        // Same bytes, new nonce: the message changed, so the signature is dead.
        vm.expectRevert(GogoLeashVault.BadPqcSignature.selector);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
    }

    function testStrangerIsNotAllowlisted() public {
        bytes memory sig = goodSig(stranger, 0.5 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVault.NotAllowlisted.selector, stranger));
        vault.withdraw(payable(stranger), 0.5 ether, sig);
    }

    function testOverPerTxCapIsRefused() public {
        bytes memory sig = goodSig(vendor, 1.5 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVault.OverPerTxCap.selector, 1.5 ether, PER_TX));
        vault.withdraw(payable(vendor), 1.5 ether, sig);
    }

    function testOverDailyCapIsRefused() public {
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        bytes memory sig = goodSig(vendor, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVault.OverDailyCap.selector, 1 ether, 0));
        vault.withdraw(payable(vendor), 1 ether, sig);
    }

    function testDailyCapResetsNextDay() public {
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vm.warp(block.timestamp + 1 days + 1);
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        assertEq(vault.nonce(), 4);
    }

    function testKillSwitchBlocksWithdrawals() public {
        vm.prank(guardian);
        vault.pause();
        bytes memory sig = goodSig(vendor, 0.5 ether);
        vm.expectRevert(GogoLeashVault.PausedVault.selector);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
        vm.prank(guardian);
        vault.unpause();
        vault.withdraw(payable(vendor), 0.5 ether, goodSig(vendor, 0.5 ether));
        assertEq(vault.nonce(), 1);
    }

    function testOnlyGuardianCanPause() public {
        vm.expectRevert(GogoLeashVault.NotGuardian.selector);
        vault.pause();
    }

    function testUnregisteredGuardianKeyIsRefused() public {
        vm.etch(0x0000000000000000000000000000000000000a02, address(new MockPqcKeysUnregistered()).code);
        bytes memory sig = goodSig(vendor, 0.5 ether);
        vm.expectRevert(GogoLeashVault.GuardianKeyNotRegistered.selector);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
    }

    function testUnprovenGuardianKeyIsRefused() public {
        vm.etch(0x0000000000000000000000000000000000000a02, address(new MockPqcKeysUnproven()).code);
        bytes memory sig = goodSig(vendor, 0.5 ether);
        vm.expectRevert(GogoLeashVault.GuardianKeyNotProven.selector);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
    }
}
