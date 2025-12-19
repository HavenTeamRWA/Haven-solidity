import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// 验证合约（开源）
export async function verifyContract(
  network: string, 
  address: string, 
  ...args: any[]
): Promise<boolean> {
  try {
    const constructorArgs = args.length > 0 ? args.map(arg => `"${arg}"`).join(" ") : "";
    const command = `npx hardhat verify --network ${network} ${address} ${constructorArgs}`;
    
    console.log(`🔍 验证合约: ${address}`);
    console.log(`📝 执行命令: ${command}`);
    
    const { stdout, stderr } = await execAsync(command);
    
    if (stdout) {
      console.log("✅ 验证成功:", stdout);
      
      // 显示浏览器链接
      const baseUrl = getExplorerUrl(network);
      console.log(`🔗 浏览器链接: ${baseUrl}/address/${address}`);
      
      return true;
    }
    if (stderr) {
      console.log("⚠️ 警告:", stderr);
    }
    
    console.log("🎉 合约验证完成！");
    return true;
  } catch (error: any) {
    console.error("❌ 验证失败:", error.message);
    
    // 检查是否是已验证的错误
    if (error.message.includes("Already Verified") || error.message.includes("already verified")) {
      console.log("ℹ️ 合约已经验证过了");
      
      // 即使已经验证，也显示浏览器链接
      const baseUrl = getExplorerUrl(network);
      console.log(`🔗 浏览器链接: ${baseUrl}/address/${address}`);
      
      return true;
    }
    
    throw error;
  }
}

// 获取网络对应的浏览器 URL
function getExplorerUrl(network: string): string {
  const chainIds: { [key: string]: number } = {
    'bscTestnet': 97,
    'bsc': 56,
    'hardhatMainnet': 31337,
    'hardhatOp': 31337,
    'sepolia': 11155111,
  };
  
  const chainId = chainIds[network] || 1;
  
  const explorerUrls: { [key: number]: string } = {
    97: 'https://testnet.bscscan.com',
    56: 'https://bscscan.com',
    11155111: 'https://sepolia.etherscan.io',
    1: 'https://etherscan.io',
    31337: 'https://localhost:8545'
  };
  
  return explorerUrls[chainId] || 'https://etherscan.io';
}

// 批量验证合约
export async function verifyAllContracts(
  network: string,
  contracts: Array<{
    name: string;
    address: string;
    args?: any[];
  }>
): Promise<void> {
  console.log(`🚀 开始批量验证 ${contracts.length} 个合约...`);
  
  for (const contract of contracts) {
    try {
      console.log(`\n📦 验证 ${contract.name}...`);
      await verifyContract(network, contract.address, ...(contract.args || []));
    } catch (error) {
      console.error(`❌ ${contract.name} 验证失败:`, error);
    }
  }
  
  console.log("\n🎉 批量验证完成！");
  
  // 显示浏览器链接
  const baseUrl = getExplorerUrl(network);
  console.log(`\n🔗 ${network} 浏览器链接:`);
  contracts.forEach(contract => {
    console.log(`${contract.name}: ${baseUrl}/address/${contract.address}`);
  });
}
