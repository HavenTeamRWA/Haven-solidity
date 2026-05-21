// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RWAAssetRegistry
 * @dev Lightweight registry for RWA asset metadata, NAV updates, and revenue reports.
 * @notice This contract is the disclosure/audit layer. It does not custody funds.
 */
contract RWAAssetRegistry is Ownable {
    struct Asset {
        uint256 assetId;
        string metadataURI;
        uint256 principalPerNFT;
        uint256 aprBps;
        uint256 createdAt;
        bool active;
    }

    struct AssetReport {
        uint256 nav;
        uint256 revenueAmount;
        string reportURI;
        uint256 publishedAt;
    }

    uint256 public constant BPS_DENOMINATOR = 10_000;

    mapping(uint256 => Asset) private _assets;
    mapping(uint256 => AssetReport[]) private _assetReports;

    event AssetRegistered(
        uint256 indexed assetId,
        string metadataURI,
        uint256 principalPerNFT,
        uint256 aprBps
    );
    event AssetStatusUpdated(uint256 indexed assetId, bool active);
    event AssetMetadataUpdated(uint256 indexed assetId, string metadataURI);
    event AssetReportPublished(
        uint256 indexed assetId,
        uint256 nav,
        uint256 revenueAmount,
        string reportURI
    );

    error AssetAlreadyExists();
    error AssetNotFound();
    error InvalidAPR();
    error InvalidAmount();
    error EmptyURI();

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert OwnableInvalidOwner(address(0));
    }

    function registerAsset(
        uint256 assetId,
        string calldata metadataURI,
        uint256 principalPerNFT,
        uint256 aprBps
    ) external onlyOwner {
        if (_assets[assetId].createdAt != 0) revert AssetAlreadyExists();
        if (bytes(metadataURI).length == 0) revert EmptyURI();
        if (principalPerNFT == 0) revert InvalidAmount();
        if (aprBps > BPS_DENOMINATOR) revert InvalidAPR();

        _assets[assetId] = Asset({
            assetId: assetId,
            metadataURI: metadataURI,
            principalPerNFT: principalPerNFT,
            aprBps: aprBps,
            createdAt: block.timestamp,
            active: true
        });

        emit AssetRegistered(assetId, metadataURI, principalPerNFT, aprBps);
    }

    function setAssetStatus(uint256 assetId, bool active) external onlyOwner {
        _requireAsset(assetId);
        _assets[assetId].active = active;
        emit AssetStatusUpdated(assetId, active);
    }

    function setAssetMetadataURI(
        uint256 assetId,
        string calldata metadataURI
    ) external onlyOwner {
        _requireAsset(assetId);
        if (bytes(metadataURI).length == 0) revert EmptyURI();

        _assets[assetId].metadataURI = metadataURI;
        emit AssetMetadataUpdated(assetId, metadataURI);
    }

    function publishReport(
        uint256 assetId,
        uint256 nav,
        uint256 revenueAmount,
        string calldata reportURI
    ) external onlyOwner {
        _requireAsset(assetId);
        if (bytes(reportURI).length == 0) revert EmptyURI();

        _assetReports[assetId].push(
            AssetReport({
                nav: nav,
                revenueAmount: revenueAmount,
                reportURI: reportURI,
                publishedAt: block.timestamp
            })
        );

        emit AssetReportPublished(assetId, nav, revenueAmount, reportURI);
    }

    function getAsset(uint256 assetId) external view returns (Asset memory) {
        _requireAsset(assetId);
        return _assets[assetId];
    }

    function isAssetActive(uint256 assetId) external view returns (bool) {
        return _assets[assetId].active;
    }

    function getReportsCount(uint256 assetId) external view returns (uint256) {
        _requireAsset(assetId);
        return _assetReports[assetId].length;
    }

    function getReport(
        uint256 assetId,
        uint256 index
    ) external view returns (AssetReport memory) {
        _requireAsset(assetId);
        return _assetReports[assetId][index];
    }

    function getLatestReport(
        uint256 assetId
    ) external view returns (AssetReport memory) {
        _requireAsset(assetId);

        uint256 length = _assetReports[assetId].length;
        if (length == 0) {
            return AssetReport({
                nav: 0,
                revenueAmount: 0,
                reportURI: "",
                publishedAt: 0
            });
        }

        return _assetReports[assetId][length - 1];
    }

    function _requireAsset(uint256 assetId) internal view {
        if (_assets[assetId].createdAt == 0) revert AssetNotFound();
    }
}
