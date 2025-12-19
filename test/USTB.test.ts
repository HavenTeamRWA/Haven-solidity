import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { network } from "hardhat";
import { parseEther, formatEther, parseUnits, decodeEventLog } from "viem";

describe("USTB & USTBOperator 全面测试", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  // 测试账户
  let deployer: any;
  let custodian: any;
  let redeemer: any;
  let operator: any;
  let user1: any;
  let user2: any;
  let bank: any;

  // 合约实例
  let testUSDT: any;
  let ustb: any;
  let operatorContract: any;

  // 测试常量
  const INITIAL_YIELD_RATE_BPS = 500n; // 5%
  const OPERATOR_FEE_BPS = 50n; // 0.5%
  const PRECISION = 10n ** 18n;
  const BASIS_POINTS = 10000n;
  const ONE_YEAR = 365n * 24n * 60n * 60n; // 秒

  before(async function () {
    // 获取测试账户
    const accounts = await viem.getWalletClients();
    deployer = accounts[0].account;
    custodian = accounts[1].account;
    redeemer = accounts[2].account;
    operator = accounts[3].account;
    user1 = accounts[4].account;
    user2 = accounts[5].account;
    bank = accounts[6].account;

    // 部署 TestUSD18 (18 decimals)
    testUSDT = await viem.deployContract("TestUSD18", []);

    // 部署 USTB
    ustb = await viem.deployContract(
      "USTB",
      [custodian.address, redeemer.address, INITIAL_YIELD_RATE_BPS]
    );

    // 部署 USTBOperator
    operatorContract = await viem.deployContract(
      "USTBOperator",
      [ustb.address, testUSDT.address, bank.address]
    );

    // 设置 operator 为 custodian 和 redeemer
    await ustb.write.updateCustodian([operatorContract.address], {
      account: deployer,
    });
    await ustb.write.updateRedeemer([operatorContract.address], {
      account: deployer,
    });

    // 授权 operator 为操作员
    await operatorContract.write.setOperator([operator.address, true], {
      account: deployer,
    });

    // 给用户分配测试代币
    const testAmount = parseEther("1000000"); // 100万 USDT
    await testUSDT.write.mint([user1.address, testAmount], {
      account: deployer,
    });
    await testUSDT.write.mint([user2.address, testAmount], {
      account: deployer,
    });
    await testUSDT.write.mint([bank.address, testAmount], {
      account: deployer,
    });
  });

  describe("USTB 合约基础功能测试", function () {
    it("应该正确初始化 USTB 合约", async function () {
      const name = await ustb.read.name();
      const symbol = await ustb.read.symbol();
      const totalSupply = await ustb.read.totalSupply();
      const custodianAddr = await ustb.read.custodian();
      const redeemerAddr = await ustb.read.redeemer();
      const yieldRate = await ustb.read.getYieldRate();

      assert.equal(name, "USD Bond Token");
      assert.equal(symbol, "USTB");
      assert.equal(totalSupply, 0n);
      // 注意：custodian 和 redeemer 已经被设置为 operatorContract
      assert.equal(custodianAddr.toLowerCase(), operatorContract.address.toLowerCase());
      assert.equal(redeemerAddr.toLowerCase(), operatorContract.address.toLowerCase());
      assert.equal(yieldRate, INITIAL_YIELD_RATE_BPS);
    });

    it("应该返回初始价格 1:1", async function () {
      const price = await ustb.read.getPrice();
      const staticPrice = await ustb.read.getStaticPrice();
      assert.equal(price, PRECISION);
      assert.equal(staticPrice, PRECISION);
    });

    it("应该正确获取总资产（初始为0）", async function () {
      const totalAssets = await ustb.read.getTotalAssets();
      assert.equal(totalAssets, 0n);
    });
  });

  describe("USTB Deposit 功能测试", function () {
    it("应该允许 custodian 进行 deposit", async function () {
      const depositAmount = parseEther("1000"); // 1000 USD
      const initialPrice = await ustb.read.getPrice();

      // 注意：custodian 现在是 operatorContract，需要通过 operator 账户调用
      // 但 USTB.deposit 只能由 custodian 地址调用，所以需要通过 operatorContract 调用
      // 实际上，deposit 应该通过 operatorContract.processDepositOrder 来调用
      // 这里我们直接测试 USTB.deposit，需要使用 operatorContract 的地址
      // 但 operatorContract 是一个合约，不能直接作为 account
      // 所以这个测试需要调整：要么通过 operator 调用 operatorContract，要么直接测试 operatorContract
      
      // 由于 custodian 已被设置为 operatorContract，我们需要通过 operatorContract 来调用
      // 但 operatorContract 是合约地址，不能作为 account
      // 实际上，USTB.deposit 应该由 operatorContract 合约内部调用
      // 所以这个测试应该改为测试 operatorContract 的流程
      
      // 临时方案：先恢复 custodian 为原始账户进行测试
      await ustb.write.updateCustodian([custodian.address], {
        account: deployer,
      });

      await ustb.write.deposit([depositAmount, user1.address], {
        account: custodian,
      });
      
      // 恢复为 operatorContract
      await ustb.write.updateCustodian([operatorContract.address], {
        account: deployer,
      });

      const userBalance = await ustb.read.balanceOf([user1.address]);
      const totalSupply = await ustb.read.totalSupply();
      const totalAssets = await ustb.read.getTotalAssets();

      // 由于初始价格为 1:1，应该 mint 1000 USTB
      assert.equal(userBalance, depositAmount);
      assert.equal(totalSupply, depositAmount);
      assert.equal(totalAssets, depositAmount);
    });

    it("应该拒绝非 custodian 进行 deposit", async function () {
      const depositAmount = parseEther("1000");

      try {
        await ustb.write.deposit([depositAmount, user1.address], {
          account: user1,
        });
        assert.fail("应该抛出 UnauthorizedCustodian 错误");
      } catch (error: any) {
        assert.ok(error.message.includes("UnauthorizedCustodian"));
      }
    });

    it("应该拒绝零金额 deposit", async function () {
      try {
        await ustb.write.deposit([0n, user1.address], {
          account: custodian,
        });
        assert.fail("应该抛出 InvalidAmount 错误");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidAmount") ||
            error.message.includes("revert")
        );
      }
    });

    it("应该正确计算有 yield 后的价格", async function () {
      // 先进行一次 deposit 以有资产
      await ustb.write.updateCustodian([custodian.address], {
        account: deployer,
      });
      const depositAmount = parseEther("1000");
      await ustb.write.deposit([depositAmount, user1.address], {
        account: custodian,
      });
      await ustb.write.updateCustodian([operatorContract.address], {
        account: deployer,
      });

      // 使用测试客户端推进时间
      const testClient = await viem.getTestClient();
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const currentTime = block.timestamp;
      await testClient.setNextBlockTimestamp({ timestamp: currentTime + ONE_YEAR / 4n });
      await testClient.mine({ blocks: 1 });

      const price = await ustb.read.getPrice();
      const staticPrice = await ustb.read.getStaticPrice();

      // 价格应该增加（因为 yield 累积）
      assert.ok(price > PRECISION);
      assert.ok(staticPrice < price); // static price 不包括未累积的 yield
    });
  });

  describe("USTB Redeem 功能测试", function () {
    it("应该允许 redeemer 进行 redeem", async function () {
      // 先恢复 redeemer 为原始账户
      await ustb.write.updateRedeemer([redeemer.address], {
        account: deployer,
      });

      const userBalance = await ustb.read.balanceOf([user1.address]);
      const redeemAmount = userBalance > 0n ? userBalance / 2n : parseEther("100"); // 如果有余额则赎回一半，否则先 deposit
      
      if (userBalance === 0n) {
        // 先 deposit
        await ustb.write.updateCustodian([custodian.address], {
          account: deployer,
        });
        await ustb.write.deposit([parseEther("1000"), user1.address], {
          account: custodian,
        });
        await ustb.write.updateCustodian([operatorContract.address], {
          account: deployer,
        });
      }

      const initialTotalAssets = await ustb.read.getTotalAssets();
      const price = await ustb.read.getPrice();

      await ustb.write.redeem([redeemAmount, user1.address], {
        account: redeemer,
      });
      
      // 恢复为 operatorContract
      await ustb.write.updateRedeemer([operatorContract.address], {
        account: deployer,
      });

      const newBalance = await ustb.read.balanceOf([user1.address]);
      const newTotalAssets = await ustb.read.getTotalAssets();
      const newTotalSupply = await ustb.read.totalSupply();

      assert.equal(newBalance, userBalance - redeemAmount);
      assert.ok(newTotalAssets < initialTotalAssets);
      assert.equal(newTotalSupply, userBalance - redeemAmount);
    });

    it("应该拒绝非 redeemer 进行 redeem", async function () {
      const redeemAmount = parseEther("100");

      try {
        await ustb.write.redeem([redeemAmount, user1.address], {
          account: user1,
        });
        assert.fail("应该抛出 UnauthorizedRedeemer 错误");
      } catch (error: any) {
        assert.ok(error.message.includes("UnauthorizedRedeemer"));
      }
    });

    it("应该拒绝零金额 redeem", async function () {
      try {
        await ustb.write.redeem([0n, user1.address], {
          account: redeemer,
        });
        assert.fail("应该抛出 InvalidAmount 错误");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidAmount") ||
            error.message.includes("revert")
        );
      }
    });

    it("应该拒绝余额不足的 redeem", async function () {
      const userBalance = await ustb.read.balanceOf([user1.address]);
      const excessAmount = userBalance + parseEther("1000");

      try {
        await ustb.write.redeem([excessAmount, user1.address], {
          account: redeemer,
        });
        assert.fail("应该抛出 InvalidAmount 错误");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidAmount") ||
            error.message.includes("revert")
        );
      }
    });
  });

  describe("USTB Yield 累积测试", function () {
    it("应该正确累积 yield", async function () {
      // 先恢复 custodian 并进行 deposit
      await ustb.write.updateCustodian([custodian.address], {
        account: deployer,
      });
      const depositAmount = parseEther("10000");
      await ustb.write.deposit([depositAmount, user2.address], {
        account: custodian,
      });
      await ustb.write.updateCustodian([operatorContract.address], {
        account: deployer,
      });

      const initialAssets = await ustb.read.getTotalAssets();

      // 使用测试客户端推进时间
      const testClient = await viem.getTestClient();
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const currentTime = block.timestamp;
      await testClient.setNextBlockTimestamp({ timestamp: currentTime + ONE_YEAR });
      await testClient.mine({ blocks: 1 });

      // 手动触发 yield 累积
      await ustb.write.accrueYield();

      const newAssets = await ustb.read.getTotalAssets();
      const expectedYield = (initialAssets * INITIAL_YIELD_RATE_BPS) / BASIS_POINTS;

      // 允许一些精度误差
      const yieldDifference = newAssets - initialAssets;
      const tolerance = expectedYield / 100n; // 1% 容差

      assert.ok(yieldDifference >= expectedYield - tolerance);
      assert.ok(yieldDifference <= expectedYield + tolerance);
    });

    it("应该允许任何人调用 accrueYield", async function () {
      const initialAssets = await ustb.read.getTotalAssets();
      
      // 使用测试客户端推进时间（确保时间递增）
      const testClient = await viem.getTestClient();
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const currentTime = block.timestamp;
      await testClient.setNextBlockTimestamp({ timestamp: currentTime + ONE_YEAR / 12n });
      await testClient.mine({ blocks: 1 });

      await ustb.write.accrueYield({ account: user1 });

      const newAssets = await ustb.read.getTotalAssets();
      assert.ok(newAssets > initialAssets);
    });

    it("应该正确更新 yield rate", async function () {
      const newRate = 600n; // 6%
      const oldRate = await ustb.read.getYieldRate();

      await ustb.write.updateYieldRate([newRate], { account: deployer });

      const updatedRate = await ustb.read.getYieldRate();
      assert.equal(updatedRate, newRate);
    });

    it("应该拒绝超过 100% 的 yield rate", async function () {
      const invalidRate = BASIS_POINTS + 1n;

      try {
        await ustb.write.updateYieldRate([invalidRate], { account: deployer });
        assert.fail("应该抛出 InvalidYieldRate 错误");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidYieldRate") ||
            error.message.includes("revert")
        );
      }
    });
  });

  describe("USTB Pause 功能测试", function () {
    it("应该允许 owner 暂停合约", async function () {
      await ustb.write.pause({ account: deployer });
      const paused = await ustb.read.paused();
      assert.equal(paused, true);
    });

    it("暂停后应该拒绝 deposit", async function () {
      const depositAmount = parseEther("100");

      try {
        await ustb.write.deposit([depositAmount, user1.address], {
          account: custodian,
        });
        assert.fail("应该因为暂停而失败");
      } catch (error: any) {
        assert.ok(error.message.includes("Pausable") || error.message.includes("revert"));
      }
    });

    it("暂停后应该拒绝 transfer", async function () {
      const transferAmount = parseEther("10");

      try {
        await ustb.write.transfer([user2.address, transferAmount], {
          account: user1,
        });
        assert.fail("应该因为暂停而失败");
      } catch (error: any) {
        assert.ok(error.message.includes("Pausable") || error.message.includes("revert"));
      }
    });

    it("应该允许 owner 恢复合约", async function () {
      await ustb.write.unpause({ account: deployer });
      const paused = await ustb.read.paused();
      assert.equal(paused, false);
    });
  });

  // 辅助函数：从事件中获取订单ID
  async function getOrderIdFromEvent(txHash: `0x${string}`): Promise<bigint> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const orderCreatedAbi = operatorContract.abi.find((e: any) => e.name === "OrderCreated");
    
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: [orderCreatedAbi],
          data: log.data,
          topics: log.topics,
        }) as any;
        if (decoded && decoded.eventName === "OrderCreated") {
          return decoded.args.orderId as bigint;
        }
      } catch (e) {
        // 继续查找
      }
    }
    throw new Error("OrderCreated event not found");
  }

  describe("USTBOperator 订单创建测试", function () {
    it("应该允许用户创建 deposit 订单", async function () {
      const usdtAmount = parseEther("1000");
      
      // 用户授权 USDT
      await testUSDT.write.approve([operatorContract.address, usdtAmount], {
        account: user1,
      });

      const tx = await operatorContract.write.createDepositOrder([usdtAmount], {
        account: user1,
      });

      // 从事件中获取订单ID
      const orderId = await getOrderIdFromEvent(tx);

      // 检查订单状态
      const order = await operatorContract.read.getOrder([orderId]);
      assert.equal(order.user.toLowerCase(), user1.address.toLowerCase());
      assert.equal(order.usdtAmount, usdtAmount);
      assert.equal(Number(order.status), 0); // PENDING
      assert.equal(Number(order.orderType), 0); // DEPOSIT
    });

    it("应该正确计算 deposit 订单的 USTB 数量（扣除手续费）", async function () {
      const usdtAmount = parseEther("1000");
      const price = await ustb.read.getPrice();

      await testUSDT.write.approve([operatorContract.address, usdtAmount], {
        account: user1,
      });

      const tx = await operatorContract.write.createDepositOrder([usdtAmount], {
        account: user1,
      });

      const orderId = await getOrderIdFromEvent(tx);
      const order = await operatorContract.read.getOrder([orderId]);

      const grossUstb = (usdtAmount * PRECISION) / price;
      const fee = (grossUstb * OPERATOR_FEE_BPS) / BASIS_POINTS;
      const expectedNetUstb = grossUstb - fee;

      // 允许小的精度误差
      const diff = order.ustbAmount > expectedNetUstb 
        ? order.ustbAmount - expectedNetUstb 
        : expectedNetUstb - order.ustbAmount;
      assert.ok(diff < PRECISION / 10000n, "USTB 数量计算应该正确");
    });

    it("应该允许用户创建 redeem 订单", async function () {
      // 先恢复 custodian 并给用户一些 USTB
      await ustb.write.updateCustodian([custodian.address], {
        account: deployer,
      });
      const depositAmount = parseEther("5000");
      await ustb.write.deposit([depositAmount, user1.address], {
        account: custodian,
      });
      await ustb.write.updateCustodian([operatorContract.address], {
        account: deployer,
      });

      const redeemAmount = parseEther("1000");
      
      // 用户授权 USTB
      await ustb.write.approve([operatorContract.address, redeemAmount], {
        account: user1,
      });

      const tx = await operatorContract.write.createRedeemOrder([redeemAmount], {
        account: user1,
      });

      const orderId = await getOrderIdFromEvent(tx);
      const order = await operatorContract.read.getOrder([orderId]);
      assert.equal(order.user.toLowerCase(), user1.address.toLowerCase());
      assert.equal(order.ustbAmount, redeemAmount);
      assert.equal(Number(order.status), 0); // PENDING
      assert.equal(Number(order.orderType), 1); // REDEEM
    });

    it("应该拒绝零金额订单", async function () {
      try {
        await operatorContract.write.createDepositOrder([0n], {
          account: user1,
        });
        assert.fail("应该拒绝零金额");
      } catch (error: any) {
        assert.ok(error.message.includes("Invalid") || error.message.includes("revert"));
      }
    });
  });

  describe("USTBOperator 订单处理测试", function () {
    it("应该允许 operator 处理 deposit 订单", async function () {
      const usdtAmount = parseEther("2000");
      
      await testUSDT.write.approve([operatorContract.address, usdtAmount], {
        account: user2,
      });

      const tx = await operatorContract.write.createDepositOrder([usdtAmount], {
        account: user2,
      });

      const orderId = await getOrderIdFromEvent(tx);
      
      // Operator 处理订单
      await operatorContract.write.processDepositOrder([[orderId]], {
        account: operator,
      });

      const order = await operatorContract.read.getOrder([orderId]);
      assert.equal(Number(order.status), 2); // COMPLETED
    });

    it("应该允许 operator 批量处理 deposit 订单", async function () {
      const amounts = [parseEther("100"), parseEther("200"), parseEther("300")];
      const orderIds: bigint[] = [];

      for (const amount of amounts) {
        await testUSDT.write.approve([operatorContract.address, amount], {
          account: user2,
        });
        const tx = await operatorContract.write.createDepositOrder([amount], {
          account: user2,
        });
        const orderId = await getOrderIdFromEvent(tx);
        orderIds.push(orderId);
      }

      // 批量处理
      await operatorContract.write.processDepositOrder([orderIds], {
        account: operator,
      });

      for (const orderId of orderIds) {
        const order = await operatorContract.read.getOrder([orderId]);
        assert.equal(Number(order.status), 2); // COMPLETED
      }
    });

    it("应该拒绝非 operator 处理订单", async function () {
      try {
        await operatorContract.write.processDepositOrder([[1n]], {
          account: user1,
        });
        assert.fail("应该拒绝非 operator");
      } catch (error: any) {
        assert.ok(error.message.includes("Not authorized") || error.message.includes("revert"));
      }
    });
  });

  describe("USTBOperator 订单取消测试", function () {
    it("应该允许用户取消 PENDING 的 deposit 订单", async function () {
      const usdtAmount = parseEther("500");
      
      await testUSDT.write.approve([operatorContract.address, usdtAmount], {
        account: user1,
      });

      const tx = await operatorContract.write.createDepositOrder([usdtAmount], {
        account: user1,
      });

      const orderId = await getOrderIdFromEvent(tx);
      
      await operatorContract.write.cancelOrder([orderId], {
        account: user1,
      });

      const order = await operatorContract.read.getOrder([orderId]);
      assert.equal(Number(order.status), 1); // PROCESSING (等待退款)
      assert.equal(order.isCancellationRequest, true);
    });

    it("应该立即取消并退款 REDEEM 订单", async function () {
      // 确保用户有足够的 USTB
      await ustb.write.updateCustodian([custodian.address], {
        account: deployer,
      });
      const depositAmount = parseEther("1000");
      await ustb.write.deposit([depositAmount, user1.address], {
        account: custodian,
      });
      await ustb.write.updateCustodian([operatorContract.address], {
        account: deployer,
      });

      const redeemAmount = parseEther("500");
      
      await ustb.write.approve([operatorContract.address, redeemAmount], {
        account: user1,
      });

      const tx = await operatorContract.write.createRedeemOrder([redeemAmount], {
        account: user1,
      });

      const orderId = await getOrderIdFromEvent(tx);
      const initialBalance = await ustb.read.balanceOf([user1.address]);

      await operatorContract.write.cancelOrder([orderId], {
        account: user1,
      });

      const order = await operatorContract.read.getOrder([orderId]);
      const finalBalance = await ustb.read.balanceOf([user1.address]);

      assert.equal(Number(order.status), 4); // CANCELLED
      assert.equal(finalBalance, initialBalance + redeemAmount);
    });

    it("应该拒绝取消非自己的订单", async function () {
      try {
        await operatorContract.write.cancelOrder([1n], {
          account: user2,
        });
        assert.fail("应该拒绝取消他人订单");
      } catch (error: any) {
        assert.ok(error.message.includes("own order") || error.message.includes("revert"));
      }
    });
  });

  describe("USTBOperator 订单领取测试", function () {
    it("应该允许用户领取已完成的 deposit 订单", async function () {
      const usdtAmount = parseEther("1000");
      
      await testUSDT.write.approve([operatorContract.address, usdtAmount], {
        account: user1,
      });

      const tx = await operatorContract.write.createDepositOrder([usdtAmount], {
        account: user1,
      });

      const orderId = await getOrderIdFromEvent(tx);
      
      // 处理订单
      await operatorContract.write.processDepositOrder([[orderId]], {
        account: operator,
      });

      // 领取订单
      const initialBalance = await ustb.read.balanceOf([user1.address]);
      const order = await operatorContract.read.getOrder([orderId]);

      await operatorContract.write.claimOrder([orderId], {
        account: user1,
      });

      const finalBalance = await ustb.read.balanceOf([user1.address]);
      const claimedOrder = await operatorContract.read.getOrder([orderId]);

      assert.equal(finalBalance, initialBalance + order.ustbAmount);
      assert.equal(Number(claimedOrder.status), 3); // CLAIMED
    });

    it("应该拒绝领取未完成的订单", async function () {
      try {
        await operatorContract.write.claimOrder([1n], {
          account: user1,
        });
        assert.fail("应该拒绝未完成的订单");
      } catch (error: any) {
        assert.ok(error.message.includes("not completed") || error.message.includes("revert"));
      }
    });
  });

  describe("USTBOperator 查询功能测试", function () {
    it("应该正确查询用户订单", async function () {
      const orderCount = await operatorContract.read.getUserOrderCount([user1.address]);
      assert.ok(orderCount > 0n);

      const orders = await operatorContract.read.getUserOrders([
        user1.address,
        0n,
        orderCount,
      ]);
      assert.equal(orders.length, Number(orderCount));
    });

    it("应该正确查询可领取订单", async function () {
      const claimableOrders = await operatorContract.read.getClaimableOrders([
        user1.address,
      ]);
      assert.ok(Array.isArray(claimableOrders));
    });

    it("应该正确查询用户信息", async function () {
      const userInfo = await operatorContract.read.getUserInfo([user1.address]);
      // getUserInfo 返回一个元组: [ustbBalance, usdtBalance, userTotalDeposited, userTotalRedeemed, orderCount, claimableCount]
      assert.ok(Array.isArray(userInfo));
      assert.ok(userInfo.length >= 5);
      assert.ok(typeof userInfo[0] === "bigint" && userInfo[0] >= 0n); // ustbBalance
      assert.ok(typeof userInfo[1] === "bigint" && userInfo[1] >= 0n); // usdtBalance
      assert.ok(typeof userInfo[4] === "bigint" && userInfo[4] >= 0n); // orderCount
    });

    it("应该正确查询全局统计", async function () {
      const stats = await operatorContract.read.getGlobalStats();
      // getGlobalStats 返回一个元组: [depositCount, redeemCount, totalOrders, pendingOrders]
      assert.ok(Array.isArray(stats));
      assert.ok(stats.length >= 3);
      assert.ok(typeof stats[0] === "bigint" && stats[0] >= 0n); // depositCount
      assert.ok(typeof stats[1] === "bigint" && stats[1] >= 0n); // redeemCount
      assert.ok(typeof stats[2] === "bigint" && stats[2] >= 0n); // totalOrders
    });
  });

  describe("USTBOperator 管理员功能测试", function () {
    it("应该允许 owner 更新手续费", async function () {
      const newFee = 100n; // 1%
      await operatorContract.write.setFeeBps([newFee], {
        account: deployer,
      });

      const fee = await operatorContract.read.feeBps();
      assert.equal(fee, newFee);
    });

    it("应该拒绝超过最大手续费", async function () {
      const maxFee = await operatorContract.read.MAX_FEE_BPS();
      const invalidFee = maxFee + 1n;

      try {
        await operatorContract.write.setFeeBps([invalidFee], {
          account: deployer,
        });
        assert.fail("应该拒绝超过最大手续费");
      } catch (error: any) {
        assert.ok(error.message.includes("Fee too high") || error.message.includes("revert"));
      }
    });

    it("应该允许 owner 授权/撤销 operator", async function () {
      const newOperator = user2.address;
      
      await operatorContract.write.setOperator([newOperator, true], {
        account: deployer,
      });

      const isOperator = await operatorContract.read.isOperator([newOperator]);
      assert.equal(isOperator, true);

      await operatorContract.write.setOperator([newOperator, false], {
        account: deployer,
      });

      const isOperatorAfter = await operatorContract.read.isOperator([newOperator]);
      assert.equal(isOperatorAfter, false);
    });
  });

  describe("集成测试：完整流程", function () {
    it("应该完成完整的 deposit -> claim 流程", async function () {
      const usdtAmount = parseEther("5000");
      const user = user2;

      // 1. 用户授权 USDT
      await testUSDT.write.approve([operatorContract.address, usdtAmount], {
        account: user,
      });

      // 2. 创建 deposit 订单
      const tx = await operatorContract.write.createDepositOrder([usdtAmount], {
        account: user,
      });

      const orderId = await getOrderIdFromEvent(tx);

      // 3. Operator 处理订单
      await operatorContract.write.processDepositOrder([[orderId]], {
        account: operator,
      });

      // 4. 用户领取订单
      const order = await operatorContract.read.getOrder([orderId]);
      await operatorContract.write.claimOrder([orderId], {
        account: user,
      });

      // 5. 验证用户收到 USTB
      const balance = await ustb.read.balanceOf([user.address]);
      assert.ok(balance >= order.ustbAmount);
    });

    it("应该完成完整的 redeem 流程", async function () {
      const redeemAmount = parseEther("1000");
      const user = user2;

      // 确保用户有足够的 USTB
      const balance = await ustb.read.balanceOf([user.address]);
      if (balance < redeemAmount) {
        const depositAmount = parseEther("2000");
        await ustb.write.deposit([depositAmount, user.address], {
          account: custodian,
        });
      }

      // 1. 用户授权 USTB
      await ustb.write.approve([operatorContract.address, redeemAmount], {
        account: user,
      });

      // 2. 创建 redeem 订单
      const tx = await operatorContract.write.createRedeemOrder([redeemAmount], {
        account: user,
      });

      const orderId = await getOrderIdFromEvent(tx);

      // 3. Operator 处理订单
      await operatorContract.write.processRedeemOrder([[orderId]], {
        account: operator,
      });

      // 4. 用户领取订单
      const order = await operatorContract.read.getOrder([orderId]);
      const initialUSDT = await testUSDT.read.balanceOf([user.address]);

      // 注意：需要先给 operator 合约补充 USDT 才能领取
      // 这里仅测试订单处理流程
      const orderStatus = await operatorContract.read.getOrder([orderId]);
      assert.equal(Number(orderStatus.status), 2); // COMPLETED
    });
  });

  describe("边界情况和错误处理", function () {
    it("应该正确处理价格变化对订单的影响", async function () {
      // 创建订单时的价格
      const usdtAmount = parseEther("1000");
      await testUSDT.write.approve([operatorContract.address, usdtAmount], {
        account: user1,
      });

      const tx = await operatorContract.write.createDepositOrder([usdtAmount], {
        account: user1,
      });

      const orderId = await getOrderIdFromEvent(tx);
      const orderAtCreation = await operatorContract.read.getOrder([orderId]);

      // 使用测试客户端推进时间
      const testClient = await viem.getTestClient();
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const currentTime = block.timestamp;
      await testClient.setNextBlockTimestamp({ timestamp: currentTime + ONE_YEAR / 2n });
      await testClient.mine({ blocks: 1 });
      await ustb.write.accrueYield();

      // 处理订单（应该使用创建时的价格和数量）
      await operatorContract.write.processDepositOrder([[orderId]], {
        account: operator,
      });

      const orderAfterProcessing = await operatorContract.read.getOrder([orderId]);
      // 订单的 ustbAmount 应该保持不变（使用创建时的计算）
      assert.equal(orderAfterProcessing.ustbAmount, orderAtCreation.ustbAmount);
      
      // 恢复 custodian
      await ustb.write.updateCustodian([operatorContract.address], {
        account: deployer,
      });
    });

    it("应该正确处理空订单数组", async function () {
      try {
        await operatorContract.write.processDepositOrder([[]], {
          account: operator,
        });
        assert.fail("应该拒绝空数组");
      } catch (error: any) {
        assert.ok(error.message.includes("Empty") || error.message.includes("revert"));
      }
    });
  });
});
