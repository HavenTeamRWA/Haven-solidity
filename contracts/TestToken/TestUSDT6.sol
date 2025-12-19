// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title TestUSD - 可增发的测试USD代币
 * @dev 用于测试环境的USD代币，支持管理员增发和销毁
 */
contract TestUSDT6 is ERC20, AccessControl {
    // 角色定义
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    
    // 事件定义
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);
    
    // 错误定义
    error InvalidAmount();
    error InsufficientBalance();
    
    /**
     * @dev 构造函数
     */
    constructor(

    ) ERC20("Test USDT 6", "TUSDT6") {
        // 设置角色
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(BURNER_ROLE, msg.sender);
        
        // 铸造初始供应量给管理员

        _mint(msg.sender, 100000000 ether);
    }
    
    /**
     * @dev 重写 decimals 函数，返回 6 位小数（与 BSC USDT 一致）
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    
    /**
     * @dev 铸造新代币
     * @param to 接收地址
     * @param amount 铸造数量
     */
    function mint(address to, uint256 amount) 
        external 
        onlyRole(MINTER_ROLE) 
    {
        if (amount == 0) revert InvalidAmount();
        
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }
    
    /**
     * @dev 销毁代币
     * @param from 销毁地址
     * @param amount 销毁数量
     */
    function burn(address from, uint256 amount) 
        external 
        onlyRole(BURNER_ROLE) 
    {
        if (amount == 0) revert InvalidAmount();
        if (balanceOf(from) < amount) revert InsufficientBalance();
        
        _burn(from, amount);
        emit TokensBurned(from, amount);
    }
    
    /**
     * @dev 批量铸造代币
     * @param recipients 接收地址数组
     * @param amounts 对应数量数组
     */
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) 
        external 
        onlyRole(MINTER_ROLE) 
    {
        if (recipients.length != amounts.length) revert InvalidAmount();
        
        for (uint256 i = 0; i < recipients.length; i++) {
            if (amounts[i] == 0) revert InvalidAmount();
            _mint(recipients[i], amounts[i]);
            emit TokensMinted(recipients[i], amounts[i]);
        }
    }
    
    /**
     * @dev 获取代币信息
     * @return tokenName 代币名称
     * @return tokenSymbol 代币符号
     * @return tokenDecimals 小数位数
     * @return tokenTotalSupply 总供应量
     */
    function getTokenInfo() external view returns (
        string memory tokenName,
        string memory tokenSymbol,
        uint8 tokenDecimals,
        uint256 tokenTotalSupply
    ) {
        return (this.name(), this.symbol(), this.decimals(), this.totalSupply());
    }
}
