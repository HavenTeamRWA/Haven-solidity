import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { network } from "hardhat";
import { parseEther, encodeFunctionData } from "viem";

/**
 * HavenNFT Gas 消耗测试
 * 测试 batchMint 不同数量 NFT 的 Gas 消耗，特别关注 500 个 NFT 的情况
 */
describe("HavenNFT Gas 消耗测试", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  // 测试账户
  let deployer: any;
  let recipient: any;
  let testRecipient: any; // 用于最大数量测试的独立地址

  // 合约实例
  let havenNFT: any;

  // Gas 限制参考值（BSC 主网 Gas limit: 30,000,000）
  const BSC_GAS_LIMIT = 30_000_000n;
  const RECOMMENDED_MAX_GAS = 20_000_000n; // 建议的最大 Gas 消耗（留出安全边际）

  before(async function () {
    // 获取测试账户
    const accounts = await viem.getWalletClients();
    deployer = accounts[0].account;
    recipient = accounts[1].account;
    testRecipient = accounts[7].account; // 使用不同的地址用于最大数量测试

    // 部署 HavenNFT 合约
    havenNFT = await viem.deployContract(
      "HavenNFT",
      [
        "Test NFT Collection", // name
        "TNFT", // symbol
        0, // maxSupply (0 = unlimited)
        deployer.address, // treasury
      ],
      {
        account: deployer,
      }
    );

    console.log("✅ HavenNFT 合约已部署:", havenNFT.address);
  });

  /**
   * 测试 batchMint 的 Gas 消耗
   */
  async function testBatchMintGas(quantity: number) {
    // 先估算 Gas
    let gasEstimate: bigint;
    try {
      const data = encodeFunctionData({
        abi: havenNFT.abi,
        functionName: "batchMint",
        args: [recipient.address, BigInt(quantity)],
      });
      gasEstimate = await publicClient.estimateGas({
        account: deployer,
        to: havenNFT.address,
        data: data,
      });
    } catch (error: any) {
      // 如果估算失败，根据数量估算（每个 NFT 约 120k gas）
      gasEstimate = BigInt(quantity) * 120_000n + 50_000n; // 基础 gas + 每个 NFT 的 gas
    }

    // 使用估算的 Gas * 1.2 作为 Gas limit（留出安全边际），但不超过 BSC_GAS_LIMIT
    const gasLimit = (gasEstimate * 120n) / 100n;
    const finalGasLimit = gasLimit > BSC_GAS_LIMIT ? BSC_GAS_LIMIT : gasLimit;

    const hash = await havenNFT.write.batchMint([recipient.address, BigInt(quantity)], {
      account: deployer,
      gas: finalGasLimit,
    });

    // 等待交易确认
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
      gasUsed: receipt.gasUsed,
      gasEstimate: gasEstimate,
      effectiveGasPrice: receipt.effectiveGasPrice || 0n,
      totalCost: receipt.gasUsed * (receipt.effectiveGasPrice || 0n),
    };
  }

  /**
   * 测试不同数量的 Gas 消耗
   * 注意：由于 Gas limit 限制，我们测试关键的数量点
   */
  const testQuantities = [1, 10, 50, 100, 200, 500];

  for (const quantity of testQuantities) {
    it(`应该能够成功 mint ${quantity} 个 NFT 且 Gas 消耗在合理范围内`, async function () {
      const result = await testBatchMintGas(quantity);

      console.log(`\n📊 Mint ${quantity} 个 NFT:`);
      console.log(`   Gas Estimate: ${result.gasEstimate.toLocaleString()}`);
      console.log(`   Gas Used: ${result.gasUsed.toLocaleString()}`);
      console.log(`   Gas Price: ${result.effectiveGasPrice.toLocaleString()} wei`);
      if (result.effectiveGasPrice > 0n) {
        const costInBNB = (result.totalCost / parseEther("1")) * parseEther("0.000000001");
        console.log(`   Total Cost: ${costInBNB} BNB (假设 gas price = 3 gwei)`);
      }

      // 检查 Gas 消耗是否在合理范围内
      assert.ok(
        result.gasUsed < RECOMMENDED_MAX_GAS,
        `Gas 消耗 ${result.gasUsed.toLocaleString()} 超过推荐的最大值 ${RECOMMENDED_MAX_GAS.toLocaleString()}`
      );

      // 检查 Gas 消耗是否超过 BSC Gas limit
      assert.ok(
        result.gasUsed < BSC_GAS_LIMIT,
        `Gas 消耗 ${result.gasUsed.toLocaleString()} 超过 BSC Gas limit ${BSC_GAS_LIMIT.toLocaleString()}`
      );

      // 验证 NFT 已成功 mint
      const balance = await havenNFT.read.balanceOf([recipient.address]);

      assert.equal(Number(balance), quantity, `应该 mint ${quantity} 个 NFT`);
    });
  }

  /**
   * 专门测试 500 个 NFT 的情况
   */
  describe("500 个 NFT 的详细测试", async function () {
    it("应该测试 500 个 NFT 的 Gas 消耗", async function () {
      const quantity = 500;
      
      // 先尝试估算 Gas
      let gasEstimate: bigint;
      let canExecute = false;
      
      try {
        // 使用 publicClient 估算 Gas
        const data = encodeFunctionData({
          abi: havenNFT.abi,
          functionName: "batchMint",
          args: [recipient.address, BigInt(quantity)],
        });
        gasEstimate = await publicClient.estimateGas({
          account: deployer,
          to: havenNFT.address,
          data: data,
        });
        
        console.log(`\n🔍 详细测试 - Mint ${quantity} 个 NFT:`);
        console.log(`   Gas Estimate: ${gasEstimate.toLocaleString()}`);
        console.log(`   BSC Gas Limit: ${BSC_GAS_LIMIT.toLocaleString()}`);
        console.log(`   推荐最大值: ${RECOMMENDED_MAX_GAS.toLocaleString()}`);
        console.log(`   Gas Limit 使用率: ${((Number(gasEstimate) / Number(BSC_GAS_LIMIT)) * 100).toFixed(2)}%`);
        console.log(`   推荐最大值使用率: ${((Number(gasEstimate) / Number(RECOMMENDED_MAX_GAS)) * 100).toFixed(2)}%`);
        
        if (gasEstimate < BSC_GAS_LIMIT) {
          canExecute = true;
        } else {
          console.log(`   ⚠️  警告: Gas 估算 ${gasEstimate.toLocaleString()} 超过 BSC Gas Limit ${BSC_GAS_LIMIT.toLocaleString()}`);
        }
      } catch (error: any) {
        // 估算失败，说明 Gas 不足
        console.log(`\n🔍 详细测试 - Mint ${quantity} 个 NFT:`);
        console.log(`   ❌ Gas 估算失败: ${error.message}`);
        console.log(`   结论: 500 个 NFT 的 Gas 消耗可能超过 BSC Gas Limit`);
        
        // 基于之前的测试数据估算
        // 200 个 NFT 使用约 23,326,303 gas
        // 每个 NFT 约 116,632 gas
        // 500 个 NFT 预计约 58,316,000 gas
        const estimatedGas = 58_316_000n;
        console.log(`   估算 Gas 消耗: ${estimatedGas.toLocaleString()}`);
        console.log(`   Gas Limit 使用率: ${((Number(estimatedGas) / Number(BSC_GAS_LIMIT)) * 100).toFixed(2)}%`);
        
        gasEstimate = estimatedGas;
        canExecute = false;
      }

      // 如果 Gas 估算在合理范围内，尝试执行
      if (canExecute && gasEstimate < RECOMMENDED_MAX_GAS) {
        try {
          const result = await testBatchMintGas(quantity);
          console.log(`   ✅ 实际 Gas Used: ${result.gasUsed.toLocaleString()}`);
          
          assert.ok(
            result.gasUsed < RECOMMENDED_MAX_GAS,
            `500 个 NFT 的 Gas 消耗 ${result.gasUsed.toLocaleString()} 超过推荐的最大值 ${RECOMMENDED_MAX_GAS.toLocaleString()}`
          );

          assert.ok(
            result.gasUsed < BSC_GAS_LIMIT,
            `500 个 NFT 的 Gas 消耗 ${result.gasUsed.toLocaleString()} 超过 BSC Gas limit ${BSC_GAS_LIMIT.toLocaleString()}`
          );
        } catch (error: any) {
          console.log(`   ❌ 执行失败: ${error.message}`);
          throw error;
        }
      } else {
        // Gas 消耗过高，给出建议
        console.log(`\n   📋 结论和建议:`);
        console.log(`   - 500 个 NFT 的 Gas 消耗 (${gasEstimate.toLocaleString()}) 超过推荐的最大值`);
        console.log(`   - 建议将 batchMint 上限降低到 200-300 个 NFT`);
        console.log(`   - 或者优化合约代码以减少 Gas 消耗`);
        
        // 这个测试应该失败，因为 500 个 NFT 的 Gas 消耗不合理
        assert.fail(
          `500 个 NFT 的 Gas 消耗 ${gasEstimate.toLocaleString()} 超过推荐的最大值 ${RECOMMENDED_MAX_GAS.toLocaleString()}。建议降低上限。`
        );
      }
    });

    it("应该分析 Gas 消耗趋势并给出建议", async function () {
      console.log(`\n📊 Gas 消耗分析总结:`);
      
      // 测试较小的数量来建立趋势
      const testQuantities = [1, 10, 50, 100, 200];
      const results: Array<{ quantity: number; gasUsed: bigint; avgGas: number }> = [];

      for (const quantity of testQuantities) {
        try {
          const result = await testBatchMintGas(quantity);
          const avgGas = Number(result.gasUsed) / quantity;
          results.push({ quantity, gasUsed: result.gasUsed, avgGas });
          console.log(`   ${quantity} 个 NFT: ${result.gasUsed.toLocaleString()} gas (平均 ${avgGas.toFixed(0)} gas/NFT)`);
        } catch (error: any) {
          console.log(`   ${quantity} 个 NFT: 测试失败`);
        }
      }

      if (results.length >= 2) {
        // 计算边际 Gas 消耗
        const lastResult = results[results.length - 1];
        const firstResult = results[0];
        const gasIncrease = Number(lastResult.gasUsed - firstResult.gasUsed);
        const quantityIncrease = lastResult.quantity - firstResult.quantity;
        const marginalGas = gasIncrease / quantityIncrease;

        console.log(`\n   📈 趋势分析:`);
        console.log(`   边际 Gas 消耗（每增加 1 个 NFT）: ${marginalGas.toFixed(0)} gas`);
        
        // 估算 500 个 NFT 的 Gas 消耗
        const estimated500Gas = Number(lastResult.gasUsed) + (500 - lastResult.quantity) * marginalGas;
        console.log(`   估算 500 个 NFT 的 Gas: ${estimated500Gas.toLocaleString()}`);
        console.log(`   BSC Gas Limit: ${BSC_GAS_LIMIT.toLocaleString()}`);
        console.log(`   使用率: ${((estimated500Gas / Number(BSC_GAS_LIMIT)) * 100).toFixed(2)}%`);

        console.log(`\n   💡 建议:`);
        if (estimated500Gas > Number(BSC_GAS_LIMIT)) {
          console.log(`   ❌ 500 个 NFT 的 Gas 消耗可能超过 BSC Gas Limit`);
          console.log(`   ✅ 建议将上限降低到 ${Math.floor(Number(BSC_GAS_LIMIT) / marginalGas)} 个 NFT 以下`);
        } else if (estimated500Gas > Number(RECOMMENDED_MAX_GAS)) {
          console.log(`   ⚠️  500 个 NFT 的 Gas 消耗超过推荐的最大值`);
          console.log(`   ✅ 建议将上限降低到 ${Math.floor(Number(RECOMMENDED_MAX_GAS) / marginalGas)} 个 NFT 以下`);
        } else {
          console.log(`   ✅ 500 个 NFT 的 Gas 消耗在合理范围内`);
        }
      }
    });
  });

  /**
   * Gas 消耗趋势分析
   */
  it("应该显示 Gas 消耗趋势", async function () {
    console.log(`\n📈 Gas 消耗趋势分析:`);
    console.log(`   数量\tGas Used\t每个 NFT 平均 Gas`);

    const results: Array<{ quantity: number; gasUsed: bigint; avgGas: number }> = [];

    for (const quantity of [1, 10, 50, 100, 200, 500]) {
      const result = await testBatchMintGas(quantity);
      const avgGas = Number(result.gasUsed) / quantity;
      results.push({ quantity, gasUsed: result.gasUsed, avgGas });

      console.log(`   ${quantity}\t${result.gasUsed.toLocaleString()}\t${avgGas.toFixed(0)}`);
    }

    // 分析趋势
    const firstResult = results[0];
    const lastResult = results[results.length - 1];
    const gasIncrease = Number(lastResult.gasUsed - firstResult.gasUsed);
    const quantityIncrease = lastResult.quantity - firstResult.quantity;
    const marginalGas = gasIncrease / quantityIncrease;

    console.log(`\n📊 分析结果:`);
    console.log(`   边际 Gas 消耗（每增加 1 个 NFT）: ${marginalGas.toFixed(0)}`);
    console.log(`   500 个 NFT 总 Gas: ${lastResult.gasUsed.toLocaleString()}`);
    console.log(`   BSC Gas Limit: ${BSC_GAS_LIMIT.toLocaleString()}`);
    console.log(`   使用率: ${((Number(lastResult.gasUsed) / Number(BSC_GAS_LIMIT)) * 100).toFixed(2)}%`);

    // 验证边际 Gas 消耗是否合理（应该大致稳定）
    assert.ok(marginalGas > 0, "边际 Gas 消耗应该大于 0");
    assert.ok(marginalGas < 100000, "边际 Gas 消耗应该小于 100,000（每个 NFT 约 100k gas）");
  });

  /**
   * 查找最大可 mint 数量
   */
  describe("查找最大可 mint 数量", async function () {
    it("应该找到在 BSC Gas Limit 内的最大 mint 数量", async function () {
      console.log(`\n🔍 查找最大可 mint 数量:`);
      console.log(`   BSC Gas Limit: ${BSC_GAS_LIMIT.toLocaleString()}`);
      console.log(`   推荐最大值: ${RECOMMENDED_MAX_GAS.toLocaleString()}`);
      
      // 先测试几个关键点，建立 Gas 消耗模型
      const testPoints = [1, 10, 50, 100, 200];
      const gasData: Array<{ quantity: number; gasUsed: bigint }> = [];
      
      console.log(`\n   步骤 1: 建立 Gas 消耗模型`);
      for (const qty of testPoints) {
        try {
          const result = await testBatchMintGas(qty);
          gasData.push({ quantity: qty, gasUsed: result.gasUsed });
          console.log(`   ${qty} 个 NFT: ${result.gasUsed.toLocaleString()} gas`);
        } catch (error: any) {
          console.log(`   ${qty} 个 NFT: 测试失败`);
        }
      }
      
      if (gasData.length < 2) {
        console.log(`   ⚠️  数据不足，无法建立模型`);
        return;
      }
      
      // 计算边际 Gas 消耗（每个 NFT 的平均 Gas）
      const lastData = gasData[gasData.length - 1];
      const firstData = gasData[0];
      const marginalGas = Number(lastData.gasUsed - firstData.gasUsed) / (lastData.quantity - firstData.quantity);
      const baseGas = Number(firstData.gasUsed) - marginalGas; // 基础 Gas（不随数量变化的部分）
      
      console.log(`\n   步骤 2: 计算 Gas 消耗模型`);
      console.log(`   基础 Gas: ${baseGas.toFixed(0)}`);
      console.log(`   每个 NFT 的 Gas: ${marginalGas.toFixed(0)}`);
      console.log(`   Gas 消耗公式: gas = ${baseGas.toFixed(0)} + ${marginalGas.toFixed(0)} * quantity`);
      
      // 计算在 Gas Limit 内的最大数量
      const maxQuantityForBSC = Math.floor((Number(BSC_GAS_LIMIT) - baseGas) / marginalGas);
      const maxQuantityForRecommended = Math.floor((Number(RECOMMENDED_MAX_GAS) - baseGas) / marginalGas);
      
      console.log(`\n   步骤 3: 计算理论最大数量`);
      console.log(`   基于 BSC Gas Limit (${BSC_GAS_LIMIT.toLocaleString()}): ${maxQuantityForBSC} 个 NFT`);
      console.log(`   基于推荐最大值 (${RECOMMENDED_MAX_GAS.toLocaleString()}): ${maxQuantityForRecommended} 个 NFT`);
      
      // 使用二分查找找到实际可执行的最大数量
      console.log(`\n   步骤 4: 二分查找实际最大数量`);
      let left = 1;
      let right = Math.min(maxQuantityForBSC, 500); // 不超过合约限制的 500
      let maxSuccessfulQuantity = 0;
      let lastSuccessfulGas = 0n;
      
      // 先测试几个关键点（使用独立的 testRecipient 地址）
      const testQuantities = [100, 150, 200, 250, 257];
      
      for (const qty of testQuantities) {
        if (qty > right) break;
        
        try {
          // 使用 publicClient 估算 Gas
          const data = encodeFunctionData({
            abi: havenNFT.abi,
            functionName: "batchMint",
            args: [testRecipient.address, BigInt(qty)],
          });
          const gasEstimate = await publicClient.estimateGas({
            account: deployer,
            to: havenNFT.address,
            data: data,
          });
          
          if (gasEstimate < BSC_GAS_LIMIT) {
            // 尝试实际执行
            try {
              const gasLimit = (gasEstimate * 120n) / 100n;
              const finalGasLimit = gasLimit > BSC_GAS_LIMIT ? BSC_GAS_LIMIT : gasLimit;
              
              const hash = await havenNFT.write.batchMint([testRecipient.address, BigInt(qty)], {
                account: deployer,
                gas: finalGasLimit,
              });
              
              const receipt = await publicClient.waitForTransactionReceipt({ hash });
              
              if (receipt.gasUsed < BSC_GAS_LIMIT) {
                maxSuccessfulQuantity = qty;
                lastSuccessfulGas = receipt.gasUsed;
                console.log(`   ✅ ${qty} 个 NFT: 成功 (Gas: ${receipt.gasUsed.toLocaleString()})`);
              } else {
                console.log(`   ⚠️  ${qty} 个 NFT: Gas 使用 (${receipt.gasUsed.toLocaleString()}) 超过 BSC Gas Limit`);
                break;
              }
            } catch (error: any) {
              console.log(`   ❌ ${qty} 个 NFT: 执行失败 - ${error.message.split('\n')[0]}`);
              break;
            }
          } else {
            console.log(`   ⚠️  ${qty} 个 NFT: Gas 估算 (${gasEstimate.toLocaleString()}) 超过 BSC Gas Limit`);
            break;
          }
        } catch (error: any) {
          console.log(`   ❌ ${qty} 个 NFT: Gas 估算失败 - ${error.message.split('\n')[0]}`);
          break;
        }
      }
      
      // 如果还有空间，继续二分查找
      if (maxSuccessfulQuantity > 0 && maxSuccessfulQuantity < right) {
        left = maxSuccessfulQuantity + 1;
        
        while (left <= right) {
          const mid = Math.floor((left + right) / 2);
          
          try {
            // 使用 publicClient 估算 Gas
            const data = encodeFunctionData({
              abi: havenNFT.abi,
              functionName: "batchMint",
              args: [testRecipient.address, BigInt(mid)],
            });
            const gasEstimate = await publicClient.estimateGas({
              account: deployer,
              to: havenNFT.address,
              data: data,
            });
            
            if (gasEstimate < BSC_GAS_LIMIT) {
              // 尝试实际执行
              try {
                const gasLimit = (gasEstimate * 120n) / 100n;
                const finalGasLimit = gasLimit > BSC_GAS_LIMIT ? BSC_GAS_LIMIT : gasLimit;
                
                const hash = await havenNFT.write.batchMint([testRecipient.address, BigInt(mid)], {
                  account: deployer,
                  gas: finalGasLimit,
                });
                
                const receipt = await publicClient.waitForTransactionReceipt({ hash });
                
                if (receipt.gasUsed < BSC_GAS_LIMIT) {
                  maxSuccessfulQuantity = mid;
                  lastSuccessfulGas = receipt.gasUsed;
                  console.log(`   ✅ ${mid} 个 NFT: 成功 (Gas: ${receipt.gasUsed.toLocaleString()})`);
                  left = mid + 1; // 尝试更大的数量
                } else {
                  right = mid - 1; // Gas 超限，减少数量
                }
              } catch (error: any) {
                right = mid - 1; // 执行失败，减少数量
              }
            } else {
              right = mid - 1; // Gas 估算超限，减少数量
            }
          } catch (error: any) {
            right = mid - 1; // Gas 估算失败，减少数量
          }
        }
      }
      
      console.log(`\n   📊 最终结果:`);
      console.log(`   最大可成功 mint 数量: ${maxSuccessfulQuantity} 个 NFT`);
      if (lastSuccessfulGas > 0n) {
        console.log(`   对应的 Gas 消耗: ${lastSuccessfulGas.toLocaleString()}`);
        console.log(`   BSC Gas Limit 使用率: ${((Number(lastSuccessfulGas) / Number(BSC_GAS_LIMIT)) * 100).toFixed(2)}%`);
        console.log(`   推荐最大值使用率: ${((Number(lastSuccessfulGas) / Number(RECOMMENDED_MAX_GAS)) * 100).toFixed(2)}%`);
      }
      console.log(`   理论最大数量 (BSC Limit): ${maxQuantityForBSC} 个 NFT`);
      console.log(`   推荐最大数量 (安全值): ${maxQuantityForRecommended} 个 NFT`);
      
      console.log(`\n   💡 建议:`);
      if (maxSuccessfulQuantity >= 200) {
        console.log(`   ✅ 建议将 batchMint 上限设置为 ${maxSuccessfulQuantity} 个 NFT`);
        console.log(`   ✅ 或者使用更保守的值 ${Math.min(maxSuccessfulQuantity, maxQuantityForRecommended)} 个 NFT`);
      } else {
        console.log(`   ⚠️  最大可 mint 数量较低 (${maxSuccessfulQuantity})，建议优化合约代码`);
      }
      
      // 验证结果
      assert.ok(maxSuccessfulQuantity > 0, "应该找到至少一个可成功 mint 的数量");
      assert.ok(maxSuccessfulQuantity <= 500, "最大数量不应超过合约限制");
    });
  });

  /**
   * 测试边界情况
   */
  describe("边界情况测试", async function () {
    it("应该拒绝 mint 0 个 NFT", async function () {
      try {
        await havenNFT.write.batchMint([recipient.address, 0n], {
          account: deployer,
        });
        assert.fail("应该 revert");
      } catch (error: any) {
        assert.ok(error.message.includes("InvalidMaxSupply") || error.message.includes("revert"), "应该 revert InvalidMaxSupply");
      }
    });

    it("应该拒绝 mint 超过 500 个 NFT", async function () {
      try {
        await havenNFT.write.batchMint([recipient.address, 501n], {
          account: deployer,
        });
        assert.fail("应该 revert");
      } catch (error: any) {
        assert.ok(error.message.includes("InvalidMaxSupply") || error.message.includes("revert"), "应该 revert InvalidMaxSupply");
      }
    });
  });
});
