# Haven RWA 合约说明文档

## 1. 概述

Haven RWA 采用双合约架构，在 BNB Chain 上实现基于 HavenNFT 的 RWA 收益登记、数据披露和 USDT 收益领取能力。

两个核心合约分别是：

- `RWAAssetRegistry`：RWA 资产登记与数据披露合约
- `HavenRWAYieldClaim`：NFT 持有人 USDT 收益领取合约

该架构将“资产登记/数据上链”和“资金领取/收益分发”分离：

- `RWAAssetRegistry` 负责记录资产说明、NAV、收益报告、资产状态等链上披露信息。
- `HavenRWAYieldClaim` 负责验证 HavenNFT 持有人身份，并按照链上收益公式向用户分发 USDT。

完整业务流程如下：

```text
RWA 资产说明 / 收益报告
        |
        v
RWAAssetRegistry 资产登记与数据披露
        |
        v
HavenRWAYieldClaim 收益领取合约
        |
        v
HavenNFT 持有人领取 USDT 收益
```

## 2. 主网合约地址

BNB Chain 主网：

```text
HavenNFT:          0xC4bE08935e5ba76F17Ca5aF72D806A298C5F8dde
RWAAssetRegistry: 0x259eDF276b60b2398E21C51F591902560437a6A4
BSC USDT:         0x55d398326f99059fF775485246999027B3197955
```

`HavenRWAYieldClaim` 应以最新部署版本为准。第一版 Claim 合约地址为：

```text
HavenRWAYieldClaim V1: 0xd4c134c60e9A68B1c4ACC0Cf18f5568aa8E814F6
```

如果已经部署修正收益开始时间后的 V2 Claim 合约，产品页面、提交材料和用户交互应使用 V2 地址。

## 3. RWAAssetRegistry 合约

`RWAAssetRegistry` 是资产登记与数据披露合约。

它不托管资金，也不负责计算用户可领取收益。它的作用是为 RWA Infra 提供链上登记和审计记录。

主要能力包括：

- RWA 资产登记
- 资产 metadataURI 披露
- NAV 与收益报告上链
- 资产启用/停用状态管理
- 形成可审计的链上事件记录

### 3.1 资产登记

```solidity
registerAsset(
    uint256 assetId,
    string calldata metadataURI,
    uint256 principalPerNFT,
    uint256 aprBps
)
```

该方法用于登记一个 RWA 收益计划。

当前计划参数：

```text
assetId:         1
metadataURI:     https://coral-delicate-basilisk-291.mypinata.cloud/ipfs/bafkreifhfbwsfq4swuoc6vbk3gld7t6gjwhqu6wjv75skcnctofs6jebaa
principalPerNFT: 100 USDT
aprBps:          380
年化收益率:       3.8%
```

业务含义：

每个符合条件的 HavenNFT 在该 MVP 中对应 `100 USDT` 的收益记账单位。登记的年化收益率为 `3.8%`，即 `380` 个 basis points。

### 3.2 收益报告发布

```solidity
publishReport(
    uint256 assetId,
    uint256 nav,
    uint256 revenueAmount,
    string calldata reportURI
)
```

该方法用于发布资产 NAV 或收益报告。

`reportURI` 应指向 IPFS 或 IPFS Gateway 上的报告文件。报告可以是 JSON，也可以是 PDF。

MVP 阶段建议报告包含：

- 资产 ID
- 报告周期
- 参与收益的 NFT 数量
- 每个 NFT 对应的本金记账单位
- 年化收益率
- NAV
- 本期收益金额
- 收益计算公式
- 数据来源
- 相关合约地址
- MVP 免责声明

该方法用于满足 RWA Infra 要求中的“数据上链能力”和“审计披露能力”。

### 3.3 资产状态管理

```solidity
setAssetStatus(uint256 assetId, bool active)
```

该方法用于启用或停用某个资产。

`HavenRWAYieldClaim` 在用户领取收益前会检查：

```solidity
registry.isAssetActive(assetId)
```

如果资产状态为 inactive，则用户无法继续领取收益。

## 4. HavenRWAYieldClaim 合约

`HavenRWAYieldClaim` 是收益领取主合约，负责实际的 USDT 收益分发。

该合约绑定以下信息：

- HavenNFT 合约地址
- BSC USDT 合约地址
- RWAAssetRegistry 合约地址
- assetId
- 每个 NFT 的本金记账单位
- 年化收益率
- 收益开始时间
- 收益结束时间

Claim 合约中的收益计算参数是固定业务逻辑。Registry 中的报告用于披露和审计，不会动态改变用户的收益公式。

### 4.1 收益入池

```solidity
fundRevenue(uint256 amount)
```

该方法用于将 USDT 注入 Claim 合约，形成用户可领取的收益池。

调用 `fundRevenue` 前，资金方需要先授权 USDT：

```solidity
USDT.approve(claimContract, amount)
```

然后调用：

```solidity
HavenRWAYieldClaim.fundRevenue(amount)
```

该方法会：

- 将 USDT 从资金方钱包转入 Claim 合约
- 更新 `totalRevenueFunded`
- 触发 `RevenueFunded` 事件

从技术上讲，直接向 Claim 合约转入 USDT 也能让用户领取收益，因为 Claim 合约发放收益时检查的是自身 USDT 余额。

但为了形成清晰的链上业务记录，建议使用 `fundRevenue`。这样审核方可以明确看到“收益资金入池”这个业务动作。

### 4.2 单个 NFT 领取

```solidity
claim(uint256 tokenId)
```

该方法允许当前 NFT 持有人领取某个 tokenId 对应的 USDT 收益。

领取条件：

- Registry 中对应资产必须处于 active 状态
- 调用者必须是该 tokenId 的当前持有人
- 可领取金额必须大于 0
- Claim 合约中必须有足够 USDT
- Claim 合约不能处于暂停状态

### 4.3 批量领取

```solidity
claimBatch(uint256[] calldata tokenIds)
```

该方法允许用户一次性领取多个 NFT 的收益。

合约会逐个检查 tokenId 的持有人。调用者必须持有传入数组中的每一个 NFT。

### 4.4 收益计算公式

可领取金额公式为：

```text
claimable = principalPerNFT * aprBps * elapsed / 10000 / 365 days
```

当前 MVP 参数：

```text
principalPerNFT = 100 USDT
aprBps = 380
年化收益率 = 3.8%
```

因此，每个 HavenNFT 每年可累积收益：

```text
100 USDT * 3.8% = 3.8 USDT / 年
```

合约会记录：

```solidity
lastClaimedAt[tokenId]
```

用于防止同一个时间段被重复领取。

### 4.5 收益周期

Claim 合约中包含：

```solidity
yieldStartTime
yieldEndTime
```

修正后的收益开始时间为：

```text
1770307200
```

对应时间：

```text
2026-02-06 00:00:00 Asia/Shanghai
2026-02-05 16:00:00 UTC
```

需要注意：`yieldStartTime` 是构造参数，合约部署后不能修改。如果收益开始时间需要修正，应重新部署一个新的 `HavenRWAYieldClaim` 合约，并继续复用已有的 `RWAAssetRegistry`。

## 5. 完整链上业务流程

推荐用于 MVP 和审核提交的链上流程如下：

1. 部署 `RWAAssetRegistry`。
2. 调用 `registerAsset`，登记 Haven RWA Yield Pool。
3. 调用 `publishReport`，发布 NAV、收益数据和 IPFS 报告链接。
4. 部署 `HavenRWAYieldClaim`，关联：
   - HavenNFT
   - BSC USDT
   - RWAAssetRegistry
   - `assetId = 1`
5. 资金方授权 USDT 给 Claim 合约。
6. 资金方调用 `fundRevenue` 注入收益资金。
7. 多个 HavenNFT 持有人调用 `claim` 或 `claimBatch` 领取收益。
8. 整理 BscScan 链接和交易哈希，作为提交材料。

这条流程可以证明：

- 已在 BNB Chain 主网部署核心合约
- 合约源码可验证
- 存在 RWA 资产登记逻辑
- 存在 RWA 数据/报告上链能力
- 存在真实 USDT 收益入池
- 存在基于 NFT 权益凭证的收益领取
- 存在多钱包、多交易的真实链上交互
- 存在完整业务逻辑闭环

## 6. RWA Infra 定位说明

建议将该系统定位为 RWA Infrastructure MVP，而不是直接证券化发行产品。

推荐表述：

```text
Haven 在 BNB Chain 上提供基于 NFT 权益凭证的 RWA 收益分发基础设施。
RWAAssetRegistry 负责将资产说明、NAV、收益报告和披露数据记录到链上。
HavenRWAYieldClaim 负责验证 HavenNFT 持有人身份，并根据链上收益公式向符合条件的 NFT 持有人分发 USDT 收益。
```

该定位可以避免过度宣称真实证券所有权，同时满足 RWA Infra 类要求：

- 资产登记工具
- 数据上链模块
- 审计/披露记录
- 用户权益凭证验证
- 收益分发流程

## 7. 安全与控制机制

- `RWAAssetRegistry` 由 owner 控制资产登记和报告发布。
- `HavenRWAYieldClaim` 使用 `SafeERC20` 处理 USDT 转账。
- 只有 HavenNFT 当前持有人可以领取对应 tokenId 的收益。
- `lastClaimedAt[tokenId]` 防止同一时间段重复领取。
- 当 Registry 中资产被停用时，Claim 合约会拒绝领取。
- Claim 合约支持 owner 暂停。
- 未使用收益只能在 `yieldEndTime` 之后由 owner 提取。

## 8. 黑客松提交材料建议

建议准备以下材料：

- `RWAAssetRegistry` BscScan 链接
- 最新版 `HavenRWAYieldClaim` BscScan 链接
- HavenNFT BscScan 链接
- metadataURI
- reportURI
- `registerAsset` 交易哈希
- `publishReport` 交易哈希
- `fundRevenue` 交易哈希
- 多个用户 `claim` 交易哈希
- Demo 视频，展示钱包连接、NFT 查询和收益领取
- GitHub 仓库链接
- 产品或 Demo 页面链接，如有

## 9. 一句话总结

Haven RWA 通过 `RWAAssetRegistry` 记录 RWA 资产和收益数据，通过 `HavenRWAYieldClaim` 验证 HavenNFT 持有人并分发 USDT 收益，形成“资产登记、数据上链、收益入池、用户领取”的完整链上业务流程。

