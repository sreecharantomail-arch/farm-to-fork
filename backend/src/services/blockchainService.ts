import { ethers } from 'ethers';

const CONTRACT_ABI = [
  "function registerProduct(string memory _productId, string memory _name, string memory _category, string memory _batchNumber, uint256 _quantity, string memory _initialStatus) public",
  "function updateStage(string memory _productId, string memory _status, string memory _extraInfo) public",
  "function transferOwnership(string memory _productId, address _newOwner, string memory _status) public",
  "function recordReceipt(string memory _productId) public",
  "function products(string memory) public view returns (string id, string name, string category, string batchNumber, uint256 quantity, address farmer, address currentOwner, string status, uint256 timestamp, bool exists)",
  "function getProductHistory(string _productId) public view returns (tuple(string status, address owner, uint256 timestamp, string extraInfo)[])",
  "event ProductRegistered(string indexed productId, string name, address indexed farmer)",
  "event StageUpdated(string indexed productId, string status, address indexed owner)",
  "event OwnershipTransferred(string indexed productId, address indexed oldOwner, address indexed newOwner)"
];

export enum BlockchainStatus {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  SUBMISSION_PENDING = 'SUBMISSION_PENDING',
  ON_CHAIN_CONFIRMED = 'ON_CHAIN_CONFIRMED',
  ON_CHAIN_VERIFICATION_FAILED = 'ON_CHAIN_VERIFICATION_FAILED',
  DATABASE_ONLY = 'DATABASE_ONLY'
}

class BlockchainService {
  private provider: ethers.JsonRpcProvider | null = null;
  private wallet: ethers.Wallet | null = null;
  private signer: ethers.Signer | null = null;
  private contract: ethers.Contract | null = null;
  private contractAddress: string = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  public isConfigured: boolean = false;

  constructor() {
    this.initialize();
  }

  private initialize() {
    if (process.env.BLOCKCHAIN_DISABLED === 'true' || process.env.BLOCKCHAIN_RPC_URL === 'none') {
      this.provider = null;
      this.wallet = null;
      this.signer = null;
      this.contract = null;
      this.isConfigured = false;
      return;
    }

    const rpcUrl = (process.env.BLOCKCHAIN_RPC_URL && process.env.BLOCKCHAIN_RPC_URL.trim())
      ? process.env.BLOCKCHAIN_RPC_URL.trim()
      : 'http://127.0.0.1:8545';
    this.contractAddress = (process.env.CONTRACT_ADDRESS && process.env.CONTRACT_ADDRESS.trim())
      ? process.env.CONTRACT_ADDRESS.trim()
      : '0x5FbDB2315678afecb367f032d93F642f64180aa3';
    const privateKey = (process.env.BLOCKCHAIN_PRIVATE_KEY && process.env.BLOCKCHAIN_PRIVATE_KEY.trim())
      ? process.env.BLOCKCHAIN_PRIVATE_KEY.trim()
      : undefined;
    this.signer = null;

    try {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      if (privateKey) {
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.signer = this.wallet;
        this.contract = new ethers.Contract(this.contractAddress, CONTRACT_ABI, this.wallet);
      } else {
        this.wallet = null;
        this.contract = new ethers.Contract(this.contractAddress, CONTRACT_ABI, this.provider);
      }
      this.isConfigured = true;
    } catch (err) {
      console.error("BlockchainService: Initialization failed", err);
      this.isConfigured = false;
    }
  }

  private async getSigner(): Promise<ethers.Signer | null> {
    if (this.signer) {
      return this.signer;
    }

    if (!this.provider) {
      return null;
    }

    if (this.wallet) {
      this.signer = this.wallet;
      return this.signer;
    }

    // Attempt to resolve an unlocked development account for local networks
    try {
      const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545';
      const isLocalHost = rpcUrl.includes('127.0.0.1') || rpcUrl.includes('localhost');

      const network = await this.provider.getNetwork();
      const chainId = Number(network.chainId);
      // Hardhat development chain IDs are 1337 (configured) or 31337 (default hardhat)
      const isLocalChain = chainId === 1337 || chainId === 31337;

      if (isLocalHost || isLocalChain) {
        const accounts: string[] = await this.provider.send('eth_accounts', []);
        if (accounts && accounts.length > 0) {
          const unlockedSigner = await this.provider.getSigner(accounts[0]);
          this.signer = unlockedSigner;
          return this.signer;
        }
      }
    } catch (err) {
      console.warn("BlockchainService: Could not resolve local development signer:", err);
    }

    return null;
  }

  private async getWriteContract(): Promise<{ contract: ethers.Contract | null; error?: string }> {
    if (!this.isConfigured || !this.provider) {
      return { contract: null, error: 'Blockchain provider is not configured or offline' };
    }

    const signer = await this.getSigner();
    if (!signer) {
      return {
        contract: null,
        error: 'No transaction signer configured. For local development, ensure Hardhat node is running with unlocked accounts. For external networks, configure BLOCKCHAIN_PRIVATE_KEY.'
      };
    }

    try {
      const contractAddress = this.contractAddress || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
      const writeContract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
      return { contract: writeContract };
    } catch (err: any) {
      return { contract: null, error: err?.message || 'Failed to bind contract to transaction signer' };
    }
  }

  async verifyProduct(
    productId: string,
    expected?: { name?: string; batchNumber?: string; status?: string }
  ): Promise<{
    status: 'VERIFIED_ON_CHAIN' | 'NOT_ON_CHAIN' | 'BLOCKCHAIN_UNAVAILABLE' | 'RECORD_MISMATCH' | 'VERIFICATION_INCOMPLETE';
    isConfigured: boolean;
    contractAddress: string | null;
    network: string;
    chainData: {
      id: string;
      name: string;
      category: string;
      batchNumber: string;
      quantity: number;
      farmer: string;
      currentOwner: string;
      status: string;
      timestamp: number;
      history: Array<{ status: string; owner: string; timestamp: number; extraInfo: string }>;
    } | null;
    discrepancies: string[];
    message: string;
  }> {
    const contractAddress = process.env.CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';

    if (!this.provider) {
      return {
        status: 'BLOCKCHAIN_UNAVAILABLE',
        isConfigured: false,
        contractAddress: null,
        network: 'Offline',
        chainData: null,
        discrepancies: [],
        message: 'Blockchain provider is not configured or offline.'
      };
    }

    try {
      // Check RPC liveness
      await this.provider.getBlockNumber();
    } catch {
      return {
        status: 'BLOCKCHAIN_UNAVAILABLE',
        isConfigured: true,
        contractAddress,
        network: 'Unreachable',
        chainData: null,
        discrepancies: [],
        message: 'Blockchain service is currently unavailable. RPC node did not respond.'
      };
    }

    try {
      // Check contract code existence
      const code = await this.provider.getCode(contractAddress);
      if (!code || code === '0x') {
        return {
          status: 'BLOCKCHAIN_UNAVAILABLE',
          isConfigured: true,
          contractAddress,
          network: 'Local Testnet',
          chainData: null,
          discrepancies: [],
          message: 'Smart contract is not deployed at configured address.'
        };
      }

      const readContract = this.contract || new ethers.Contract(contractAddress, CONTRACT_ABI, this.provider);
      const productData = await readContract.products(productId);

      if (!productData || !productData.exists) {
        return {
          status: 'NOT_ON_CHAIN',
          isConfigured: true,
          contractAddress,
          network: 'Local Testnet',
          chainData: null,
          discrepancies: [],
          message: 'Product record is not anchored on the configured blockchain.'
        };
      }

      let historyEvents: Array<{ status: string; owner: string; timestamp: number; extraInfo: string }> = [];
      try {
        const hist = await readContract.getProductHistory(productId);
        if (hist && Array.isArray(hist)) {
          historyEvents = hist.map((h: any) => ({
            status: h.status,
            owner: h.owner,
            timestamp: Number(h.timestamp),
            extraInfo: h.extraInfo
          }));
        }
      } catch {
        // history read is optional
      }

      const chainData = {
        id: productData.id,
        name: productData.name,
        category: productData.category,
        batchNumber: productData.batchNumber,
        quantity: Number(productData.quantity),
        farmer: productData.farmer,
        currentOwner: productData.currentOwner,
        status: productData.status,
        timestamp: Number(productData.timestamp),
        history: historyEvents
      };

      const discrepancies: string[] = [];
      if (expected?.name && expected.name.trim().toLowerCase() !== chainData.name.trim().toLowerCase()) {
        discrepancies.push(`Name discrepancy: Database="${expected.name}", Blockchain="${chainData.name}"`);
      }
      if (expected?.batchNumber && expected.batchNumber.trim() !== chainData.batchNumber.trim()) {
        discrepancies.push(`Batch discrepancy: Database="${expected.batchNumber}", Blockchain="${chainData.batchNumber}"`);
      }

      if (discrepancies.length > 0) {
        return {
          status: 'RECORD_MISMATCH',
          isConfigured: true,
          contractAddress,
          network: 'Local Testnet',
          chainData,
          discrepancies,
          message: 'Database and blockchain records do not agree on comparable fields.'
        };
      }

      return {
        status: 'VERIFIED_ON_CHAIN',
        isConfigured: true,
        contractAddress,
        network: 'Local Testnet',
        chainData,
        discrepancies: [],
        message: 'Verified against available on-chain smart contract records.'
      };
    } catch (err: any) {
      return {
        status: 'BLOCKCHAIN_UNAVAILABLE',
        isConfigured: true,
        contractAddress,
        network: 'Local Testnet',
        chainData: null,
        discrepancies: [],
        message: err?.message || 'Error executing smart contract verification.'
      };
    }
  }

  async getHealth() {
    const contractAddress = this.contractAddress || process.env.CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
    if (!this.isConfigured || !this.provider) {
      return {
        status: 'warning',
        message: 'Blockchain provider not configured on backend',
        walletBalance: '0.0',
        network: 'Unknown',
        contractAddress
      };
    }
    try {
      const network = await this.provider.getNetwork();
      const networkName = network.name && network.name !== 'unknown' ? network.name : `chainId ${network.chainId.toString()}`;

      const signer = await this.getSigner();
      if (!signer) {
        return {
          status: 'warning',
          message: 'Blockchain node reachable but no signer configured',
          walletBalance: '0.0',
          network: networkName,
          contractAddress
        };
      }

      const address = await signer.getAddress();
      const balance = await this.provider.getBalance(address);

      return {
        status: 'healthy',
        message: 'Connected to blockchain',
        walletAddress: address,
        walletBalance: ethers.formatEther(balance),
        network: networkName,
        contractAddress
      };
    } catch (err: any) {
      return {
        status: 'error',
        message: err?.message || 'Blockchain Connection Error'
      };
    }
  }

  async registerProduct(
    productId: string,
    name: string,
    category: string,
    batchNumber: string,
    quantity: number,
    initialStatus: string
  ): Promise<{ status: BlockchainStatus; txHash: string | null; error?: string; blockNumber?: number }> {
    const { contract, error } = await this.getWriteContract();
    if (!contract) {
      console.warn("BlockchainService: registerProduct skipped -", error);
      return { status: BlockchainStatus.NOT_CONFIGURED, txHash: null, error };
    }

    try {
      const tx = await contract.registerProduct(productId, name, category, batchNumber, quantity, initialStatus);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        console.error("BlockchainService: registerProduct transaction reverted on-chain");
        return {
          status: BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED,
          txHash: receipt?.hash || tx.hash || null,
          error: 'Transaction reverted on-chain'
        };
      }
      return {
        status: BlockchainStatus.ON_CHAIN_CONFIRMED,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      };
    } catch (err: any) {
      console.error("BlockchainService: registerProduct failed:", err?.reason || err?.message || err);
      return {
        status: BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED,
        txHash: null,
        error: err?.reason || err?.shortMessage || err?.message || 'Transaction execution failed'
      };
    }
  }

  async updateStage(
    productId: string,
    status: string,
    extraInfo: string
  ): Promise<{ status: BlockchainStatus; txHash: string | null; error?: string; blockNumber?: number }> {
    const { contract, error } = await this.getWriteContract();
    if (!contract) {
      console.warn("BlockchainService: updateStage skipped -", error);
      return { status: BlockchainStatus.NOT_CONFIGURED, txHash: null, error };
    }

    try {
      const tx = await contract.updateStage(productId, status, extraInfo);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        return {
          status: BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED,
          txHash: receipt?.hash || tx.hash || null,
          error: 'Transaction reverted on-chain'
        };
      }
      return {
        status: BlockchainStatus.ON_CHAIN_CONFIRMED,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      };
    } catch (err: any) {
      console.error("BlockchainService: updateStage failed:", err?.reason || err?.message || err);
      return {
        status: BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED,
        txHash: null,
        error: err?.reason || err?.shortMessage || err?.message || 'Transaction execution failed'
      };
    }
  }

  async transferOwnership(
    productId: string,
    newOwnerAddress: string,
    status: string
  ): Promise<{ status: BlockchainStatus; txHash: string | null; error?: string; blockNumber?: number }> {
    const { contract, error } = await this.getWriteContract();
    if (!contract) {
      console.warn("BlockchainService: transferOwnership skipped -", error);
      return { status: BlockchainStatus.NOT_CONFIGURED, txHash: null, error };
    }

    try {
      const tx = await contract.transferOwnership(productId, newOwnerAddress, status);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        return {
          status: BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED,
          txHash: receipt?.hash || tx.hash || null,
          error: 'Transaction reverted on-chain'
        };
      }
      return {
        status: BlockchainStatus.ON_CHAIN_CONFIRMED,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      };
    } catch (err: any) {
      console.error("BlockchainService: transferOwnership failed:", err?.reason || err?.message || err);
      return {
        status: BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED,
        txHash: null,
        error: err?.reason || err?.shortMessage || err?.message || 'Transaction execution failed'
      };
    }
  }

  async recordReceipt(
    productId: string
  ): Promise<{ status: BlockchainStatus; txHash: string | null; error?: string; blockNumber?: number }> {
    const { contract, error } = await this.getWriteContract();
    if (!contract) {
      console.warn("BlockchainService: recordReceipt skipped -", error);
      return { status: BlockchainStatus.NOT_CONFIGURED, txHash: null, error };
    }

    try {
      const tx = await contract.recordReceipt(productId);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        return {
          status: BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED,
          txHash: receipt?.hash || tx.hash || null,
          error: 'Transaction reverted on-chain'
        };
      }
      return {
        status: BlockchainStatus.ON_CHAIN_CONFIRMED,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber
      };
    } catch (err: any) {
      console.error("BlockchainService: recordReceipt failed:", err?.reason || err?.message || err);
      return {
        status: BlockchainStatus.ON_CHAIN_VERIFICATION_FAILED,
        txHash: null,
        error: err?.reason || err?.shortMessage || err?.message || 'Transaction execution failed'
      };
    }
  }
}

export const blockchainService = new BlockchainService();
