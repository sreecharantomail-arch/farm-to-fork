# Project Baseline: Farm-to-Fork Tracker

## Authentication
- **Login:** Users can log in using email and password via `AuthController.login`. Returns a JWT token.
- **Registration:** Users can register (`AuthController.register`). Roles other than 'consumer' are prefixed with `pending_` and require admin approval.
- **Role-based Access:** Handled via JWT token and backend middleware (`protect`, `authorize`), and frontend `ProtectedRoute`.

## Roles & Features

### Farmer
- **Login:** Yes.
- **Dashboard:** Yes (`FarmerDashboard.tsx`).
- **Products:** Can register new products with images, which triggers AI quality and shelf-life predictions. Can view their own products (`MyProductsPage.tsx`).
- **AI:** Can view AI services (`FarmerAIServices.tsx`).
- **Traceability:** Yes, products are linked to the farmer.

### Processor
- **Login:** Yes.
- **Dashboard:** Yes (`ProcessorDashboard.tsx`).
- **Existing Features:** Can view assigned shipments, update stages.

### Distributor
- **Login:** Yes.
- **Dashboard:** Yes (`DistributorDashboard.tsx`).
- **Existing Features:** Can manage shipments in transit.

### Retailer
- **Login:** Yes.
- **Dashboard:** Yes (`RetailerDashboard.tsx`, `pages/retailer/Dashboard.tsx`).
- **Existing Features:**
  - **Requests:** Can create and view product requests.
  - **Shipments & Receive:** Can view shipments and receive them by verifying the batch QR code. Receiving triggers blockchain record and traceability events.
  - **Inventory:** Can view inventory, track expiry dates.
  - **Sales:** Can record sales, updating inventory and creating traceability events.
  - **Wastage:** Can report wastage.
  - **Returns:** Can process customer returns (restock or wastage).
  - **Alerts & Expiry:** Views for low stock and expired items.
  - **Traceability:** Can view batch traceability history.

### Admin
- **Login:** Yes.
- **Dashboard:** Yes (`Dashboard.tsx`).
- **Existing Features:**
  - **Analytics:** View system-wide stats (users, volume, quality).
  - **Users:** Manage users, approve pending roles (`AdminUsers.tsx`).
  - **Products:** Approve pending products to be recorded on the blockchain (`AdminProducts.tsx`).

### Consumer
- **Login:** Yes.
- **Existing Features:**
  - **Tracker/Traceability:** Can track a product batch (`Tracker.tsx`) by entering an ID or scanning a QR code, which fetches blockchain/database history.

## Core Services

- **Database:** Supabase (Postgres) handling users, products, shipments, inventory, sales, returns, wastage, and traceability events.
- **AI:** FastAPI service with endpoints for quality prediction, disease detection, shelf-life, price prediction, demand forecasting, and fraud detection. Mostly mocked except for price prediction which uses XGBoost.
- **Blockchain:** Hardhat local node. Smart contract `FarmChain.sol` for registering products, updating stages, and recording receipts.
- **Kafka / Event System:** Implementation started for event-driven architecture using an Outbox pattern (`event_outbox` table). Kafka producer wrapper exists in AI service and backend.
- **QR Functionality:** Batch verification at retailer level relies on QR code data matching the batch number.
- **Notifications / Alerts:** AI alerts for poor quality products (Admin dashboard), low stock/expiry alerts (Retailer dashboard).
- **Analytics:** Admin dashboard provides metrics on users, product volume, quality distribution, and recent blockchain transactions. Retailer dashboard provides sales and inventory stats.
