// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FarmChain {
    struct Product {
        string id; // Canonical UUID from backend
        string name;
        string category;
        string batchNumber;
        uint256 quantity;
        address farmer;
        address currentOwner;
        string status; // e.g., "Harvested", "Processed", "In Transit", "Retail"
        uint256 timestamp;
        bool exists;
    }

    struct HistoryEvent {
        string status;
        address owner;
        uint256 timestamp;
        string extraInfo;
    }

    mapping(string => Product) public products;
    mapping(string => HistoryEvent[]) public productHistory;

    event ProductRegistered(string indexed productId, string name, address indexed farmer);
    event StageUpdated(string indexed productId, string status, address indexed owner);
    event OwnershipTransferred(string indexed productId, address indexed oldOwner, address indexed newOwner);

    function registerProduct(
        string memory _productId,
        string memory _name,
        string memory _category,
        string memory _batchNumber,
        uint256 _quantity,
        string memory _initialStatus
    ) public {
        require(bytes(_productId).length > 0, "Invalid product ID");
        require(!products[_productId].exists, "Product already registered");

        products[_productId] = Product(
            _productId,
            _name,
            _category,
            _batchNumber,
            _quantity,
            msg.sender,
            msg.sender,
            _initialStatus,
            block.timestamp,
            true
        );

        productHistory[_productId].push(HistoryEvent(
            _initialStatus,
            msg.sender,
            block.timestamp,
            "Registration"
        ));

        emit ProductRegistered(_productId, _name, msg.sender);
    }

    function updateStage(string memory _productId, string memory _status, string memory _extraInfo) public {
        require(products[_productId].exists, "Product does not exist");
        require(products[_productId].currentOwner == msg.sender, "Only current owner can update stage");

        products[_productId].status = _status;
        products[_productId].timestamp = block.timestamp;

        productHistory[_productId].push(HistoryEvent(
            _status,
            msg.sender,
            block.timestamp,
            _extraInfo
        ));

        emit StageUpdated(_productId, _status, msg.sender);
    }

    function transferOwnership(string memory _productId, address _newOwner, string memory _status) public {
        require(products[_productId].exists, "Product does not exist");
        require(products[_productId].currentOwner == msg.sender, "Only current owner can transfer");
        require(_newOwner != address(0), "Invalid new owner");

        address oldOwner = products[_productId].currentOwner;
        products[_productId].currentOwner = _newOwner;
        products[_productId].status = _status;
        products[_productId].timestamp = block.timestamp;

        productHistory[_productId].push(HistoryEvent(
            _status,
            _newOwner,
            block.timestamp,
            "Ownership Transferred"
        ));

        emit OwnershipTransferred(_productId, oldOwner, _newOwner);
    }

    function recordReceipt(string memory _productId) public {
        require(products[_productId].exists, "Product does not exist");
        require(products[_productId].currentOwner == msg.sender, "Only current owner can record receipt");
        
        products[_productId].status = "Received";
        products[_productId].timestamp = block.timestamp;

        productHistory[_productId].push(HistoryEvent(
            "Received",
            msg.sender,
            block.timestamp,
            "Product Received"
        ));

        emit StageUpdated(_productId, "Received", msg.sender);
    }

    function getProductHistory(string memory _productId) public view returns (HistoryEvent[] memory) {
        require(products[_productId].exists, "Product does not exist");
        return productHistory[_productId];
    }
}
