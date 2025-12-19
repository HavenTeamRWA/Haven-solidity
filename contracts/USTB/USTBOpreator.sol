// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./USTB.sol";

/**
 * @title USTBOperator - USD Bond Token Operator
 * @dev Bond-backed stablecoin operator similar to ONDO USDY
 * @notice Operator for accumulating token backed by short-term US government bonds and bank deposits
 */
contract USTBOperator is 
    Ownable, 
    Pausable, 
    ReentrancyGuard 
{
    // ========== Constants ==========
    uint256 public constant PRECISION_FACTOR = 1e18; // Precision factor, matches USTB.getPrice() precision (18 decimals)
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_BPS = 1000; // Maximum fee 10%
    uint256 public feeBps = 50; // Default 0.5%
    
    // ========== State Variables ==========
    enum OrderType {
        DEPOSIT,    // Deposit order
        REDEEM      // Redeem order
    }

    enum OrderStatus {
        PENDING,    // Pending
        PROCESSING, // Processing
        COMPLETED,  // Completed
        CLAIMED,    // Claimed
        CANCELLED   // Cancelled
    }

    enum OperationType {
        DEPOSIT,    // Deposit
        REDEEM      // Redeem
    }

    address public bank;                            // Bank address
    USTB public ustb;                              // USTB contract address
    IERC20 public usdt;                            // USDT contract address

    // Operator management
    mapping(address => bool) public operators;     // Authorized operators
    mapping(address => bool) public coreOperators; // Core operators

    // Statistics
    mapping(address => uint256) public totalDeposited;      // User total deposits
    mapping(address => uint256) public totalRedeemed;       // User total redemptions
    uint256 public totalDepositCount;                       // Total deposit count
    uint256 public totalRedeemCount;                        // Total redeem count

    // Order structure
    struct Order {
        uint256 id;              // Order ID
        address user;            // User address
        uint256 usdtAmount;      // USDT amount
        uint256 price;           // Price at creation
        uint256 ustbAmount;      // USTB token amount
        uint256 timestamp;       // Creation timestamp
        uint256 processedAt;     // Processing timestamp
        OrderType orderType;     // Order type
        OrderStatus status;      // Order status: 0: Pending, 1: Processing, 2: Completed, 3: Claimed, 4: Cancelled
        bool isCancellationRequest;  // Whether this is a cancellation request
    }

    // Order management
    uint256 public  maxOrders = 20;
    uint256 public orderCounter;                   // Order counter
    mapping(uint256 => Order) public orders;       // Order records
    mapping(address => uint256[]) public userOrders;  // User order records

    // Operation record structure (reserved for audit)
    struct OperationRecord {
        uint256 id;              // Operation ID
        address operator;        // Operator who executed the operation
        address user;            // User address
        uint256 usdtAmount;      // Amount
        uint256 price;           // Price at execution
        uint256 ustbMinted;      // Tokens minted (deposit)
        uint256 ustbBurned;      // Tokens burned (redeem)
        uint256 timestamp;       // Timestamp
        OperationType opType;    // Operation type
    }

    // Operation records (reserved for audit)
    uint256 public operationCounter;               // Operation counter
    mapping(uint256 => OperationRecord) public operations;  // Operation records
    mapping(address => uint256[]) public userOperations;    // User operation records

    
    // ========== Events ==========
    
    event USTBUpdated(address indexed oldUSTB, address indexed newUSTB);
    event USDTUpdated(address indexed oldUSDT, address indexed newUSDT);
    event OperatorAuthorized(address indexed operator, bool authorized);
    event CoreOperatorAuthorized(address indexed operator, bool authorized);
    
    // Order events
    event OrderCreated(
        uint256 indexed orderId,
        address indexed user,
        uint256 amount,
        uint256 price,
        uint256 tokensAmount,
        OrderType orderType
    );
    
    event OrderStatusUpdated(
        uint256 indexed orderId,
        OrderStatus oldStatus,
        OrderStatus newStatus,
        address indexed operator
    );
    
    event OrderCompleted(
        uint256 indexed orderId,
        address indexed user,
        uint256 amount,
        uint256 tokensAmount,
        OrderType orderType
    );
    
    event ClaimExecuted(
        address indexed user,
        uint256 indexed orderId,
        uint256 amount,
        OrderType orderType
    );
    
    event OrderCancelled(
        uint256 indexed orderId,
        address indexed user,
        address indexed cancelledBy,
        uint256 refundAmount,
        OrderType orderType
    );
    
    // Operation events (reserved for audit)
    // event DepositExecuted(
    //     uint256 indexed operationId,
    //     address indexed operator,
    //     address indexed user,
    //     uint256 amount,
    //     uint256 price,
    //     uint256 tokensMinted,
    //     string metadata
    // );
    
    // event RedeemExecuted(
    //     uint256 indexed operationId,
    //     address indexed operator,
    //     address indexed user,
    //     uint256 tokenAmount,
    //     uint256 price,
    //     uint256 usdAmount,
    //     string metadata
    // );
    event FeeBpsUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    
    // ========== Modifiers ==========
    
    modifier onlyOperator() {
        require(operators[msg.sender] || coreOperators[msg.sender], "Not authorized operator");
        _;
    }
    
    modifier onlyCoreOperator() {
        require(coreOperators[msg.sender], "Not core operator");
        _;
    }
    
    // ========== Initialization ==========
    
    constructor(
        address _ustb,
        address _usdt,
        address _bank
    )
        Ownable(msg.sender)
    {
        require(_ustb != address(0), "Invalid USTB address");
        require(_usdt != address(0), "Invalid USDT address");
        require(_bank != address(0), "Invalid bank address");
        operators[msg.sender] = true;
        coreOperators[msg.sender] = true;
        bank = _bank;
        
        ustb = USTB(_ustb);
        usdt = IERC20(_usdt);
        
        // Note: custodian and redeemer need to be set externally
        // because USTBOperator is not yet the owner of USTB at this point
    }
    // ==================== User Functions ====================
    
    /**
     * @dev User creates deposit order
     * @notice User transfers USDT to bank address and creates a pending deposit order
     * @notice Automatically accrues yield and gets latest price to calculate USTB amount to receive
     * @notice Fee is deducted from the USTB amount to receive
     * @notice Order needs to wait for operator processing after creation
     * @param usdtAmount USDT amount to deposit (18 decimal precision)
     * @return orderId Newly created order ID
     * @custom:require usdtAmount > 0
     * @custom:require User has approved sufficient USDT allowance
     */
    function createDepositOrder(
        uint256 usdtAmount
    ) 
        external 
        whenNotPaused 
        nonReentrant 
        returns (uint256 orderId)
    {
        require(usdtAmount > 120, "Invalid amount");
        
        // Check user's USDT balance
        require(usdt.balanceOf(msg.sender) >= usdtAmount, "Insufficient USDT balance");
        
        // Check user's USDT allowance to this contract
        require(usdt.allowance(msg.sender, address(this)) >= usdtAmount, "Insufficient USDT allowance");
        
        // Transfer USDT from user to bank
        usdt.transferFrom(msg.sender, bank, usdtAmount);
        
        // Accrue yield to ensure price is up to date
        ustb.accrueYield();
        
        // Get current price
        uint256 price = ustb.getPrice();
        
        // Calculate tokens to mint
        uint256 grossUstbAmount = (usdtAmount * PRECISION_FACTOR) / price;
        uint256 feeUstbAmount = (grossUstbAmount * feeBps) / BPS_DENOMINATOR;
        uint256 netUstbAmount = grossUstbAmount - feeUstbAmount;
        
        // Create order
        orderId = ++orderCounter;
        orders[orderId] = Order({
            id: orderId,
            user: msg.sender,
            usdtAmount: usdtAmount,
            price: price,
            ustbAmount: netUstbAmount,
            timestamp: block.timestamp,
            processedAt: 0,
            orderType: OrderType.DEPOSIT,
            status: OrderStatus.PENDING,
            isCancellationRequest: false
        });
        
        userOrders[msg.sender].push(orderId);
        
        emit OrderCreated(
            orderId,
            msg.sender,
            usdtAmount,
            price,
            netUstbAmount,
            OrderType.DEPOSIT
        );
    }
    
    /**
     * @dev User creates redeem order
     * @notice User transfers USTB to Operator contract and creates a pending redeem order
     * @notice Automatically accrues yield and gets latest price to calculate USDT amount to receive
     * @notice Fee is deducted from the USDT amount to receive
     * @notice Order needs to wait for operator processing after creation
     * @param tokenAmount USTB token amount to redeem (18 decimal precision)
     * @return orderId Newly created order ID
     * @custom:require tokenAmount > 0
     * @custom:require ustb.balanceOf(msg.sender) >= tokenAmount
     * @custom:require User has approved sufficient USTB allowance
     */
    function createRedeemOrder(
        uint256 tokenAmount
    ) 
        external 
        whenNotPaused 
        nonReentrant 
        returns (uint256 orderId)
    {
        require(tokenAmount > 100, "Invalid amount");
        require(ustb.balanceOf(msg.sender) >= tokenAmount, "Insufficient balance");
        
        // Check user's USTB allowance to this contract
        require(ustb.allowance(msg.sender, address(this)) >= tokenAmount, "Insufficient USTB allowance");
        
        // Transfer USTB from user to contract
        ustb.transferFrom(msg.sender, address(this), tokenAmount);
        
        // Accrue yield to ensure price is up to date
        ustb.accrueYield();
        
        // Get current price
        uint256 price = ustb.getPrice();
        
        // Calculate USDT amount to withdraw
        uint256 grossUsdtAmount = (tokenAmount * price) / PRECISION_FACTOR;
        uint256 feeUsdtAmount = (grossUsdtAmount * feeBps) / BPS_DENOMINATOR;
        uint256 netUsdtAmount = grossUsdtAmount - feeUsdtAmount;
        
        // Create order
        orderId = ++orderCounter;
        orders[orderId] = Order({
            id: orderId,
            user: msg.sender,
            usdtAmount: netUsdtAmount,
            price: price,
            ustbAmount: tokenAmount,
            timestamp: block.timestamp,
            processedAt: 0,
            orderType: OrderType.REDEEM,
            status: OrderStatus.PENDING,
            isCancellationRequest: false
        });
        
        userOrders[msg.sender].push(orderId);
        
        emit OrderCreated(
            orderId,
            msg.sender,
            netUsdtAmount,
            price,
            tokenAmount,
            OrderType.REDEEM
        );
    }
    
    /**
     * @dev User claims completed order
     * @notice User claims funds or tokens from completed order
     * @notice For deposit orders: transfers USTB tokens to user
     * @notice For redeem orders: transfers USDT to user
     * @notice Order status will be updated from COMPLETED to CLAIMED
     * @param orderId Order ID to claim
     * @custom:require order.user == msg.sender
     * @custom:require order.status == OrderStatus.COMPLETED
     */
    function claimOrder(uint256 orderId) external whenNotPaused nonReentrant {
        Order storage order = orders[orderId];
        require(order.user == msg.sender, "Not order owner");
        require(order.status == OrderStatus.COMPLETED, "Order not completed");

        // Update order status to claimed
        _updateOrderStatus(orderId, OrderStatus.CLAIMED);

        if (order.orderType == OrderType.DEPOSIT) {
            // Deposit order: transfer USTB to user
            require(ustb.balanceOf(address(this)) >= order.ustbAmount, "Insufficient USTB balance");
            ustb.transfer(msg.sender, order.ustbAmount);
        } else {
            // Redeem order: transfer USDT to user
            require(usdt.balanceOf(address(this)) >= order.usdtAmount, "Insufficient USDT balance");
            usdt.transfer(msg.sender, order.usdtAmount);
        }
        
        
        emit ClaimExecuted(
            msg.sender,
            orderId,
            order.orderType == OrderType.DEPOSIT ? order.ustbAmount : order.usdtAmount,
            order.orderType
        );
    }

    /**
     * @dev User cancels own order
     * @notice DEPOSIT orders: status updated to PROCESSING, waiting for admin to process refund
     * @notice REDEEM orders: immediately refund USTB to user, status updated to CANCELLED
     * @param orderId Order ID to cancel
     * @custom:require Order must exist (order.id == orderId && order.id > 0)
     * @custom:require Can only cancel own order (order.user == msg.sender)
     * @custom:require Order status must be PENDING
     */
    function cancelOrder(uint256 orderId) external whenNotPaused nonReentrant {
        Order storage order = orders[orderId];
        
        // Verify order exists
        require(order.id == orderId && order.id > 0, "Order does not exist");
        
        // Verify can only cancel own order
        require(order.user == msg.sender, "Can only cancel own order");
        
        // Verify order status (can only cancel PENDING orders)
        require(order.status == OrderStatus.PENDING, "Order cannot be cancelled");
        
        // Mark as cancellation request (required for both DEPOSIT and REDEEM orders)
        order.isCancellationRequest = true;
        
        if (order.orderType == OrderType.DEPOSIT) {
            // DEPOSIT order: update status to PROCESSING, waiting for admin to process refund
            _updateOrderStatus(orderId, OrderStatus.PROCESSING);
            
            emit OrderCancelled(
                orderId,
                order.user,
                msg.sender,
                order.usdtAmount,  // Refund amount
                OrderType.DEPOSIT
            );
        } else {
            // REDEEM order: immediately refund USTB to user, update status to CANCELLED
            require(
                ustb.balanceOf(address(this)) >= order.ustbAmount,
                "Insufficient USTB balance"
            );
            
            // Update order status to cancelled
            _updateOrderStatus(orderId, OrderStatus.CANCELLED);
            
            // Refund USTB to user
            ustb.transfer(order.user, order.ustbAmount);
            
            emit OrderCancelled(
                orderId,
                order.user,
                msg.sender,
                order.ustbAmount,  // Actual refund amount
                OrderType.REDEEM
            );
        }
    }
    
    // ==================== Operator Functions ====================
    
    /**
     * @dev Operator processes deposit orders (batch processing)
     * @notice Only authorized operators can call this function
     * @notice Batch processes multiple pending deposit orders
     * @notice For each order: update status to PROCESSING → call USTB.deposit() → update status to COMPLETED
     * @notice Records operation and updates statistics
     * @param orderIds Array of order IDs to process
     * @custom:require msg.sender is authorized operator
     * @custom:require orderIds.length > 0
     * @custom:require Each order status is PENDING
     * @custom:require Each order type is DEPOSIT
     */
    function processDepositOrder(
        uint256[] calldata orderIds
    ) 
        external 
        onlyOperator 
        whenNotPaused 
        nonReentrant 
    {
        require(orderIds.length > 0, "Empty order array");
        require(orderIds.length <= maxOrders, "Too many orders");
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            Order storage order = orders[orderId];
            require(order.status == OrderStatus.PENDING, "Order not pending");
            require(order.orderType == OrderType.DEPOSIT, "Not deposit order");
            
            
            // Update order status to processing
            _updateOrderStatus(orderId, OrderStatus.PROCESSING);
            
            // Use ustbAmount calculated at order creation, do not recalculate
            require(order.ustbAmount > 0, "Invalid tokens amount");
            
            // Update order information (do not update price and amount)
            order.processedAt = block.timestamp;
            
            // Call USTB contract to mint tokens to Operator contract
            // order.usdtAmount is USDT amount, equivalent to USD amount
            ustb.deposit(order.usdtAmount, address(this));
            
            // Update order status to completed
            _updateOrderStatus(orderId, OrderStatus.COMPLETED);
            _recordOperation(order.user, order.usdtAmount, order.price, order.ustbAmount, 0, OperationType.DEPOSIT);
            // Update statistics
            totalDeposited[order.user] += order.usdtAmount;
            totalDepositCount++;
            
            emit OrderCompleted(
                orderId,
                order.user,
                order.usdtAmount,
                order.ustbAmount,
                OrderType.DEPOSIT
            );
        }
    }
    
    /**
     * @dev Operator processes redeem orders (batch processing)
     * @notice Only authorized operators can call this function
     * @notice Batch processes multiple pending redeem orders
     * @notice For each order: update status to PROCESSING → call USTB.redeem() → update status to COMPLETED
     * @notice Records operation and updates statistics
     * @notice Note: USTB.redeem() only decreases total assets, actual USDT needs to be supplemented to Operator contract from bank or other sources
     * @param orderIds Array of order IDs to process
     * @custom:require msg.sender is authorized operator
     * @custom:require orderIds.length > 0
     * @custom:require Each order status is PENDING
     * @custom:require Each order type is REDEEM
     */
    function processRedeemOrder(
        uint256[] calldata orderIds
    ) 
        external 
        onlyOperator 
        whenNotPaused 
        nonReentrant 
    {
        require(orderIds.length > 0, "Empty order array");
        require(orderIds.length <= maxOrders, "Too many orders");
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            Order storage order = orders[orderId];
            require(order.status == OrderStatus.PENDING, "Order not pending");
            require(order.orderType == OrderType.REDEEM, "Not redeem order");
            
            // Update order status to processing
            _updateOrderStatus(orderId, OrderStatus.PROCESSING);
            
            // Use usdtAmount calculated at order creation, do not recalculate
            require(order.usdtAmount > 0, "Invalid amount");
            
            // Update order information (do not update price and amount)
            order.processedAt = block.timestamp;
            
            // Call USTB contract to burn tokens
            ustb.redeem(order.ustbAmount, address(this));
            
            // Update order status to completed
            _updateOrderStatus(orderId, OrderStatus.COMPLETED);
            _recordOperation(order.user, order.usdtAmount, order.price, 0, order.ustbAmount, OperationType.REDEEM);
            // Update statistics
            totalRedeemed[order.user] += order.usdtAmount;
            totalRedeemCount++;
            
            emit OrderCompleted(
                orderId,
                order.user,
                order.usdtAmount,
                order.ustbAmount,
                OrderType.REDEEM
            );
        }
    }
    
    /**
     * @dev Operator processes refund for cancelled DEPOSIT order
     * @notice Refunds USDT to user from Operator contract's USDT balance
     * @notice Order status updated from PROCESSING to CANCELLED
     * @param orderId Order ID to process
     * @custom:require Order must exist (order.id == orderId && order.id > 0)
     * @custom:require Order status must be PROCESSING
     * @custom:require Order type must be DEPOSIT
     * @custom:require Operator contract must have sufficient USDT balance
     */
    function processCancelOrder(uint256 orderId) external onlyOperator whenNotPaused nonReentrant {
        Order storage order = orders[orderId];
        
        // Verify order exists
        require(order.id == orderId && order.id > 0, "Order does not exist");
        
        // Verify order status (must be PROCESSING status DEPOSIT order)
        require(order.status == OrderStatus.PROCESSING, "Order is not in processing status");
        
        // Verify order type (only process DEPOSIT orders)
        require(order.orderType == OrderType.DEPOSIT, "Only DEPOSIT orders can be processed");
        
        // Verify it is a cancellation request
        require(order.isCancellationRequest, "Not a cancellation request");
        
        // Verify Operator contract USDT balance
        require(
            usdt.balanceOf(address(this)) >= order.usdtAmount,
            "Insufficient USDT balance"
        );
        
        // Refund USDT to user
        usdt.transfer(order.user, order.usdtAmount);
        
        // Update order status to CANCELLED (indicates refund completed)
        _updateOrderStatus(orderId, OrderStatus.CANCELLED);
    }
    
    // ========== Internal Functions ==========
    
    /**
     * @dev Validate if order status transition is valid
     * @notice Defines valid order status transition rules:
     * @notice - PENDING → PROCESSING: Operator starts processing order, or user cancels DEPOSIT order
     * @notice - PENDING → CANCELLED: User cancels REDEEM order
     * @notice - PROCESSING → COMPLETED: Operator completes processing
     * @notice - PROCESSING → CANCELLED: Operator processes refund for cancelled DEPOSIT order
     * @notice - COMPLETED → CLAIMED: User claims order
     * @notice - CLAIMED and CANCELLED are terminal states, cannot transition to other states
     * @param from Current order status
     * @param to Target order status
     * @return Returns true if status transition is valid, otherwise false
     */
    function _isValidStatusTransition(OrderStatus from, OrderStatus to) internal pure returns (bool) {
        // Same status transition (allowed, though usually not needed)
        if (from == to) {
            return true;
        }
        
        // From PENDING status can transition to:
        // - PROCESSING: Operator starts processing order
        // - CANCELLED: User cancels order
        if (from == OrderStatus.PENDING) {
            return to == OrderStatus.PROCESSING || to == OrderStatus.CANCELLED;
        }
        
        // From PROCESSING status can transition to:
        // - COMPLETED: Operator completes processing
        // - CANCELLED: Operator processes refund for cancelled order
        // Note: Cannot transition from PROCESSING back to PENDING
        if (from == OrderStatus.PROCESSING) {
            return to == OrderStatus.COMPLETED || to == OrderStatus.CANCELLED;
        }
        
        // From COMPLETED status can transition to:
        // - CLAIMED: User claims order
        if (from == OrderStatus.COMPLETED) {
            return to == OrderStatus.CLAIMED;
        }
        
        // From CLAIMED and CANCELLED status cannot transition to any other state (terminal states)
        if (from == OrderStatus.CLAIMED || from == OrderStatus.CANCELLED) {
            return false;
        }
        
        // All other undefined status transitions are not allowed
        return false;
    }
    
    /**
     * @dev Update order status
     * @notice Validates status transition before updating
     * @notice If status transition is invalid, reverts with error message
     * @notice Emits OrderStatusUpdated event
     * @param orderId Order ID to update
     * @param newStatus New order status
     * @custom:require _isValidStatusTransition(oldStatus, newStatus) == true
     */
    function _updateOrderStatus(uint256 orderId, OrderStatus newStatus) internal {
        Order storage order = orders[orderId];
        OrderStatus oldStatus = order.status;
        
        // Validate status transition
        require(_isValidStatusTransition(oldStatus, newStatus), "Invalid status transition");
        
        order.status = newStatus;
        
        emit OrderStatusUpdated(orderId, oldStatus, newStatus, msg.sender);
    }
    
    /**
     * @dev Record operation (reserved for audit)
     * @notice Creates an operation record and saves it to operations mapping
     * @notice Also adds operation ID to user's userOperations array
     * @param user User address who executed the operation
     * @param usdtAmount USDT amount (for deposit orders) or USDT amount to withdraw (for redeem orders)
     * @param price USTB price at operation execution
     * @param ustbMinted USTB tokens minted (deposit operation, 0 for redeem)
     * @param ustbBurned USTB tokens burned (redeem operation, 0 for deposit)
     * @param opType Operation type (DEPOSIT or REDEEM)
     * @return operationId Newly created operation record ID
     */
    function _recordOperation(
        address user,
        uint256 usdtAmount,
        uint256 price,
        uint256 ustbMinted,
        uint256 ustbBurned,
        OperationType opType

    ) internal returns (uint256 operationId) {
        operationId = ++operationCounter;
        
        operations[operationId] = OperationRecord({
            id: operationId,
            operator: msg.sender,
            user: user,
            usdtAmount: usdtAmount,
            price: price,
            ustbMinted: ustbMinted,
            ustbBurned: ustbBurned,
            timestamp: block.timestamp,
            opType: opType
        });
        
        userOperations[user].push(operationId);
    }
    
    // ==================== Admin Functions ====================
    
    /**
     * @dev Update USTB contract address
     * @param _ustb USTB contract address
     */
    function updateUSTB(address _ustb) external onlyOwner {
        require(_ustb != address(0), "Invalid address");
        address oldUSTB = address(ustb);
        ustb = USTB(_ustb);
        
        // Update USTB's Custodian and Redeemer
        // ustb.updateCustodian(address(this));
        // ustb.updateRedeemer(address(this));
        
        emit USTBUpdated(oldUSTB, _ustb);
    }
    
    /**
     * @dev Update USDT contract address
     * @param _usdt USDT contract address
     */
    function updateUSDT(address _usdt) external onlyOwner {
        require(_usdt != address(0), "Invalid address");
        address oldUSDT = address(usdt);
        usdt = IERC20(_usdt);
        emit USDTUpdated(oldUSDT, _usdt);
    }

    /**
     * @dev Authorize/unauthorize operator
     * @param operator Operator address
     * @param authorized Whether to authorize
     */
    function setOperator(address operator, bool authorized) external onlyOwner {
        require(operator != address(0), "Invalid address");
        operators[operator] = authorized;
        emit OperatorAuthorized(operator, authorized);
    }
    
    /**
     * @dev Authorize/unauthorize core operator
     * @param operator Operator address
     * @param authorized Whether to authorize
     */
    function setCoreOperator(address operator, bool authorized) external onlyOwner {
        require(operator != address(0), "Invalid address");
        coreOperators[operator] = authorized;
        emit CoreOperatorAuthorized(operator, authorized);
    }

    /**
     * @dev Update fee
     * @param newFeeBps New fee (basis points)
     */
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "Fee too high");
        uint256 oldFeeBps = feeBps;
        feeBps = newFeeBps;
        emit FeeBpsUpdated(oldFeeBps, newFeeBps);
    }

    /**
     * @dev Update max orders
     * @param newMaxOrders New max orders
     */
    function setMaxOrders(uint256 newMaxOrders) external onlyOwner {
        require(newMaxOrders > 0, "Invalid max orders");
        maxOrders = newMaxOrders;
    }
    /**
     * @dev Update bank address
     * @param newBank New bank address
     */
    function setBank(address newBank) external onlyOwner {
        require(newBank != address(0), "Invalid address");
        bank = newBank;
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
    
    // ==================== Query Functions ====================
    
    /**
     * @dev Get order information
     * @param orderId Order ID
     * @return Order information
     */
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }
    
    /**
     * @dev Get user's order count
     * @param user User address
     * @return Order count
     */
    function getUserOrderCount(address user) external view returns (uint256) {
        return userOrders[user].length;
    }
    
    /**
     * @dev Get user's orders with pagination
     * @param user User address
     * @param start Start index
     * @param end End index (exclusive)
     * @return Order array
     */
    function getUserOrders(
        address user,
        uint256 start,
        uint256 end
    ) external view returns (Order[] memory) {
        require(start < end, "Invalid range");
        require(end <= userOrders[user].length, "End out of bounds");
        
        uint256 length = end - start;
        Order[] memory results = new Order[](length);
        
        for (uint256 i = 0; i < length; i++) {
            results[i] = orders[userOrders[user][start + i]];
        }
        
        return results;
    }
    
    /**
     * @dev Get user's claimable orders
     * @param user User address
     * @return Array of claimable order IDs
     */
    function getClaimableOrders(address user) external view returns (uint256[] memory) {
        uint256[] memory userOrderIds = userOrders[user];
        uint256 claimableCount = 0;
        
        // Count claimable orders
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            if (orders[userOrderIds[i]].status == OrderStatus.COMPLETED) {
                claimableCount++;
            }
        }
        
        // Create result array
        uint256[] memory claimableOrders = new uint256[](claimableCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            if (orders[userOrderIds[i]].status == OrderStatus.COMPLETED) {
                claimableOrders[index] = userOrderIds[i];
                index++;
            }
        }
        
        return claimableOrders;
    }
    
    /**
     * @dev Get user information
     * @param user User address
     * @return ustbBalance USTB balance
     * @return usdtBalance USDT balance
     * @return userTotalDeposited Total deposits
     * @return userTotalRedeemed Total redemptions
     * @return orderCount Order count
     * @return claimableCount Claimable order count
     */
    function getUserInfo(address user) 
        external 
        view 
        returns (
            uint256 ustbBalance,
            uint256 usdtBalance,
            uint256 userTotalDeposited,
            uint256 userTotalRedeemed,
            uint256 orderCount,
            uint256 claimableCount
        ) 
    {
        ustbBalance = ustb.balanceOf(user);
        usdtBalance = usdt.balanceOf(user);
        userTotalDeposited = totalDeposited[user];
        userTotalRedeemed = totalRedeemed[user];
        orderCount = userOrders[user].length;
        
        // Count claimable orders
        uint256[] memory userOrderIds = userOrders[user];
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            if (orders[userOrderIds[i]].status == OrderStatus.COMPLETED) {
                claimableCount++;
            }
        }
    }
    
    /**
     * @dev Get current price (includes accrued yield preview)
     * @return Current USTB price (includes latest yield)
     */
    function getCurrentPrice() external view returns (uint256) {
        return ustb.getPrice();
    }
    
    /**
     * @dev Get static price (does not include unaccrued yield)
     * @return Static USTB price (does not include latest yield)
     */
    function getCurrentStatic() external view returns (uint256) {
        return ustb.getStaticPrice();
    }
    
    /**
     * @dev Get list of cancelled DEPOSIT order IDs pending refund
     * @notice Returns all order IDs with PROCESSING status and DEPOSIT type (user has requested cancellation, waiting for admin to process refund)
     * @return Array of order IDs pending refund
     */
    function getPendingRefundOrders() external view returns (uint256[] memory) {
        uint256[] memory pendingOrders = new uint256[](orderCounter);
        uint256 count = 0;
        
        // Iterate through all orders to find pending refund orders (PROCESSING status DEPOSIT orders that are cancellation requests)
        for (uint256 i = 1; i <= orderCounter; i++) {
            Order storage order = orders[i];
            if (order.id == i &&
                order.status == OrderStatus.PROCESSING &&
                order.orderType == OrderType.DEPOSIT &&
                order.isCancellationRequest) {
                pendingOrders[count] = i;
                count++;
            }
        }
        
        // Resize array
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = pendingOrders[i];
        }
        
        return result;
    }
    
    /**
     * @dev Check if order can be cancelled
     * @notice Checks if order exists, belongs to caller, and status allows cancellation
     * @notice Can only cancel PENDING status orders
     * @param orderId Order ID to check
     * @return Returns true if order can be cancelled, otherwise false
     */
    function canCancelOrder(uint256 orderId) external view returns (bool) {
        Order storage order = orders[orderId];
        
        // Check if order exists
        if (order.id != orderId || order.id == 0) {
            return false;
        }
        
        // Check if can only cancel own order
        if (order.user != msg.sender) {
            return false;
        }
        
        // Check order status (can only cancel PENDING status orders)
        if (order.status != OrderStatus.PENDING) {
            return false;
        }
        
        return true;
    }
    
    /**
     * @dev Get global statistics
     * @return depositCount Total deposit count
     * @return redeemCount Total redeem count
     * @return totalOrders Total order count
     * @return pendingOrders Pending order count
     */
    function getGlobalStats() 
        external 
        view 
        returns (
            uint256 depositCount,
            uint256 redeemCount,
            uint256 totalOrders,
            uint256 pendingOrders
        ) 
    {
        depositCount = totalDepositCount;
        redeemCount = totalRedeemCount;
        totalOrders = orderCounter;
        
        // Count pending orders
        for (uint256 i = 1; i <= orderCounter; i++) {
            if (orders[i].status == OrderStatus.PENDING) {
                pendingOrders++;
            }
        }
    }
    
    /**
     * @dev Check if address is an operator
     * @param operator Operator address
     * @return Whether the address is an operator
     */
    function isOperator(address operator) external view returns (bool) {
        return operators[operator] || coreOperators[operator];
    }
    
    /**
     * @dev Check if address is a core operator
     * @param operator Operator address
     * @return Whether the address is a core operator
     */
    function isCoreOperator(address operator) external view returns (bool) {
        return coreOperators[operator];
    }
    
    // ========== Operation Record Queries (Reserved for Audit) ==========
    
    /**
     * @dev Get operation record
     * @param operationId Operation ID
     * @return Operation record
     */
    function getOperation(uint256 operationId) external view returns (OperationRecord memory) {
        return operations[operationId];
    }
    
    /**
     * @dev Get user's operation record count
     * @param user User address
     * @return Operation record count
     */
    function getUserOperationCount(address user) external view returns (uint256) {
        return userOperations[user].length;
    }
    
    /**
     * @dev Get user's operation records with pagination
     * @param user User address
     * @param start Start index
     * @param end End index (exclusive)
     * @return Operation record array
     */
    function getUserOperations(
        address user,
        uint256 start,
        uint256 end
    ) external view returns (OperationRecord[] memory) {
        require(start < end, "Invalid range");
        require(end <= userOperations[user].length, "End out of bounds");
        
        uint256 length = end - start;
        OperationRecord[] memory results = new OperationRecord[](length);
        
        for (uint256 i = 0; i < length; i++) {
            results[i] = operations[userOperations[user][start + i]];
        }
        
        return results;
    }

    function getUserOrderIds(address user) external view returns (uint256[] memory pendingOrderIds, uint256[] memory processingOrderIds, uint256[] memory completedOrderIds, uint256[] memory claimedOrderIds, uint256[] memory cancelledOrderIds) {
        uint256[] memory userOrderIds = userOrders[user];
        
        // First count orders in each status
        uint256 pendingCount = 0;
        uint256 processingCount = 0;
        uint256 completedCount = 0;
        uint256 claimedCount = 0;
        uint256 cancelledCount = 0;
        
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            OrderStatus status = orders[userOrderIds[i]].status;
            if (status == OrderStatus.PENDING) {
                pendingCount++;
            } else if (status == OrderStatus.PROCESSING) {
                processingCount++;
            } else if (status == OrderStatus.COMPLETED) {
                completedCount++;
            } else if (status == OrderStatus.CLAIMED) {
                claimedCount++;
            } else if (status == OrderStatus.CANCELLED) {
                cancelledCount++;
            }
        }
        
        // Create arrays with correct sizes
        pendingOrderIds = new uint256[](pendingCount);
        processingOrderIds = new uint256[](processingCount);
        completedOrderIds = new uint256[](completedCount);
        claimedOrderIds = new uint256[](claimedCount);
        cancelledOrderIds = new uint256[](cancelledCount);
        
        // Fill arrays
        uint256 pendingIndex = 0;
        uint256 processingIndex = 0;
        uint256 completedIndex = 0;
        uint256 claimedIndex = 0;
        uint256 cancelledIndex = 0;
        
        for (uint256 i = 0; i < userOrderIds.length; i++) {
            OrderStatus status = orders[userOrderIds[i]].status;
            if (status == OrderStatus.PENDING) {
                pendingOrderIds[pendingIndex++] = userOrderIds[i];
            } else if (status == OrderStatus.PROCESSING) {
                processingOrderIds[processingIndex++] = userOrderIds[i];
            } else if (status == OrderStatus.COMPLETED) {
                completedOrderIds[completedIndex++] = userOrderIds[i];
            } else if (status == OrderStatus.CLAIMED) {
                claimedOrderIds[claimedIndex++] = userOrderIds[i];
            } else if (status == OrderStatus.CANCELLED) {
                cancelledOrderIds[cancelledIndex++] = userOrderIds[i];
            }
        }
    }
}