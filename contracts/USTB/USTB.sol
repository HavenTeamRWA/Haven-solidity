// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title USTB - USD Bond Token
 * @dev Bond-backed stablecoin similar to ONDO USDY
 * @notice Accumulating token backed by short-term US government bonds and bank deposits
 */
contract USTB is 
    ERC20, 
    Ownable, 
    Pausable, 
    ReentrancyGuard 
{
    // Role addresses
    address public custodian;     // Custodian address (can deposit)
    address public redeemer;      // Redeemer address (can redeem)
    
    // State variables
    uint256 private _totalAssets; // Total asset value (18 decimal precision)
    uint256 private _lastYieldTimestamp; // Last yield calculation timestamp
    uint256 private _annualYieldRate; // Annual yield rate (basis points, e.g., 500 = 5%)
    uint256 private constant BASIS_POINTS = 10000;
    uint256 private constant PRECISION = 1e18;
    
    // Events
    event AssetsDeposited(address indexed depositor, uint256 amount, uint256 tokensMinted);
    event AssetsWithdrawn(address indexed withdrawer, uint256 tokensBurned, uint256 amount);
    event YieldAccrued(uint256 yieldAmount, uint256 newTotalAssets);
    event YieldRateUpdated(uint256 oldRate, uint256 newRate);
    event CustodianUpdated(address indexed oldCustodian, address indexed newCustodian);
    event RedeemerUpdated(address indexed oldRedeemer, address indexed newRedeemer);
    
    // Errors
    error InsufficientAssets();
    error InvalidYieldRate();
    error InvalidAmount();
    error UnauthorizedCustodian();
    error UnauthorizedRedeemer();
    
    constructor(
        address _custodian,
        address _redeemer,
        uint256 initialYieldRate
    )
        ERC20("USD Bond Token", "USTB")
        Ownable(msg.sender)
    {
        require(_custodian != address(0), "Invalid custodian address");
        require(_redeemer != address(0), "Invalid redeemer address");
        if (initialYieldRate > BASIS_POINTS) revert InvalidYieldRate();
        
        custodian = _custodian;
        redeemer = _redeemer;
        _annualYieldRate = initialYieldRate;
        _lastYieldTimestamp = block.timestamp;
        
        // Initialize with total assets = 0, no tokens minted
    }
    
    /**
     * @dev Get static token price (does not include unaccrued yield)
     * @notice This is a view function that does not accrue yield, may return stale price
     * @notice Directly uses current _totalAssets and totalSupply to calculate price
     * @notice If total supply is 0, returns 1:1 initial price (PRECISION)
     * @return Static price (18 decimal precision), representing 1 USTB = price / PRECISION USD
     */
    function getStaticPrice() public view returns (uint256) {
        uint256 totalSupply = totalSupply();
        if (totalSupply == 0) return PRECISION; // 1:1 initial price
        
        return (_totalAssets * PRECISION) / totalSupply;
    }

    /**
     * @dev Get current token price (includes preview of unaccrued yield)
     * @notice This is a view function that does not modify state
     * @notice Calculates what the price would be if yield were accrued now, but does not actually accrue yield
     * @notice If total supply is 0, returns 1:1 initial price (PRECISION)
     * @return Preview price (18 decimal precision), representing 1 USTB = price / PRECISION USD
     */
    function getPrice() public view returns (uint256) {
        uint256 totalSupply = totalSupply();
        if (totalSupply == 0) return PRECISION; // 1:1 initial price
        
        // Calculate what total assets would be if yield were accrued now
        uint256 currentTime = block.timestamp;
        uint256 timeElapsed = currentTime - _lastYieldTimestamp;
        
        uint256 previewAssets = _totalAssets;
        if (timeElapsed > 0 && _totalAssets > 0) {
            // Calculate preview yield (does not modify state)
            uint256 yieldAmount = (_totalAssets * _annualYieldRate * timeElapsed) / (BASIS_POINTS * 365 days);
            previewAssets = _totalAssets + yieldAmount;
        }
        
        return (previewAssets * PRECISION) / totalSupply;
    }
    
    /**
     * @dev Get total asset value
     * @notice Returns the currently recorded total asset value (18 decimal precision)
     * @notice Note: This value may not include unaccrued yield, call accrueYield() first for latest value
     * @return Total asset value (18 decimal precision)
     */
    function getTotalAssets() external view returns (uint256) {
        return _totalAssets;
    }
    
    /**
     * @dev Get annual yield rate
     * @notice Returns the currently set annual yield rate (in basis points)
     * @notice Example: 500 represents 5% (500 / 10000)
     * @return Annual yield rate (basis points, maximum value is 10000 = 100%)
     */
    function getYieldRate() external view returns (uint256) {
        return _annualYieldRate;
    }
    
    /**
     * @dev Deposit - Purchase USTB with USD
     * @notice Only the custodian address can call this function
     * @notice Automatically accrues yield first to ensure using latest price for token calculation
     * @notice Calculates tokens to mint based on current price: tokensToMint = (amount * PRECISION) / price
     * @param amount Deposit amount (18 decimal precision)
     * @param to Address to receive tokens
     * @custom:require msg.sender == custodian
     * @custom:require amount > 0
     */
    function deposit(uint256 amount, address to) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        if (msg.sender != custodian) revert UnauthorizedCustodian();
        if (amount == 0) revert InvalidAmount();
        
        // Accrue yield first to ensure price is up to date
        _accrueYield();
        
        uint256 price = getPrice();
        uint256 tokensToMint = (amount * PRECISION) / price;
        require(tokensToMint > 0, "Tokens to mint is 0");

        _totalAssets += amount;
        _mint(to, tokensToMint);
        
        emit AssetsDeposited(to, amount, tokensToMint);
    }
    
    /**
     * @dev Redeem - Exchange USTB for USD
     * @notice Only the redeemer address can call this function
     * @notice Automatically accrues yield first to ensure using latest price for USD calculation
     * @notice Burns tokens from the to address and calculates USD amount to withdraw based on current price
     * @notice USD amount formula: usdAmount = (tokenAmount * price) / PRECISION
     * @param tokenAmount Amount of tokens to burn
     * @param to Token holder address (tokens burned from this address) and address to receive funds
     * @custom:require msg.sender == redeemer
     * @custom:require tokenAmount > 0
     * @custom:require balanceOf(to) >= tokenAmount
     * @custom:require usdAmount <= _totalAssets
     */
    function redeem(uint256 tokenAmount, address to) 
        external 
        whenNotPaused 
        nonReentrant 
    {
        if (msg.sender != redeemer) revert UnauthorizedRedeemer();
        if (tokenAmount == 0) revert InvalidAmount();
        if (balanceOf(to) < tokenAmount) revert InvalidAmount();
        
        // Accrue yield first
        _accrueYield();
        
        uint256 price = getPrice();
        uint256 usdAmount = (tokenAmount * price) / PRECISION;
        
        if (usdAmount > _totalAssets) revert InsufficientAssets();
        
        _totalAssets -= usdAmount;
        _burn(to, tokenAmount);
        
        emit AssetsWithdrawn(to, tokenAmount, usdAmount);
    }
    
    /**
     * @dev Calculate and accrue yield
     * @notice Anyone can call this function to update yield
     */
    function accrueYield() external {
        _accrueYield();
    }
    
    /**
     * @dev Internal yield calculation function
     * @notice Calculates and accrues yield to total assets based on annual yield rate and time elapsed
     * @notice If time elapsed is 0 or total assets is 0, does nothing
     * @notice Yield calculation formula: yieldAmount = (_totalAssets * _annualYieldRate * timeElapsed) / (BASIS_POINTS * 365 days)
     * @notice Automatically updates _lastYieldTimestamp to current timestamp
     * @notice Emits YieldAccrued event
     */
    function _accrueYield() internal {
        uint256 currentTime = block.timestamp;
        uint256 timeElapsed = currentTime - _lastYieldTimestamp;
        
        if (timeElapsed == 0 || _totalAssets == 0) {
            return;
        }
        
        // Calculate yield: annual yield rate * time ratio * total assets
        // Assume one year = 365 * 24 * 3600 = 31,536,000 seconds
        uint256 yieldAmount = (_totalAssets * _annualYieldRate * timeElapsed) / (BASIS_POINTS * 365 days);
        
        _totalAssets += yieldAmount;
        _lastYieldTimestamp = currentTime;
        
        emit YieldAccrued(yieldAmount, _totalAssets);
    }
    
    /**
     * @dev Update annual yield rate
     * @notice Only owner can call this function
     * @notice Accrues old yield before updating rate to ensure accurate yield calculation
     * @notice New rate cannot exceed 100% (BASIS_POINTS)
     * @param newRate New annual yield rate (basis points, e.g., 500 = 5%)
     * @custom:require msg.sender == owner
     * @custom:require newRate <= BASIS_POINTS
     */
    function updateYieldRate(uint256 newRate) 
        external 
        onlyOwner 
    {
        if (newRate > BASIS_POINTS) revert InvalidYieldRate();
        
        // Accrue old yield first to ensure all earned yield is calculated before updating rate
        _accrueYield();
        
        uint256 oldRate = _annualYieldRate;
        _annualYieldRate = newRate;
        
        emit YieldRateUpdated(oldRate, newRate);
    }
    
    /**
     * @dev Update custodian address
     * @param newCustodian New custodian address
     */
    function updateCustodian(address newCustodian) 
        external 
        onlyOwner 
    {
        require(newCustodian != address(0), "Invalid custodian address");
        address oldCustodian = custodian;
        custodian = newCustodian;
        emit CustodianUpdated(oldCustodian, newCustodian);
    }
    
    /**
     * @dev Update redeemer address
     * @param newRedeemer New redeemer address
     */
    function updateRedeemer(address newRedeemer) 
        external 
        onlyOwner 
    {
        require(newRedeemer != address(0), "Invalid redeemer address");
        address oldRedeemer = redeemer;
        redeemer = newRedeemer;
        emit RedeemerUpdated(oldRedeemer, newRedeemer);
    }
    
    /**
     * @dev Pause contract
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Override transfer function, add pause check
     */
    function transfer(address to, uint256 amount) 
        public 
        override 
        whenNotPaused 
        returns (bool) 
    {
        return super.transfer(to, amount);
    }
    
    /**
     * @dev Override transferFrom function, add pause check
     */
    function transferFrom(address from, address to, uint256 amount) 
        public 
        override 
        whenNotPaused 
        returns (bool) 
    {
        return super.transferFrom(from, to, amount);
    }


    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
