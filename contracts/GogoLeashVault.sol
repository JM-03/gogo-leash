// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// QoreChain post-quantum precompiles (live on the qorechain-diana testnet).
/// Same fixed addresses the chain publishes; the interface is the chain's API.
interface IQorePQC {
    /// ML-DSA-87 (NIST FIPS 204) verification: 2592-byte key, 4627-byte signature.
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);

    /// The ML-DSA-87 key an account registered on chain.
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

/// @title GogoLeashVault
/// @notice A trading-desk vault that survives Q-Day. Money leaves only when:
///   1. the guardian signs with a post-quantum ML-DSA-87 key, verified on
///      chain by the pqcVerify precompile (a stolen secp256k1 key is not
///      enough — anyone may submit the withdrawal, the signature authorises it);
///   2. the recipient is on the guardian's allowlist;
///   3. the amount fits the per-payment cap and the daily cap;
///   4. the kill switch is off.
/// @dev Caps and the allowlist live in the contract, not in the agent's code,
/// so a bug, a prompt injection, or a stolen agent server cannot lift them.
/// The guardian's ML-DSA-87 key is never stored here; it is read from the
/// chain's key registry on every withdrawal, so a key rotation on chain is
/// picked up automatically. All amounts are in wei (QOR on QoreChain EVM).
contract GogoLeashVault {
    IQorePQC internal constant PQC_VERIFY = IQorePQC(0x0000000000000000000000000000000000000a01);
    IQorePQC internal constant PQC_KEYS = IQorePQC(0x0000000000000000000000000000000000000a02);

    /// The QoreChain account whose registered ML-DSA-87 key authorises withdrawals.
    address public immutable guardian;
    /// Max value of one withdrawal.
    uint256 public perTxCap;
    /// Max total value withdrawn per UTC day.
    uint256 public dailyCap;
    /// Increases with every withdrawal, so a signature works once.
    uint256 public nonce;
    /// Guardian kill switch: when true, every withdrawal reverts.
    bool public paused;

    mapping(address => bool) public allowlisted;
    uint256 internal spentToday;
    uint256 internal dayStart; // block.timestamp / 1 days of the current bucket

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount, uint256 indexed nonce);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AllowlistUpdated(address indexed account, bool allowed);
    event CapsUpdated(uint256 perTxCap, uint256 dailyCap);

    error NotGuardian();
    error PausedVault();
    error NotAllowlisted(address to);
    error OverPerTxCap(uint256 amount, uint256 cap);
    error OverDailyCap(uint256 amount, uint256 remaining);
    error GuardianKeyNotRegistered();
    error GuardianKeyNotProven();
    error BadPqcSignature();
    error TransferFailed();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(address guardian_, uint256 perTxCap_, uint256 dailyCap_) payable {
        guardian = guardian_;
        perTxCap = perTxCap_;
        dailyCap = dailyCap_;
        dayStart = block.timestamp / 1 days;
        if (msg.value > 0) emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    /// The exact bytes the guardian signs for a withdrawal. Binds a fixed tag,
    /// the chain id, this vault, the recipient, the amount and the nonce, so a
    /// signature works for one withdrawal, on one vault, on one chain, once.
    function withdrawalMessage(address to, uint256 amount, uint256 nonce_) public view returns (bytes memory) {
        return abi.encodePacked("GogoLeash:withdraw:v1", block.chainid, address(this), to, amount, nonce_);
    }

    /// Value already spent in the current UTC-day bucket (0 after a new day).
    function spentTodayAmount() public view returns (uint256) {
        return block.timestamp / 1 days == dayStart ? spentToday : 0;
    }

    function withdraw(address payable to, uint256 amount, bytes calldata mldsaSignature) external {
        if (paused) revert PausedVault();
        if (!allowlisted[to]) revert NotAllowlisted(to);
        if (amount > perTxCap) revert OverPerTxCap(amount, perTxCap);

        uint256 day = block.timestamp / 1 days;
        uint256 spent = day == dayStart ? spentToday : 0;
        if (spent + amount > dailyCap) revert OverDailyCap(amount, dailyCap - spent);

        (bool registered,, bytes memory pubkey, bool proven) = PQC_KEYS.pqcKeyStatus(guardian);
        if (!registered || pubkey.length == 0) revert GuardianKeyNotRegistered();
        if (!proven) revert GuardianKeyNotProven();

        uint256 n = nonce;
        if (!PQC_VERIFY.pqcVerify(pubkey, mldsaSignature, withdrawalMessage(to, amount, n))) {
            revert BadPqcSignature();
        }

        // Effects before the outside call: no replay, no reentrancy.
        nonce = n + 1;
        dayStart = day;
        spentToday = spent + amount;
        emit Withdrawn(to, amount, n);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // --- Guardian administration (EVM lane: needs a live EVM window) ---

    function setAllowlisted(address account, bool allowed) external onlyGuardian {
        allowlisted[account] = allowed;
        emit AllowlistUpdated(account, allowed);
    }

    function setCaps(uint256 perTxCap_, uint256 dailyCap_) external onlyGuardian {
        perTxCap = perTxCap_;
        dailyCap = dailyCap_;
        emit CapsUpdated(perTxCap_, dailyCap_);
    }

    function pause() external onlyGuardian {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyGuardian {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
