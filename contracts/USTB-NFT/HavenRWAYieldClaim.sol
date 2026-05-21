// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRWAAssetRegistry {
    function isAssetActive(uint256 assetId) external view returns (bool);
}

/**
 * @title HavenRWAYieldClaim
 * @dev USDT yield claim contract for HavenNFT holders.
 * @notice Yield math is fixed in this contract; the registry is used as the RWA disclosure layer.
 */
contract HavenRWAYieldClaim is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC721 public immutable havenNFT;
    IERC20 public immutable usdt;

    IRWAAssetRegistry public registry;
    uint256 public assetId;
    uint256 public principalPerNFT;
    uint256 public aprBps;
    uint256 public yieldStartTime;
    uint256 public yieldEndTime;

    uint256 public totalRevenueFunded;
    uint256 public totalRevenueClaimed;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant YEAR_SECONDS = 365 days;

    mapping(uint256 => uint256) public lastClaimedAt;
    mapping(uint256 => uint256) public totalClaimedByToken;

    event RegistryLinked(address indexed registry, uint256 indexed assetId);
    event RevenueFunded(
        uint256 indexed assetId,
        address indexed funder,
        uint256 amount
    );
    event YieldClaimed(
        uint256 indexed assetId,
        uint256 indexed tokenId,
        address indexed claimant,
        uint256 amount,
        uint256 fromTimestamp,
        uint256 toTimestamp
    );
    event YieldEndTimeUpdated(uint256 oldEndTime, uint256 newEndTime);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidAPR();
    error InvalidTimeRange();
    error AssetInactive();
    error NotTokenOwner();
    error NothingToClaim();
    error YieldPeriodNotEnded();

    constructor(
        address initialOwner,
        address nft_,
        address usdt_,
        address registry_,
        uint256 assetId_,
        uint256 principalPerNFT_,
        uint256 aprBps_,
        uint256 yieldStartTime_,
        uint256 yieldEndTime_
    ) Ownable(initialOwner) {
        if (
            initialOwner == address(0) ||
            nft_ == address(0) ||
            usdt_ == address(0) ||
            registry_ == address(0)
        ) revert InvalidAddress();
        if (principalPerNFT_ == 0) revert InvalidAmount();
        if (aprBps_ > BPS_DENOMINATOR) revert InvalidAPR();
        if (
            yieldStartTime_ == 0 ||
            yieldEndTime_ <= yieldStartTime_
        ) revert InvalidTimeRange();

        havenNFT = IERC721(nft_);
        usdt = IERC20(usdt_);
        registry = IRWAAssetRegistry(registry_);
        assetId = assetId_;
        principalPerNFT = principalPerNFT_;
        aprBps = aprBps_;
        yieldStartTime = yieldStartTime_;
        yieldEndTime = yieldEndTime_;

        emit RegistryLinked(registry_, assetId_);
    }

    function claim(uint256 tokenId) external whenNotPaused nonReentrant {
        _claim(tokenId);
    }

    function claimBatch(
        uint256[] calldata tokenIds
    ) external whenNotPaused nonReentrant {
        uint256 length = tokenIds.length;
        if (length == 0) revert InvalidAmount();

        for (uint256 i = 0; i < length; i++) {
            _claim(tokenIds[i]);
        }
    }

    function fundRevenue(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        totalRevenueFunded += amount;
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        emit RevenueFunded(assetId, msg.sender, amount);
    }

    function claimable(uint256 tokenId) public view returns (uint256) {
        uint256 fromTimestamp = _claimStart(tokenId);
        uint256 toTimestamp = _claimEnd();

        if (toTimestamp <= fromTimestamp) {
            return 0;
        }

        uint256 elapsed = toTimestamp - fromTimestamp;
        return (principalPerNFT * aprBps * elapsed) / (BPS_DENOMINATOR * YEAR_SECONDS);
    }

    function setRegistry(address newRegistry, uint256 newAssetId) external onlyOwner {
        if (newRegistry == address(0)) revert InvalidAddress();

        registry = IRWAAssetRegistry(newRegistry);
        assetId = newAssetId;

        emit RegistryLinked(newRegistry, newAssetId);
    }

    function setYieldEndTime(uint256 newYieldEndTime) external onlyOwner {
        if (newYieldEndTime <= yieldStartTime) revert InvalidTimeRange();

        uint256 oldEndTime = yieldEndTime;
        yieldEndTime = newYieldEndTime;

        emit YieldEndTimeUpdated(oldEndTime, newYieldEndTime);
    }

    function withdrawUnusedRevenue(
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (block.timestamp <= yieldEndTime) revert YieldPeriodNotEnded();
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        usdt.safeTransfer(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _claim(uint256 tokenId) internal {
        if (!registry.isAssetActive(assetId)) revert AssetInactive();
        if (havenNFT.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        uint256 fromTimestamp = _claimStart(tokenId);
        uint256 toTimestamp = _claimEnd();
        uint256 amount = claimable(tokenId);
        if (amount == 0) revert NothingToClaim();

        lastClaimedAt[tokenId] = toTimestamp;
        totalClaimedByToken[tokenId] += amount;
        totalRevenueClaimed += amount;

        usdt.safeTransfer(msg.sender, amount);

        emit YieldClaimed(assetId, tokenId, msg.sender, amount, fromTimestamp, toTimestamp);
    }

    function _claimStart(uint256 tokenId) internal view returns (uint256) {
        uint256 lastClaim = lastClaimedAt[tokenId];
        return lastClaim == 0 ? yieldStartTime : lastClaim;
    }

    function _claimEnd() internal view returns (uint256) {
        return block.timestamp < yieldEndTime ? block.timestamp : yieldEndTime;
    }

    function safePull(address token, address to, uint256 amount) internal {
        if (token == address(0)) revert InvalidAddress();
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransfer(to, amount);
    }
}
