// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GogoLeashVaultV2} from "../contracts/GogoLeashVaultV2.sol";

/// Stand-in for the pqcVerify precompile. A signature is valid only for the
/// exact message it was made for: the mock accepts
/// keccak256(pubkey || message) as the "signature". A replayed signature
/// (same bytes, new nonce baked into the message) therefore fails, exactly
/// like a real ML-DSA-87 verification over a different message would.
/// Stateless on purpose: `vm.etch` copies only runtime code, not storage.
contract MockPqcVerifyV2 {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        pure
        returns (bool)
    {
        return signature.length == 32 && keccak256(abi.encodePacked(pubkey, message)) == bytes32(signature);
    }
}

/// Stand-in for the pqcKeyStatus precompile: one registered + proven key.
/// Stateless for the same etch reason as above.
contract MockPqcKeysV2 {
    function pqcKeyStatus(address) external pure returns (bool, uint8, bytes memory, bool) {
        return (true, 1, hex"11223344", true);
    }
}

contract GogoLeashVaultV2Test is Test {
    GogoLeashVaultV2 internal vault;
    address internal guardian = address(0xBEEF);
    address internal vendor = address(0xA11CE);
    address internal stranger = address(0x5A5A);
    bytes internal constant BAD_SIG = "attacker-random-pq-signature";

    uint256 internal constant PER_TX = 1 ether;
    uint256 internal constant DAILY = 3 ether;
    // A realistic start time so the 24-hour window arithmetic never underflows.
    uint256 internal constant T0 = 1_800_000_000;

    function setUp() public {
        vm.warp(T0);
        vm.etch(0x0000000000000000000000000000000000000a01, address(new MockPqcVerifyV2()).code);
        vm.etch(0x0000000000000000000000000000000000000a02, address(new MockPqcKeysV2()).code);
        vault = new GogoLeashVaultV2{value: 10 ether}(guardian, PER_TX, DAILY);
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
        vm.expectRevert(GogoLeashVaultV2.BadPqcSignature.selector);
        vault.withdraw(payable(vendor), 0.5 ether, BAD_SIG);
    }

    function testSignatureWorksOnce() public {
        bytes memory sig = goodSig(vendor, 0.5 ether);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
        vm.expectRevert(GogoLeashVaultV2.BadPqcSignature.selector);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
    }

    function testStrangerIsNotAllowlisted() public {
        bytes memory sig = goodSig(stranger, 0.5 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVaultV2.NotAllowlisted.selector, stranger));
        vault.withdraw(payable(stranger), 0.5 ether, sig);
    }

    function testOverPerTxCapIsRefused() public {
        bytes memory sig = goodSig(vendor, 1.5 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVaultV2.OverPerTxCap.selector, 1.5 ether, PER_TX));
        vault.withdraw(payable(vendor), 1.5 ether, sig);
    }

    function testOverRollingCapIsRefused() public {
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        assertEq(vault.spentInWindowAmount(), 3 ether);
        bytes memory sig = goodSig(vendor, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVaultV2.OverDailyCap.selector, 1 ether, 0));
        vault.withdraw(payable(vendor), 1 ether, sig);
    }

    /// The v1 hole, closed: spend the full cap just before midnight, cross
    /// midnight, and the vault must STILL refuse — the window is rolling,
    /// not a calendar day.
    function testMidnightCrossingDoesNotResetCap() public {
        uint256 justBeforeMidnight = (T0 / 1 days + 1) * 1 days - 60;
        vm.warp(justBeforeMidnight);
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vm.warp(justBeforeMidnight + 120); // two minutes past midnight
        bytes memory sig = goodSig(vendor, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVaultV2.OverDailyCap.selector, 1 ether, 0));
        vault.withdraw(payable(vendor), 1 ether, sig);
    }

    /// The window slides: a payment stops counting exactly 24 hours after it.
    function testWindowSlidesPaymentByPayment() public {
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vm.warp(T0 + 12 hours);
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        // First payment is 12h old, still inside the window: cap full at 3.
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        assertEq(vault.spentInWindowAmount(), 3 ether);
        // 24h after the FIRST payment it expires; one slot frees up.
        vm.warp(T0 + 24 hours + 1);
        assertEq(vault.spentInWindowAmount(), 2 ether);
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        assertEq(vault.nonce(), 4);
        // And the cap is full again until the second payment expires.
        bytes memory sig = goodSig(vendor, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVaultV2.OverDailyCap.selector, 1 ether, 0));
        vault.withdraw(payable(vendor), 1 ether, sig);
    }

    function testKillSwitchBlocksWithdrawals() public {
        vm.prank(guardian);
        vault.pause();
        bytes memory sig = goodSig(vendor, 0.5 ether);
        vm.expectRevert(GogoLeashVaultV2.PausedVault.selector);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
        vm.prank(guardian);
        vault.unpause();
        vault.withdraw(payable(vendor), 0.5 ether, goodSig(vendor, 0.5 ether));
        assertEq(vault.nonce(), 1);
    }

    function testOnlyGuardianCanPause() public {
        vm.expectRevert(GogoLeashVaultV2.NotGuardian.selector);
        vault.pause();
    }

    function testTripwirePausesAndUnpauseClearsIt() public {
        vm.prank(guardian);
        vault.trip(3);
        assertTrue(vault.paused());
        assertTrue(vault.tripwirePaused());
        assertEq(vault.tripwireTrips(), 1);
        bytes memory sig = goodSig(vendor, 0.5 ether);
        vm.expectRevert(GogoLeashVaultV2.PausedVault.selector);
        vault.withdraw(payable(vendor), 0.5 ether, sig);
        vm.prank(guardian);
        vault.unpause();
        assertFalse(vault.tripwirePaused());
        vault.withdraw(payable(vendor), 0.5 ether, goodSig(vendor, 0.5 ether));
        assertEq(vault.nonce(), 1);
    }

    function testOnlyGuardianCanTrip() public {
        vm.expectRevert(GogoLeashVaultV2.NotGuardian.selector);
        vault.trip(3);
    }

    function testSetTripwireUpdatesConfig() public {
        vm.prank(guardian);
        vault.setTripwire(5, 30 minutes);
        assertEq(vault.tripwireThreshold(), 5);
        assertEq(vault.tripwireWindow(), 30 minutes);
        vm.expectRevert(GogoLeashVaultV2.NotGuardian.selector);
        vault.setTripwire(1, 1 hours);
    }

    /// A v1 signature (v1 message tag) must never work on the v2 vault.
    function testV1SignatureIsDeadOnV2() public {
        bytes memory v1Message = abi.encodePacked(
            bytes("GogoLeash:withdraw:v1"), block.chainid, address(vault), vendor, uint256(0.5 ether), vault.nonce()
        );
        bytes memory v1Sig = abi.encodePacked(keccak256(abi.encodePacked(hex"11223344", v1Message)));
        vm.expectRevert(GogoLeashVaultV2.BadPqcSignature.selector);
        vault.withdraw(payable(vendor), 0.5 ether, v1Sig);
    }

    function testSetCapsChangesLimits() public {
        vm.prank(guardian);
        vault.setCaps(0.5 ether, 2 ether);
        assertEq(vault.perTxCap(), 0.5 ether);
        assertEq(vault.dailyCap(), 2 ether);
        bytes memory sig = goodSig(vendor, 0.8 ether);
        vm.expectRevert(abi.encodeWithSelector(GogoLeashVaultV2.OverPerTxCap.selector, 0.8 ether, 0.5 ether));
        vault.withdraw(payable(vendor), 0.8 ether, sig);
        vm.expectRevert(GogoLeashVaultV2.NotGuardian.selector);
        vault.setCaps(1 ether, 3 ether);
    }

    function testDepositViaReceive() public {
        uint256 before = address(vault).balance;
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, before + 1 ether);
    }

    function testTripwireDefaults() public {
        assertEq(vault.tripwireThreshold(), 3);
        assertEq(vault.tripwireWindow(), 1 hours);
        assertEq(vault.tripwireTrips(), 0);
        assertFalse(vault.tripwirePaused());
    }

    function testSpentTodayAliasMatchesWindow() public {
        vault.withdraw(payable(vendor), 1 ether, goodSig(vendor, 1 ether));
        vm.warp(T0 + 12 hours);
        vault.withdraw(payable(vendor), 0.5 ether, goodSig(vendor, 0.5 ether));
        assertEq(vault.spentTodayAmount(), vault.spentInWindowAmount());
        assertEq(vault.spentTodayAmount(), 1.5 ether);
    }

    function testManualPauseThenTripThenUnpause() public {
        vm.prank(guardian);
        vault.pause();
        vm.prank(guardian);
        vault.trip(3);
        assertTrue(vault.paused());
        assertTrue(vault.tripwirePaused());
        assertEq(vault.tripwireTrips(), 1);
        vm.prank(guardian);
        vault.unpause();
        assertFalse(vault.paused());
        assertFalse(vault.tripwirePaused());
        vault.withdraw(payable(vendor), 0.5 ether, goodSig(vendor, 0.5 ether));
        assertEq(vault.nonce(), 1);
    }

    /// Fuzz: a random sequence of payments and time jumps can never leave
    /// the rolling window holding more than the daily cap, and the reported
    /// spend always equals the sum of the payments made in the last 24h.
    function testFuzz_RollingWindowAccounting(uint8 n, uint256 seed) public {
        uint256 count = (uint256(n) % 5) + 1; // 1..5 payments
        uint256[] memory times = new uint256[](count);
        uint256[] memory amounts = new uint256[](count);
        bool[] memory paid = new bool[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 amount = 0.1 ether + (uint256(keccak256(abi.encode(seed, i))) % 10) * 0.1 ether;
            uint256 jump = uint256(keccak256(abi.encode(seed, i, "t"))) % 30 hours;
            vm.warp(block.timestamp + jump);
            times[i] = block.timestamp;
            amounts[i] = amount;
            uint256 spent = vault.spentInWindowAmount();
            assertLe(spent, DAILY);
            // Build the signature BEFORE expectRevert: goodSig itself calls
            // the vault, and expectRevert would attach to that call instead.
            bytes memory sig = goodSig(vendor, amount);
            if (spent + amount <= DAILY) {
                vault.withdraw(payable(vendor), amount, sig);
                paid[i] = true;
            } else {
                vm.expectRevert();
                vault.withdraw(payable(vendor), amount, sig);
            }
        }
        uint256 expected = 0;
        uint256 cutoff = block.timestamp > 24 hours ? block.timestamp - 24 hours : 0;
        for (uint256 i = 0; i < count; i++) {
            if (paid[i] && times[i] > cutoff) expected += amounts[i];
        }
        assertEq(vault.spentInWindowAmount(), expected);
        assertLe(vault.spentInWindowAmount(), DAILY);
    }
}
