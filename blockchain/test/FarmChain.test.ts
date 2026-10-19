import { describe } from "mocha";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("FarmChain", function () {
  async function deployFarmChain() {
    const [owner, farmer, processor] = await ethers.getSigners();
    const FarmChain = await ethers.getContractFactory("FarmChain");
    const farmChain = await FarmChain.deploy();
    return { farmChain, owner, farmer, processor };
  }

  it("Should register a new product", async function () {
    const { farmChain, farmer } = await deployFarmChain();
    await farmChain.connect(farmer).registerProduct(
      "uuid-1234",
      "Organic Tomatoes",
      "Vegetables",
      "BCH-001",
      500,
      "Harvested"
    );
    const product = await farmChain.products("uuid-1234");
    expect(product.exists).to.equal(true);
    expect(product.name).to.equal("Organic Tomatoes");
  });

  it("Should store product details correctly", async function () {
    const { farmChain, farmer } = await deployFarmChain();
    await farmChain.connect(farmer).registerProduct("uuid-5678", "Mangoes", "Fruits", "BCH-002", 200, "Harvested");
    const product = await farmChain.products("uuid-5678");
    expect(product.name).to.equal("Mangoes");
    expect(product.category).to.equal("Fruits");
    expect(product.farmer).to.equal(farmer.address);
  });

  it("Should update product stage", async function () {
    const { farmChain, farmer } = await deployFarmChain();
    await farmChain.connect(farmer).registerProduct("uuid-9012", "Wheat", "Grains", "BCH-003", 1000, "Harvested");
    await farmChain.connect(farmer).updateStage("uuid-9012", "Processed", "Processing completed");
    const product = await farmChain.products("uuid-9012");
    expect(product.status).to.equal("Processed");
  });

  it("Should transfer ownership", async function () {
    const { farmChain, farmer, processor } = await deployFarmChain();
    await farmChain.connect(farmer).registerProduct("uuid-3456", "Rice", "Grains", "BCH-004", 750, "Harvested");
    await farmChain.connect(farmer).transferOwnership("uuid-3456", processor.address, "Transferred to Processor");
    const product = await farmChain.products("uuid-3456");
    expect(product.currentOwner).to.equal(processor.address);
  });

  it("Should record receipt", async function () {
    const { farmChain, farmer, processor } = await deployFarmChain();
    await farmChain.connect(farmer).registerProduct("uuid-7890", "Corn", "Grains", "BCH-005", 200, "Harvested");
    await farmChain.connect(farmer).recordReceipt("uuid-7890");
    const product = await farmChain.products("uuid-7890");
    expect(product.status).to.equal("Received");
  });

  it("Should return product history", async function () {
    const { farmChain, farmer } = await deployFarmChain();
    await farmChain.connect(farmer).registerProduct("uuid-abcd", "Apples", "Fruits", "BCH-005", 300, "Harvested");
    await farmChain.connect(farmer).updateStage("uuid-abcd", "In Transit", "Picked up by distributor");
    const history = await farmChain.getProductHistory("uuid-abcd");
    expect(history.length).to.equal(2);
    expect(history[0].status).to.equal("Harvested");
    expect(history[1].status).to.equal("In Transit");
  });
});
