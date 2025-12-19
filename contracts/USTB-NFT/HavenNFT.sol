// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title HavenNFT - Standard ERC721 NFT Contract
 * @dev A standard ERC721 NFT contract with enumerable extension, ownership, and pause functionality
 * @notice Allows minting NFTs with configurable metadata URI
 */
contract HavenNFT is 
    ERC721, 
    ERC721Enumerable, 
    Ownable, 
    Pausable, 
    ReentrancyGuard 
{
    // ========== State Variables ==========
    
    uint256 private _tokenIdCounter;
    uint256 public maxSupply;
    
    // Token metadata
    string private _baseTokenURI;
    string private _metaFile;
    string public contractURI; // Contract-level metadata
    
    // Purchase configuration
    address public usdtToken; // USDT token address
    uint256 public price; // Price per NFT in USDT (considering USDT decimals)
    address public treasury; // Address to receive USDT payments
    bool public purchaseEnabled; // Whether purchase is enabled
    
    // NFT metadata

    // ========== Events ==========
    
    event NFTMinted(address indexed to, uint256 indexed tokenId);
    event BaseURIUpdated(string newBaseURI);
    event ContractURIUpdated(string newContractURI);
    event MaxSupplyUpdated(uint256 oldMaxSupply, uint256 newMaxSupply);
    event NFTPurchased(address indexed buyer, uint256 indexed tokenId, uint256 price);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event USDTTokenUpdated(address indexed oldToken, address indexed newToken);
    event PurchaseEnabledUpdated(bool enabled);
    event MetaFileUpdated(string oldMetaFile, string newMetaFile);
    
    // ========== Errors ==========
    
    error MaxSupplyReached();
    error InvalidAddress();
    error InvalidMaxSupply();
    error PurchaseDisabled();
    error InsufficientPayment();
    error PaymentFailed();
    error InvalidOwner();
    error EmptyMetaFile();
    
    // ========== Constructor ==========
    
    /**
     * @dev Constructor
     * @param _name NFT collection name
     * @param _symbol NFT collection symbol
     * @param _maxSupply Maximum number of NFTs that can be minted (0 for unlimited)
     * @param _treasury Address to receive USDT payments
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _maxSupply,
        address _treasury
    ) 
        ERC721(_name, _symbol) 
        Ownable(msg.sender)
    {
        require(_treasury != address(0), "Invalid treasury address");
        
        maxSupply = _maxSupply;
        _baseTokenURI = "https://coral-delicate-basilisk-291.mypinata.cloud/ipfs/";
        usdtToken = 0x55d398326f99059fF775485246999027B3197955;
        price = 100 ether;
        treasury = _treasury;
        purchaseEnabled = false; // Disabled by default, owner can enable later
        _tokenIdCounter = 1; // Start from token ID 1
    }
    
    // ========== Public Functions ==========
    
    /**
     * @dev Mint a new NFT (only owner)
     * @param to Address to receive the NFT
     * @return tokenId The ID of the newly minted token
     */
    function mint(address to) 
        external 
        onlyOwner 
        whenNotPaused 
        returns (uint256 tokenId)
    {
        if (maxSupply > 0 && _tokenIdCounter > maxSupply) revert MaxSupplyReached();
        if (to == address(0)) revert InvalidAddress();
        
        tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        
        _safeMint(to, tokenId);
        
        emit NFTMinted(to, tokenId);
        return tokenId;
    }
    
    /**
     * @dev Batch mint multiple NFTs (only owner)
     * @param to Address to receive the NFTs
     * @param quantity Number of NFTs to mint
     * @return tokenIds Array of minted token IDs
     */
    function batchMint(address to, uint256 quantity) 
        external 
        onlyOwner 
        whenNotPaused 
        returns (uint256[] memory tokenIds)
    {
        if (to == address(0)) revert InvalidAddress();
        if (quantity == 0 || quantity > 250) revert InvalidMaxSupply();
        if (maxSupply > 0 && _tokenIdCounter + quantity - 1 > maxSupply) revert MaxSupplyReached();
        
        tokenIds = new uint256[](quantity);
        
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _tokenIdCounter;
            _tokenIdCounter++;
            
            _safeMint(to, tokenId);
            tokenIds[i] = tokenId;
            
            emit NFTMinted(to, tokenId);
        }
        
        return tokenIds;
    }
    
    /**
     * @dev Purchase NFT with USDT
     * @notice User pays USDT to mint and receive an NFT
     * @return tokenId The ID of the newly minted token
     */
    function purchaseWithUSDT() 
        external 
        whenNotPaused 
        nonReentrant 
        returns (uint256 tokenId)
    {
        if (!purchaseEnabled) revert PurchaseDisabled();
        if (maxSupply > 0 && _tokenIdCounter > maxSupply) revert MaxSupplyReached();
        
        // Check USDT balance and allowance
        IERC20 usdt = IERC20(usdtToken);
        if (usdt.balanceOf(msg.sender) < price) revert InsufficientPayment();
        if (usdt.allowance(msg.sender, address(this)) < price) revert InsufficientPayment();
        
        // Transfer USDT from user to treasury
        if (!usdt.transferFrom(msg.sender, treasury, price)) revert PaymentFailed();
        
        // Mint NFT to buyer
        tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        _safeMint(msg.sender, tokenId);
        
        emit NFTPurchased(msg.sender, tokenId, price);
        return tokenId;
    }
    
    /**
     * @dev Batch purchase NFTs with USDT
     * @param quantity Number of NFTs to purchase
     * @return tokenIds Array of minted token IDs
     */
    function purchaseWithUSDTBatch(uint256 quantity) 
        external 
        whenNotPaused 
        nonReentrant 
        returns (uint256[] memory tokenIds)
    {
        if (!purchaseEnabled) revert PurchaseDisabled();
        if (quantity == 0 || quantity > 250) revert InvalidMaxSupply();
        if (maxSupply > 0 && _tokenIdCounter + quantity - 1 > maxSupply) revert MaxSupplyReached();
        
        uint256 totalPrice = price * quantity;
        
        // Check USDT balance and allowance
        IERC20 usdt = IERC20(usdtToken);
        if (usdt.balanceOf(msg.sender) < totalPrice) revert InsufficientPayment();
        if (usdt.allowance(msg.sender, address(this)) < totalPrice) revert InsufficientPayment();
        
        // Transfer USDT from user to treasury
        if (!usdt.transferFrom(msg.sender, treasury, totalPrice)) revert PaymentFailed();
        
        // Mint NFTs to buyer
        tokenIds = new uint256[](quantity);
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = _tokenIdCounter;
            _tokenIdCounter++;
            _safeMint(msg.sender, tokenId);
            tokenIds[i] = tokenId;
            emit NFTPurchased(msg.sender, tokenId, price);
        }
        
        return tokenIds;
    }
    
    // ========== View Functions ==========
    
    /**
     * @dev Get the current token ID counter
     * @return Current token ID counter
     */
    function currentTokenId() external view returns (uint256) {
        return _tokenIdCounter;
    }
    
    /**
     * @dev Get the number of available NFTs
     * @return Number of available NFTs (0 if unlimited)
     */
    function availableSupply() external view returns (uint256) {
        if (maxSupply == 0) return type(uint256).max;
        return maxSupply - (_tokenIdCounter - 1);
    }
    
    /**
     * @dev Get the number of minted NFTs
     * @return Number of minted NFTs
     */
    function totalMinted() external view returns (uint256) {
        return _tokenIdCounter - 1;
    }
    
    /**
     * @dev Get the current price for purchasing an NFT
     * @return Current price in USDT
     */
    function getPrice() external view returns (uint256) {
        return price;
    }
    
    /**
     * @dev Check if purchase is currently enabled
     * @return True if purchase is enabled
     */
    function isPurchaseEnabled() external view returns (bool) {
        return purchaseEnabled;
    }
    
    /**
     * @dev Get all token IDs owned by a specific address
     * @param owner Address to query
     * @return tokenIds Array of token IDs owned by the address
     * @notice This function uses ERC721Enumerable, so it can be gas-intensive for users with many NFTs
     */
    function getOwnedTokens(address owner) public view returns (uint256[] memory tokenIds) {
        uint256 balance = balanceOf(owner);
        tokenIds = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return tokenIds;
    }
    
    /**
     * @dev Get the number of NFTs owned by an address
     * @param owner Address to query
     * @return Number of NFTs owned
     * @notice This is a convenience wrapper around balanceOf
     */
    function getOwnedCount(address owner) external view returns (uint256) {
        return balanceOf(owner);
    }

    /**
     * @dev Get metadata URIs for tokens owned by an address (with pagination)
     * @param owner Address to query
     * @param start Start index (inclusive, 0-based)
     * @param end End index (exclusive, 0-based)
     * @return metas Array of metadata URIs
     * @notice This function supports pagination to reduce Gas consumption
     * @notice Use start=0, end=balanceOf(owner) to get all tokens
     */
    function getOwnerTokensMeta(
        address owner,
        uint256 start,
        uint256 end
    ) public view returns (string[] memory) {
        if (owner == address(0)) revert InvalidOwner();
        uint256 balance = balanceOf(owner);
        
        // Validate indices
        if (start > end) revert InvalidMaxSupply();
        if (end > balance) {
            end = balance;
        }
        
        uint256 length = end - start;
        string[] memory metas = new string[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 index = start + i;
            metas[i] = tokenURI(tokenOfOwnerByIndex(owner, index));
        }

        return metas;
    }
    
    // ========== Owner Functions ==========
    
    /**
     * @dev Update the base token URI
     * @param newBaseTokenURI New base token URI
     */
    function setBaseURI(string memory newBaseTokenURI) external onlyOwner {
        _baseTokenURI = newBaseTokenURI;
        emit BaseURIUpdated(newBaseTokenURI);
    }
    
    /**
     * @dev Update the contract URI
     * @param newContractURI New contract URI
     */
    function setContractURI(string memory newContractURI) external onlyOwner {
        contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }
    
    /**
     * @dev Update the maximum supply
     * @param newMaxSupply New maximum supply (must be >= current minted count, 0 for unlimited)
     */
    function setMaxSupply(uint256 newMaxSupply) external onlyOwner {
        if (newMaxSupply > 0 && newMaxSupply < _tokenIdCounter - 1) {
            revert InvalidMaxSupply();
        }
        
        uint256 oldMaxSupply = maxSupply;
        maxSupply = newMaxSupply;
        emit MaxSupplyUpdated(oldMaxSupply, newMaxSupply);
    }
    
    /**
     * @dev Pause the contract
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Update the treasury address
     * @param newTreasury New treasury address to receive USDT payments
     */
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }


    
    /**
     * @dev Enable or disable purchase functionality
     * @param enabled Whether to enable purchase
     */
    function setPurchaseEnabled(bool enabled) external onlyOwner {
        purchaseEnabled = enabled;
        emit PurchaseEnabledUpdated(enabled);
    }

    // 设置 meta data
    function setMetaFile(
        string memory metaFile_
    ) external onlyOwner {
        if (bytes(metaFile_).length == 0) revert EmptyMetaFile();
        string memory oldMetaFile = _metaFile;
        _metaFile = metaFile_;
        emit MetaFileUpdated(oldMetaFile, metaFile_);
    }
    
    // ========== Override Functions ==========
    
    /**
     * @dev Returns the token URI for a given token ID
     * @notice All tokens share the same metadata file (_metaFile)
     * @notice This is intentional design - all NFTs have identical metadata
     * @param tokenId The token ID to query
     * @return The token URI string
     */
    function tokenURI(
        uint256 tokenId
    ) public view virtual override returns (string memory) {
        // Use OpenZeppelin's standard check - will revert if token doesn't exist
        ownerOf(tokenId);
        
        string memory baseURI = _baseURI();
        return
            bytes(baseURI).length != 0
                ? string(abi.encodePacked(baseURI, _metaFile))
                : "";
    }
    /**
     * @dev Override base URI
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
    
    /**
     * @dev Override to support both ERC721 and ERC721Enumerable
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }
    
    /**
     * @dev Override to support both ERC721 and ERC721Enumerable
     */
    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }
    
    /**
     * @dev Override supportsInterface to support both ERC721 and ERC721Enumerable
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
    
    /**
     * @dev Override transfer to add pause check
     */
    function transferFrom(address from, address to, uint256 tokenId) 
        public 
        override(ERC721, IERC721) 
        whenNotPaused 
    {
        super.transferFrom(from, to, tokenId);
    }
    
    /**
     * @dev Override safeTransferFrom to add pause check
     * @notice In OpenZeppelin v5, the version without data parameter automatically calls this version
     */
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data)
        public
        override(ERC721, IERC721)
        whenNotPaused
    {
        super.safeTransferFrom(from, to, tokenId, data);
    }
}
