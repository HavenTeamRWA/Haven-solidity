# HavenNFT 重新部署指南

## 当前状态

HavenNFT 合约已在 BSC 主网（chain-56）上部署：
- **合约地址**: `0x057F829e3385878006EFd9AED9F1c7F96aa149B0`
- **网络**: BSC Mainnet (chain-56)

## 重新部署选项

### 选项 1: 在同一网络部署新合约（推荐）

如果你想在 BSC 主网上部署一个**新的 HavenNFT 合约**（会得到新地址），有两种方法：

#### 方法 A: 修改部署 ID（最简单）

修改 `ignition/modules/HavenNFTModule.ts`，将 `id` 改为新值：

```typescript
const havenNFT = m.contract("HavenNFT", [name, symbol, maxSupply, treasury], {
  id: "HavenNFTV2", // 改为新 ID
});
```

然后部署：
```bash
npx hardhat ignition deploy ./ignition/modules/HavenNFTModule.ts --network bsc
```

#### 方法 B: 删除部署记录后重新部署

如果你想使用原来的 ID，需要先删除部署记录：

1. **备份当前部署记录**（可选）:
```bash
cp -r ignition/deployments/chain-56 ignition/deployments/chain-56.backup
```

2. **删除 HavenNFT 相关记录**:
   - 从 `journal.jsonl` 中删除 HavenNFT 相关的条目（第 40-45 行）
   - 或删除整个 `chain-56` 目录（如果其他合约不需要保留）

3. **重新部署**:
```bash
npx hardhat ignition deploy ./ignition/modules/HavenNFTModule.ts --network bsc
```

### 选项 2: 部署到不同网络

如果你想在**不同的网络**部署（如测试网），直接部署即可：

```bash
# 部署到 BSC 测试网
npx hardhat ignition deploy ./ignition/modules/HavenNFTModule.ts --network bscTestnet

# 或部署到本地网络
npx hardhat ignition deploy ./ignition/modules/HavenNFTModule.ts --network hardhatMainnet
```

## 部署命令示例

### 使用默认参数部署

```bash
npx hardhat ignition deploy ./ignition/modules/HavenNFTModule.ts --network bsc
```

**默认参数**:
- name: "Haven USTB Yield NFT"
- symbol: "HavenNFT"
- maxSupply: 10000
- treasury: "0xF7FbF2B19f5139033feA452141b33C4BE9444fAA"

### 自定义参数部署

```bash
npx hardhat ignition deploy ./ignition/modules/HavenNFTModule.ts --network bsc \
  --parameters '{"HavenNFTModule":{"name":"My NFT","symbol":"MNFT","maxSupply":5000,"treasury":"0x你的treasury地址"}}'
```

## 部署后配置

部署完成后，你可能需要配置以下内容（需要 owner 权限）：

1. **设置 metadata 文件**（如果未在部署时设置）:
```typescript
// 调用合约函数
havenNFT.setMetaFile("QmYourMetaFileHash");
```

2. **设置 contract URI**（可选）:
```typescript
havenNFT.setContractURI("https://example.com/contract-metadata.json");
```

3. **启用购买功能**（如果需要）:
```typescript
havenNFT.setPurchaseEnabled(true);
```

## 注意事项

1. **旧合约不会受影响**: 重新部署会创建一个**全新的合约**，旧合约仍然存在
2. **新地址**: 新部署的合约会有**新的地址**
3. **Gas 费用**: 每次部署都需要支付 gas 费用
4. **参数检查**: 确保 treasury 地址正确，部署后无法修改

## 推荐方案

如果你想在同一网络重新部署，**推荐使用方法 A（修改 ID）**，因为：
- ✅ 简单，只需修改一行代码
- ✅ 不会影响现有部署记录
- ✅ 可以同时保留新旧部署记录

需要我帮你执行哪种方式？
