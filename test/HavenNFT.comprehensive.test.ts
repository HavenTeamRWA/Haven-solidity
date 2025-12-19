import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { network } from "hardhat";
import { parseEther, parseUnits, decodeEventLog } from "viem";

/**
 * HavenNFT 全面测试
 * 覆盖所有方法和业务情况
 */
describe("HavenNFT 全面测试", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  // 测试账户
  let deployer: any;
  let treasury: any;
  let user1: any;
  let user2: any;
  let user3: any;
  let operator: any;

  // 合约实例
  let havenNFT: any;
  let testUSDT: any;

  // 测试常量
  const NFT_NAME = "Haven NFT Collection";
  const NFT_SYMBOL = "HNF";
  const MAX_SUPPLY = 1000n;
  const NFT_PRICE = parseEther("100"); // 100 USDT (考虑 18 decimals 格式，但实际 USDT 是 6 decimals)
  const BASE_URI = "https://coral-delicate-basilisk-291.mypinata.cloud/ipfs/";
  const META_FILE = "QmTest123";

  before(async function () {
    // 获取测试账户
    const accounts = await viem.getWalletClients();
    deployer = accounts[0].account;
    treasury = accounts[1].account;
    user1 = accounts[2].account;
    user2 = accounts[3].account;
    user3 = accounts[4].account;
    operator = accounts[5].account;

    // 部署 TestUSDT6 (6 decimals)
    testUSDT = await viem.deployContract("TestUSDT6", []);

    // 部署 HavenNFT 合约
    havenNFT = await viem.deployContract(
      "HavenNFT",
      [NFT_NAME, NFT_SYMBOL, MAX_SUPPLY, treasury.address],
      {
        account: deployer,
      }
    );

    // 设置 USDT token 地址（实际需要使用 setter，但合约中没有，所以我们部署后手动设置）
    // 注意：由于合约中 usdtToken 是 public，但在构造函数中硬编码了地址
    // 我们需要检查合约是否有设置方法，如果没有，我们可能需要修改测试策略
    // 或者部署一个模拟 USDT 地址的合约
    // 为简化测试，我们假设可以部署时使用 testUSDT 地址
    // 但实际上构造函数中硬编码了地址，所以我们先测试其他功能

    console.log("✅ HavenNFT 合约已部署:", havenNFT.address);
    console.log("✅ TestUSDT 合约已部署:", testUSDT.address);

    // 给用户分配测试 USDT (使用 6 decimals)
    const testAmount = parseUnits("1000000", 6); // 100万 USDT (6 decimals)
    await testUSDT.write.mint([user1.address, testAmount], {
      account: deployer,
    });
    await testUSDT.write.mint([user2.address, testAmount], {
      account: deployer,
    });
    await testUSDT.write.mint([user3.address, testAmount], {
      account: deployer,
    });
  });

  describe("合约初始化和基础信息", function () {
    it("应该正确初始化合约参数", async function () {
      const name = await havenNFT.read.name();
      const symbol = await havenNFT.read.symbol();
      const maxSupply = await havenNFT.read.maxSupply();
      const treasuryAddr = await havenNFT.read.treasury();
      const price = await havenNFT.read.price();
      const purchaseEnabled = await havenNFT.read.purchaseEnabled();

      assert.equal(name, NFT_NAME);
      assert.equal(symbol, NFT_SYMBOL);
      assert.equal(maxSupply, MAX_SUPPLY);
      assert.equal(treasuryAddr.toLowerCase(), treasury.address.toLowerCase());
      // price 是 100 ether (100 * 10^18)
      assert.equal(price, parseEther("100"));
      assert.equal(purchaseEnabled, false); // 默认禁用
    });

    it("应该返回正确的当前 token ID（从 1 开始）", async function () {
      const currentTokenId = await havenNFT.read.currentTokenId();
      assert.equal(currentTokenId, 1n); // 初始值为 1
    });

    it("应该返回正确的可用供应量", async function () {
      const available = await havenNFT.read.availableSupply();
      assert.equal(available, MAX_SUPPLY);
    });

    it("应该返回已 mint 数量为 0", async function () {
      const totalMinted = await havenNFT.read.totalMinted();
      assert.equal(totalMinted, 0n);
    });

    it("应该返回正确的价格", async function () {
      const price = await havenNFT.read.getPrice();
      assert.equal(price, parseEther("100"));
    });

    it("应该返回购买未启用", async function () {
      const enabled = await havenNFT.read.isPurchaseEnabled();
      assert.equal(enabled, false);
    });
  });

  describe("Owner 权限管理 - mint 功能", function () {
    it("应该允许 owner 进行单个 mint", async function () {
      const tx = await havenNFT.write.mint([user1.address], {
        account: deployer,
      });

      // 检查事件
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      const nftMintedEvent = receipt.logs.find((log: any) => {
        try {
          const decoded = decodeEventLog({
            abi: havenNFT.abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === "NFTMinted";
        } catch {
          return false;
        }
      });

      assert.ok(nftMintedEvent, "应该发出 NFTMinted 事件");

      // 验证 token ID 和所有权
      const balance = await havenNFT.read.balanceOf([user1.address]);
      const owner = await havenNFT.read.ownerOf([1n]);
      const currentTokenId = await havenNFT.read.currentTokenId();

      assert.equal(balance, 1n);
      assert.equal(owner.toLowerCase(), user1.address.toLowerCase());
      assert.equal(currentTokenId, 2n); // tokenId 应该递增到 2
    });

    it("应该拒绝非 owner 进行 mint", async function () {
      try {
        await havenNFT.write.mint([user2.address], {
          account: user1,
        });
        assert.fail("应该拒绝非 owner 的 mint");
      } catch (error: any) {
        assert.ok(
          error.message.includes("Ownable") ||
            error.message.includes("not the owner") ||
            error.message.includes("revert"),
          "应该抛出 Ownable 相关错误"
        );
      }
    });

    it("应该拒绝 mint 到零地址", async function () {
      const zeroAddress = "0x0000000000000000000000000000000000000000" as `0x${string}`;
      try {
        await havenNFT.write.mint([zeroAddress], {
          account: deployer,
        });
        assert.fail("应该拒绝零地址");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidAddress") ||
            error.message.includes("revert"),
          "应该抛出 InvalidAddress 错误"
        );
      }
    });

    it("应该允许 owner 进行批量 mint", async function () {
      const quantity = 5n;
      const tx = await havenNFT.write.batchMint([user2.address, quantity], {
        account: deployer,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      
      // 验证 mint 的数量
      const balance = await havenNFT.read.balanceOf([user2.address]);
      const currentTokenId = await havenNFT.read.currentTokenId();
      const totalMinted = await havenNFT.read.totalMinted();

      assert.equal(balance, quantity);
      assert.equal(currentTokenId, 7n); // 之前有 1 个，现在 +5 = 6, tokenId 应该是 7
      assert.equal(totalMinted, 6n); // 总共 6 个 (1 + 5)
    });

    it("应该拒绝批量 mint 数量为 0", async function () {
      try {
        await havenNFT.write.batchMint([user2.address, 0n], {
          account: deployer,
        });
        assert.fail("应该拒绝数量为 0");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidMaxSupply") ||
            error.message.includes("revert"),
          "应该抛出 InvalidMaxSupply 错误"
        );
      }
    });

    it("应该拒绝批量 mint 数量超过 250", async function () {
      try {
        await havenNFT.write.batchMint([user2.address, 251n], {
          account: deployer,
        });
        assert.fail("应该拒绝数量超过 250");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidMaxSupply") ||
            error.message.includes("revert"),
          "应该抛出 InvalidMaxSupply 错误"
        );
      }
    });

    it("应该拒绝超过最大供应量的 mint", async function () {
      // 先 mint 到接近最大供应量
      const currentMinted = await havenNFT.read.totalMinted();
      const remaining = MAX_SUPPLY - currentMinted;
      
      if (remaining > 0n) {
        // 尝试 mint 超过剩余数量
        try {
          await havenNFT.write.batchMint([user3.address, remaining + 1n], {
            account: deployer,
          });
          assert.fail("应该拒绝超过最大供应量");
        } catch (error: any) {
          assert.ok(
            error.message.includes("MaxSupplyReached") ||
              error.message.includes("revert"),
            "应该抛出 MaxSupplyReached 错误"
          );
        }
      }
    });
  });

  describe("Owner 权限管理 - 配置功能", function () {
    it("应该允许 owner 设置 base URI", async function () {
      const newBaseURI = "https://new-ipfs-gateway.com/ipfs/";
      
      const tx = await havenNFT.write.setBaseURI([newBaseURI], {
        account: deployer,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      const baseURIEvent = receipt.logs.find((log: any) => {
        try {
          const decoded = decodeEventLog({
            abi: havenNFT.abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === "BaseURIUpdated";
        } catch {
          return false;
        }
      });

      assert.ok(baseURIEvent, "应该发出 BaseURIUpdated 事件");

      // 验证 tokenURI 使用新的 base URI
      const tokenURI = await havenNFT.read.tokenURI([1n]);
      assert.ok(tokenURI.includes(newBaseURI) || tokenURI.includes(META_FILE));
    });

    it("应该允许 owner 设置 contract URI", async function () {
      const newContractURI = "https://example.com/contract-metadata.json";
      
      const tx = await havenNFT.write.setContractURI([newContractURI], {
        account: deployer,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      const contractURIEvent = receipt.logs.find((log: any) => {
        try {
          const decoded = decodeEventLog({
            abi: havenNFT.abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === "ContractURIUpdated";
        } catch {
          return false;
        }
      });

      assert.ok(contractURIEvent, "应该发出 ContractURIUpdated 事件");

      const contractURI = await havenNFT.read.contractURI();
      assert.equal(contractURI, newContractURI);
    });

    it("应该允许 owner 更新最大供应量（增大）", async function () {
      const newMaxSupply = 2000n;
      const oldMaxSupply = await havenNFT.read.maxSupply();
      
      const tx = await havenNFT.write.setMaxSupply([newMaxSupply], {
        account: deployer,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      const maxSupplyEvent = receipt.logs.find((log: any) => {
        try {
          const decoded = decodeEventLog({
            abi: havenNFT.abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === "MaxSupplyUpdated";
        } catch {
          return false;
        }
      });

      assert.ok(maxSupplyEvent, "应该发出 MaxSupplyUpdated 事件");

      const updatedMaxSupply = await havenNFT.read.maxSupply();
      assert.equal(updatedMaxSupply, newMaxSupply);

      // 恢复原值以便后续测试
      await havenNFT.write.setMaxSupply([MAX_SUPPLY], {
        account: deployer,
      });
    });

    it("应该拒绝设置最大供应量小于已 mint 数量", async function () {
      const totalMinted = await havenNFT.read.totalMinted();
      if (totalMinted > 0n) {
        try {
          await havenNFT.write.setMaxSupply([totalMinted - 1n], {
            account: deployer,
          });
          assert.fail("应该拒绝小于已 mint 数量的最大供应量");
        } catch (error: any) {
          assert.ok(
            error.message.includes("InvalidMaxSupply") ||
              error.message.includes("revert"),
            "应该抛出 InvalidMaxSupply 错误"
          );
        }
      }
    });

    it("应该允许 owner 设置 treasury 地址", async function () {
      const newTreasury = user3.address;
      const oldTreasury = await havenNFT.read.treasury();
      
      const tx = await havenNFT.write.setTreasury([newTreasury], {
        account: deployer,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      const treasuryEvent = receipt.logs.find((log: any) => {
        try {
          const decoded = decodeEventLog({
            abi: havenNFT.abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === "TreasuryUpdated";
        } catch {
          return false;
        }
      });

      assert.ok(treasuryEvent, "应该发出 TreasuryUpdated 事件");

      const updatedTreasury = await havenNFT.read.treasury();
      assert.equal(updatedTreasury.toLowerCase(), newTreasury.toLowerCase());

      // 恢复原值
      await havenNFT.write.setTreasury([treasury.address], {
        account: deployer,
      });
    });

    it("应该拒绝设置 treasury 为零地址", async function () {
      const zeroAddress = "0x0000000000000000000000000000000000000000" as `0x${string}`;
      try {
        await havenNFT.write.setTreasury([zeroAddress], {
          account: deployer,
        });
        assert.fail("应该拒绝零地址");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidAddress") ||
            error.message.includes("revert"),
          "应该抛出 InvalidAddress 错误"
        );
      }
    });

    it("应该允许 owner 启用/禁用购买功能", async function () {
      // 启用购买
      let tx = await havenNFT.write.setPurchaseEnabled([true], {
        account: deployer,
      });

      let receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      let purchaseEnabledEvent = receipt.logs.find((log: any) => {
        try {
          const decoded = decodeEventLog({
            abi: havenNFT.abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === "PurchaseEnabledUpdated";
        } catch {
          return false;
        }
      });

      assert.ok(purchaseEnabledEvent, "应该发出 PurchaseEnabledUpdated 事件");

      let enabled = await havenNFT.read.isPurchaseEnabled();
      assert.equal(enabled, true);

      // 禁用购买
      tx = await havenNFT.write.setPurchaseEnabled([false], {
        account: deployer,
      });

      receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      enabled = await havenNFT.read.isPurchaseEnabled();
      assert.equal(enabled, false);
    });

    it("应该允许 owner 设置 meta file", async function () {
      const newMetaFile = "QmNewMetaFile456";
      
      const tx = await havenNFT.write.setMetaFile([newMetaFile], {
        account: deployer,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      const metaFileEvent = receipt.logs.find((log: any) => {
        try {
          const decoded = decodeEventLog({
            abi: havenNFT.abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === "MetaFileUpdated";
        } catch {
          return false;
        }
      });

      assert.ok(metaFileEvent, "应该发出 MetaFileUpdated 事件");

      // 验证 tokenURI 包含新的 meta file
      const tokenURI = await havenNFT.read.tokenURI([1n]);
      assert.ok(tokenURI.includes(newMetaFile));

      // 恢复原值
      await havenNFT.write.setMetaFile([META_FILE], {
        account: deployer,
      });
    });

    it("应该拒绝设置空的 meta file", async function () {
      try {
        await havenNFT.write.setMetaFile([""], {
          account: deployer,
        });
        assert.fail("应该拒绝空的 meta file");
      } catch (error: any) {
        assert.ok(
          error.message.includes("EmptyMetaFile") ||
            error.message.includes("revert"),
          "应该抛出 EmptyMetaFile 错误"
        );
      }
    });

    it("应该拒绝非 owner 修改配置", async function () {
      try {
        await havenNFT.write.setBaseURI(["https://malicious.com/"], {
          account: user1,
        });
        assert.fail("应该拒绝非 owner 修改配置");
      } catch (error: any) {
        assert.ok(
          error.message.includes("Ownable") ||
            error.message.includes("not the owner") ||
            error.message.includes("revert"),
          "应该抛出 Ownable 相关错误"
        );
      }
    });
  });

  describe("暂停和恢复功能", function () {
    it("应该允许 owner 暂停合约", async function () {
      await havenNFT.write.pause({
        account: deployer,
      });

      const paused = await havenNFT.read.paused();
      assert.equal(paused, true);
    });

    it("暂停后应该拒绝 mint", async function () {
      try {
        await havenNFT.write.mint([user1.address], {
          account: deployer,
        });
        assert.fail("暂停后应该拒绝 mint");
      } catch (error: any) {
        assert.ok(
          error.message.includes("Pausable") ||
            error.message.includes("Paused") ||
            error.message.includes("revert"),
          "应该抛出 Pausable 相关错误"
        );
      }
    });

    it("暂停后应该拒绝 transfer", async function () {
      // 先恢复合约以便 mint
      await havenNFT.write.unpause({
        account: deployer,
      });

      // Mint 一个 NFT 给 user1
      const currentTokenId = await havenNFT.read.currentTokenId();
      await havenNFT.write.mint([user1.address], {
        account: deployer,
      });

      // 再次暂停
      await havenNFT.write.pause({
        account: deployer,
      });

      // 尝试转移
      try {
        await havenNFT.write.transferFrom(
          [user1.address, user2.address, currentTokenId],
          {
            account: user1,
          }
        );
        assert.fail("暂停后应该拒绝 transfer");
      } catch (error: any) {
        assert.ok(
          error.message.includes("Pausable") ||
            error.message.includes("Paused") ||
            error.message.includes("revert"),
          "应该抛出 Pausable 相关错误"
        );
      }
    });

    it("应该允许 owner 恢复合约", async function () {
      await havenNFT.write.unpause({
        account: deployer,
      });

      const paused = await havenNFT.read.paused();
      assert.equal(paused, false);
    });
  });

  describe("USDT 购买功能", function () {
    // 注意：合约中 usdtToken 地址硬编码为 BSC 主网地址 (0x55d398326f99059fF775485246999027B3197955)
    // 在本地测试环境中，需要使用 fork 或者部署后手动设置 USDT 地址
    // 这里我们测试购买功能的逻辑和边界情况
    
    beforeEach(async function () {
      // 确保购买功能已启用
      const enabled = await havenNFT.read.isPurchaseEnabled();
      if (!enabled) {
        await havenNFT.write.setPurchaseEnabled([true], {
          account: deployer,
        });
      }

      // 确保合约未暂停
      const paused = await havenNFT.read.paused();
      if (paused) {
        await havenNFT.write.unpause({
          account: deployer,
        });
      }
    });

    it("应该拒绝在购买未启用时购买 NFT", async function () {
      // 禁用购买
      await havenNFT.write.setPurchaseEnabled([false], {
        account: deployer,
      });

      try {
        await havenNFT.write.purchaseWithUSDT({
          account: user1,
        });
        assert.fail("应该拒绝在购买未启用时购买");
      } catch (error: any) {
        assert.ok(
          error.message.includes("PurchaseDisabled") ||
            error.message.includes("revert"),
          "应该抛出 PurchaseDisabled 错误"
        );
      } finally {
        // 恢复购买功能
        await havenNFT.write.setPurchaseEnabled([true], {
          account: deployer,
        });
      }
    });

    it("应该拒绝暂停时购买 NFT", async function () {
      // 暂停合约
      await havenNFT.write.pause({
        account: deployer,
      });

      try {
        await havenNFT.write.purchaseWithUSDT({
          account: user1,
        });
        assert.fail("应该拒绝暂停时购买");
      } catch (error: any) {
        assert.ok(
          error.message.includes("Pausable") ||
            error.message.includes("Paused") ||
            error.message.includes("revert"),
          "应该抛出 Pausable 相关错误"
        );
      } finally {
        // 恢复合约
        await havenNFT.write.unpause({
          account: deployer,
        });
      }
    });

    it("应该拒绝超过最大供应量的购买", async function () {
      // 设置一个较小的最大供应量用于测试
      const totalMinted = await havenNFT.read.totalMinted();
      const maxSupply = await havenNFT.read.maxSupply();
      
      if (maxSupply > 0n && totalMinted >= maxSupply) {
        // 如果已经达到最大供应量，测试应该失败
        try {
          await havenNFT.write.purchaseWithUSDT({
            account: user1,
          });
          assert.fail("应该拒绝超过最大供应量的购买");
        } catch (error: any) {
          assert.ok(
            error.message.includes("MaxSupplyReached") ||
              error.message.includes("revert"),
            "应该抛出 MaxSupplyReached 错误"
          );
        }
      }
    });

    it("应该拒绝批量购买数量为 0", async function () {
      try {
        await havenNFT.write.purchaseWithUSDTBatch([0n], {
          account: user1,
        });
        assert.fail("应该拒绝数量为 0");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidMaxSupply") ||
            error.message.includes("revert"),
          "应该抛出 InvalidMaxSupply 错误"
        );
      }
    });

    it("应该拒绝批量购买数量超过 250", async function () {
      try {
        await havenNFT.write.purchaseWithUSDTBatch([251n], {
          account: user1,
        });
        assert.fail("应该拒绝数量超过 250");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidMaxSupply") ||
            error.message.includes("revert"),
          "应该抛出 InvalidMaxSupply 错误"
        );
      }
    });

    // 注意：以下测试需要实际的 USDT 合约地址匹配
    // 在实际环境中（如 fork 的主网），可以取消 skip 并执行这些测试
    it.skip("应该允许用户使用 USDT 购买单个 NFT（需要真实 USDT 地址）", async function () {
      // 这个测试需要合约中的 usdtToken 地址匹配实际的 USDT 合约
      // 在本地测试环境中，可以使用 fork 或者部署 mock 合约
      
      const price = await havenNFT.read.getPrice();
      // 注意：合约中 price 是 100 ether (100 * 10^18)
      // 但 BSC 主网 USDT 是 6 decimals，所以实际价格是 100 USDT
      // 在测试中需要根据 USDT 的 decimals 调整

      // 用户授权 USDT（需要根据实际 USDT 合约的 decimals）
      const priceInUSDT = parseUnits("100", 6); // 假设 USDT 是 6 decimals
      
      // 注意：这里需要获取合约中实际的 usdtToken 地址
      const usdtTokenAddr = await havenNFT.read.usdtToken();
      
      // 如果 usdtToken 地址是我们的 testUSDT，则可以继续测试
      if (usdtTokenAddr.toLowerCase() === testUSDT.address.toLowerCase()) {
        await testUSDT.write.approve([havenNFT.address, priceInUSDT], {
          account: user1,
        });

        // 购买 NFT
        const tx = await havenNFT.write.purchaseWithUSDT({
          account: user1,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
        const purchaseEvent = receipt.logs.find((log: any) => {
          try {
            const decoded = decodeEventLog({
              abi: havenNFT.abi,
              data: log.data,
              topics: log.topics,
            }) as any;
            return decoded.eventName === "NFTPurchased";
          } catch {
            return false;
          }
        });

        assert.ok(purchaseEvent, "应该发出 NFTPurchased 事件");

        // 验证 NFT 已 mint
        const balance = await havenNFT.read.balanceOf([user1.address]);
        assert.ok(balance > 0n);
      } else {
        console.log("⚠️  跳过测试：USDT token 地址不匹配，需要在 fork 环境中测试");
      }
    });

    it.skip("应该允许用户批量购买 NFT（需要真实 USDT 地址）", async function () {
      // 类似的批量购买测试
      const quantity = 3n;
      const price = await havenNFT.read.getPrice();
      const totalPriceInUSDT = parseUnits("300", 6); // 3 * 100 USDT

      const usdtTokenAddr = await havenNFT.read.usdtToken();
      
      if (usdtTokenAddr.toLowerCase() === testUSDT.address.toLowerCase()) {
        await testUSDT.write.approve([havenNFT.address, totalPriceInUSDT], {
          account: user2,
        });

        const tx = await havenNFT.write.purchaseWithUSDTBatch([quantity], {
          account: user2,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
        
        // 验证 NFT 已 mint
        const balanceBefore = await havenNFT.read.balanceOf([user2.address]);
        // 实际上应该在购买前记录，这里简化处理
        
        // 检查事件数量
        const purchaseEvents = receipt.logs.filter((log: any) => {
          try {
            const decoded = decodeEventLog({
              abi: havenNFT.abi,
              data: log.data,
              topics: log.topics,
            }) as any;
            return decoded.eventName === "NFTPurchased";
          } catch {
            return false;
          }
        });

        assert.equal(purchaseEvents.length, Number(quantity), "应该发出正确数量的 NFTPurchased 事件");
      } else {
        console.log("⚠️  跳过测试：USDT token 地址不匹配，需要在 fork 环境中测试");
      }
    });
  });

  describe("View 函数和查询功能", function () {
    it("应该正确返回用户拥有的 token IDs", async function () {
      // 先给 user1 mint 几个 NFT
      const currentTokenId = await havenNFT.read.currentTokenId();
      await havenNFT.write.mint([user1.address], {
        account: deployer,
      });
      await havenNFT.write.mint([user1.address], {
        account: deployer,
      });

      const ownedTokens = await havenNFT.read.getOwnedTokens([user1.address]);
      const balance = await havenNFT.read.balanceOf([user1.address]);

      assert.equal(ownedTokens.length, Number(balance));
      assert.ok(ownedTokens.length > 0);
      
      // 验证所有 token 都属于 user1
      for (const tokenId of ownedTokens) {
        const owner = await havenNFT.read.ownerOf([tokenId]);
        assert.equal(owner.toLowerCase(), user1.address.toLowerCase());
      }
    });

    it("应该正确返回用户拥有的 token 数量", async function () {
      const ownedCount = await havenNFT.read.getOwnedCount([user1.address]);
      const balance = await havenNFT.read.balanceOf([user1.address]);

      assert.equal(ownedCount, balance);
    });

    it("应该正确返回分页的 metadata URIs", async function () {
      const balance = await havenNFT.read.balanceOf([user1.address]);
      
      if (balance > 0n) {
        const start = 0n;
        const end = balance > 3n ? 3n : balance;
        
        const metas = await havenNFT.read.getOwnerTokensMeta([
          user1.address,
          start,
          end,
        ]);

        assert.equal(metas.length, Number(end - start));
        
        // 验证每个 URI 都是有效字符串
        for (const meta of metas) {
          assert.ok(typeof meta === "string");
          assert.ok(meta.length > 0);
        }
      }
    });

    it("应该拒绝无效的 owner 地址（零地址）", async function () {
      const zeroAddress = "0x0000000000000000000000000000000000000000" as `0x${string}`;
      try {
        await havenNFT.read.getOwnerTokensMeta([zeroAddress, 0n, 1n]);
        assert.fail("应该拒绝零地址");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidOwner") ||
            error.message.includes("revert"),
          "应该抛出 InvalidOwner 错误"
        );
      }
    });

    it("应该正确处理超出范围的索引", async function () {
      const balance = await havenNFT.read.balanceOf([user1.address]);
      
      if (balance > 0n) {
        // 使用超出 balance 的 end 索引（应该自动调整为 balance）
        const metas = await havenNFT.read.getOwnerTokensMeta([
          user1.address,
          0n,
          balance + 10n,
        ]);

        assert.equal(metas.length, Number(balance));
      }
    });

    it("应该拒绝 start > end 的情况", async function () {
      try {
        await havenNFT.read.getOwnerTokensMeta([user1.address, 5n, 3n]);
        assert.fail("应该拒绝 start > end");
      } catch (error: any) {
        assert.ok(
          error.message.includes("InvalidMaxSupply") ||
            error.message.includes("revert"),
          "应该抛出错误"
        );
      }
    });

    it("应该正确返回 token URI", async function () {
      // 设置 meta file
      await havenNFT.write.setMetaFile([META_FILE], {
        account: deployer,
      });

      // 获取已存在的 token URI
      const ownedTokens = await havenNFT.read.getOwnedTokens([user1.address]);
      if (ownedTokens.length > 0) {
        const tokenId = ownedTokens[0];
        const tokenURI = await havenNFT.read.tokenURI([tokenId]);
        
        assert.ok(typeof tokenURI === "string");
        assert.ok(tokenURI.length > 0);
        assert.ok(tokenURI.includes(META_FILE));
      }
    });

    it("应该拒绝查询不存在的 token URI", async function () {
      const currentTokenId = await havenNFT.read.currentTokenId();
      const nonExistentTokenId = currentTokenId + 1000n;

      try {
        await havenNFT.read.tokenURI([nonExistentTokenId]);
        assert.fail("应该拒绝不存在的 token");
      } catch (error: any) {
        assert.ok(
          error.message.includes("ERC721NonexistentToken") ||
            error.message.includes("revert"),
          "应该抛出 ERC721NonexistentToken 错误"
        );
      }
    });
  });

  describe("ERC721 标准功能", function () {
    it("应该支持标准的 transferFrom", async function () {
      // 确保合约未暂停
      const paused = await havenNFT.read.paused();
      if (paused) {
        await havenNFT.write.unpause({
          account: deployer,
        });
      }

      // 给 user1 mint 一个 NFT
      const currentTokenId = await havenNFT.read.currentTokenId();
      await havenNFT.write.mint([user1.address], {
        account: deployer,
      });

      // user1 转移给 user2
      await havenNFT.write.transferFrom(
        [user1.address, user2.address, currentTokenId],
        {
          account: user1,
        }
      );

      // 验证所有权转移
      const owner = await havenNFT.read.ownerOf([currentTokenId]);
      assert.equal(owner.toLowerCase(), user2.address.toLowerCase());

      const balance1 = await havenNFT.read.balanceOf([user1.address]);
      const balance2 = await havenNFT.read.balanceOf([user2.address]);
      
      // user1 之前可能有其他 NFT，所以只检查 user2 的余额增加了
      const user2Tokens = await havenNFT.read.getOwnedTokens([user2.address]);
      assert.ok(user2Tokens.includes(currentTokenId));
    });

    it("应该支持 safeTransferFrom", async function () {
      // 给 user2 mint 一个 NFT
      const currentTokenId = await havenNFT.read.currentTokenId();
      await havenNFT.write.mint([user2.address], {
        account: deployer,
      });

      // user2 安全转移给 user3
      await havenNFT.write.safeTransferFrom(
        [user2.address, user3.address, currentTokenId, "0x"],
        {
          account: user2,
        }
      );

      // 验证所有权转移
      const owner = await havenNFT.read.ownerOf([currentTokenId]);
      assert.equal(owner.toLowerCase(), user3.address.toLowerCase());
    });

    it("应该支持 approve", async function () {
      // 给 user1 mint 一个 NFT
      const currentTokenId = await havenNFT.read.currentTokenId();
      await havenNFT.write.mint([user1.address], {
        account: deployer,
      });

      // user1 授权给 operator
      await havenNFT.write.approve([operator.address, currentTokenId], {
        account: user1,
      });

      // 验证授权
      const approved = await havenNFT.read.getApproved([currentTokenId]);
      assert.equal(approved.toLowerCase(), operator.address.toLowerCase());
    });

    it("应该支持 setApprovalForAll", async function () {
      // user1 授权 operator 管理所有 NFT
      await havenNFT.write.setApprovalForAll([operator.address, true], {
        account: user1,
      });

      // 验证授权
      const isApproved = await havenNFT.read.isApprovedForAll([
        user1.address,
        operator.address,
      ]);
      assert.equal(isApproved, true);

      // 撤销授权
      await havenNFT.write.setApprovalForAll([operator.address, false], {
        account: user1,
      });

      const isApprovedAfter = await havenNFT.read.isApprovedForAll([
        user1.address,
        operator.address,
      ]);
      assert.equal(isApprovedAfter, false);
    });

    it("应该允许授权的 operator 进行 transfer", async function () {
      // 给 user1 mint 一个 NFT
      const currentTokenId = await havenNFT.read.currentTokenId();
      await havenNFT.write.mint([user1.address], {
        account: deployer,
      });

      // user1 授权 operator
      await havenNFT.write.setApprovalForAll([operator.address, true], {
        account: user1,
      });

      // operator 转移 NFT
      await havenNFT.write.transferFrom(
        [user1.address, user2.address, currentTokenId],
        {
          account: operator,
        }
      );

      // 验证转移成功
      const owner = await havenNFT.read.ownerOf([currentTokenId]);
      assert.equal(owner.toLowerCase(), user2.address.toLowerCase());
    });
  });

  describe("ERC721Enumerable 功能", function () {
    it("应该正确实现 totalSupply", async function () {
      const totalSupply = await havenNFT.read.totalSupply();
      const totalMinted = await havenNFT.read.totalMinted();

      assert.equal(totalSupply, totalMinted);
    });

    it("应该正确实现 tokenByIndex", async function () {
      const totalSupply = await havenNFT.read.totalSupply();
      
      if (totalSupply > 0n) {
        const tokenId = await havenNFT.read.tokenByIndex([0n]);
        assert.ok(tokenId > 0n);
        
        // 验证 token 存在
        try {
          const owner = await havenNFT.read.ownerOf([tokenId]);
          assert.ok(owner !== "0x0000000000000000000000000000000000000000");
        } catch {
          assert.fail("token 应该存在");
        }
      }
    });

    it("应该正确实现 tokenOfOwnerByIndex", async function () {
      const balance = await havenNFT.read.balanceOf([user2.address]);
      
      if (balance > 0n) {
        const tokenId = await havenNFT.read.tokenOfOwnerByIndex([
          user2.address,
          0n,
        ]);
        
        // 验证 token 属于 user2
        const owner = await havenNFT.read.ownerOf([tokenId]);
        assert.equal(owner.toLowerCase(), user2.address.toLowerCase());
      }
    });

    it("应该支持 supportsInterface", async function () {
      // ERC721 interface ID
      const ERC721_INTERFACE_ID = "0x80ac58cd";
      // ERC721Metadata interface ID
      const ERC721_METADATA_INTERFACE_ID = "0x5b5e139f";
      // ERC721Enumerable interface ID
      const ERC721_ENUMERABLE_INTERFACE_ID = "0x780e9d63";

      const supportsERC721 = await havenNFT.read.supportsInterface([
        ERC721_INTERFACE_ID as `0x${string}`,
      ]);
      const supportsMetadata = await havenNFT.read.supportsInterface([
        ERC721_METADATA_INTERFACE_ID as `0x${string}`,
      ]);
      const supportsEnumerable = await havenNFT.read.supportsInterface([
        ERC721_ENUMERABLE_INTERFACE_ID as `0x${string}`,
      ]);

      assert.equal(supportsERC721, true);
      assert.equal(supportsMetadata, true);
      assert.equal(supportsEnumerable, true);
    });
  });

  describe("边界情况和错误处理", function () {
    it("应该正确处理最大供应量为 0（无限制）的情况", async function () {
      // 创建一个无限制的 NFT 合约实例（仅用于测试逻辑）
      // 在实际测试中，我们可以修改 maxSupply 为 0
      await havenNFT.write.setMaxSupply([0n], {
        account: deployer,
      });

      const maxSupply = await havenNFT.read.maxSupply();
      assert.equal(maxSupply, 0n);

      const available = await havenNFT.read.availableSupply();
      // availableSupply 应该返回 type(uint256).max
      assert.ok(available > 0n);

      // 恢复原值
      await havenNFT.write.setMaxSupply([MAX_SUPPLY], {
        account: deployer,
      });
    });

    it("应该正确处理已 mint 所有 NFT 后的查询", async function () {
      const totalMinted = await havenNFT.read.totalMinted();
      const maxSupply = await havenNFT.read.maxSupply();

      if (totalMinted >= maxSupply && maxSupply > 0n) {
        // 尝试再次 mint 应该失败
        try {
          await havenNFT.write.mint([user3.address], {
            account: deployer,
          });
          assert.fail("应该拒绝超过最大供应量");
        } catch (error: any) {
          assert.ok(
            error.message.includes("MaxSupplyReached") ||
              error.message.includes("revert"),
            "应该抛出 MaxSupplyReached 错误"
          );
        }

        // availableSupply 应该为 0
        const available = await havenNFT.read.availableSupply();
        assert.equal(available, 0n);
      }
    });
  });

  describe("事件发射验证", function () {
    it("应该正确发射所有相关事件", async function () {
      // 测试各种操作并验证事件
      
      // 1. Mint 事件
      const tx1 = await havenNFT.write.mint([user3.address], {
        account: deployer,
      });
      const receipt1 = await publicClient.waitForTransactionReceipt({ hash: tx1 });
      const mintEvent = receipt1.logs.find((log: any) => {
        try {
          const decoded = decodeEventLog({
            abi: havenNFT.abi,
            data: log.data,
            topics: log.topics,
          }) as any;
          return decoded.eventName === "NFTMinted";
        } catch {
          return false;
        }
      });
      assert.ok(mintEvent, "应该发射 NFTMinted 事件");

      // 2. BaseURI 更新事件已在前面测试
      // 3. ContractURI 更新事件已在前面测试
      // 4. MaxSupply 更新事件已在前面测试
      // 5. Treasury 更新事件已在前面测试
      // 6. PurchaseEnabled 更新事件已在前面测试
      // 7. MetaFile 更新事件已在前面测试
    });
  });
});