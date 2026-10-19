# Route and API Inventory

## Frontend Routes

### Public Routes
- `/` - Landing Page
- `/track`, `/tracker`, `/verify` - Tracker Page (Traceability)
- `/login` - Login Page
- `/register` - Registration Page

### Protected Routes (General Dashboard)
- `/admin` - Admin Dashboard
- `/admin/analytics` - Admin Analytics
- `/admin/users` - Admin User Management
- `/admin/users/:id` - Admin User Details
- `/admin/products` - Admin Products
- `/admin/products/:id` - Admin Product Details

- `/farmer` - Farmer Dashboard
- `/farmer/products` - Farmer's Products
- `/farmer/ai-services` - Farmer AI Services

- `/processor` - Processor Dashboard
- `/distributor` - Distributor Dashboard

### Protected Routes (Retailer)
- `/retailer` - Retailer Dashboard
- `/retailer/requests` - Product Requests
- `/retailer/shipments` - Shipments
- `/retailer/receive` - Receive Product (QR Verification)
- `/retailer/inventory` - Inventory Management
- `/retailer/sales` - Sales tracking
- `/retailer/wastage` - Wastage reporting
- `/retailer/expiry` - Expiry alerts
- `/retailer/returns` - Returns processing
- `/retailer/alerts` - Alerts
- `/retailer/traceability` - Batch Traceability

## Backend APIs

### Auth (`/api/auth`)
- `POST /register` - Register a new user.
- `POST /login` - Login and get JWT token.
- `PUT /status` (Protected) - Update user availability status.
- `GET /distributors` (Protected) - Get list of distributors.

### Products (`/api/products`)
- `GET /` (Protected) - Get all products.
- `GET /blockchain/:id` - Get product details for public verification by ID.
- `GET /my` (Protected) - Get products belonging to the logged-in farmer.
- `POST /` (Protected, Admin/Farmer) - Register a new product (handles image upload, AI scoring).
- `PUT /:id/status` (Protected) - Update product status/owner/blockchain hash.
- `DELETE /:id` (Protected, Admin/Farmer) - Delete a product.

### Admin (`/api/admin`)
- `GET /stats` (Protected, Admin) - Get dashboard stats (counts, alerts, recent activity).
- `GET /analytics` (Protected, Admin) - Get analytics data (volume, quality, txs).
- `GET /users` (Protected, Admin) - Get all users.
- `GET /users/:id/details` (Protected, Admin) - Get specific user details and stats.
- `GET /products/:id/details` (Protected, Admin) - Get specific product details.
- `PUT /users/:id/role` (Protected, Admin) - Update user role (e.g., approve pending).
- `DELETE /users/:id` (Protected, Admin) - Delete a user.
- `PUT /products/:id/approve` (Protected, Admin) - Approve product and register on blockchain.
- `GET /blockchain-health` (Protected, Admin) - Check blockchain connection/wallet balance.

### Retailer (`/api/retailer`)
- `GET /test` (Protected, Retailer) - Test route.
- `POST /requests` (Protected, Retailer) - Create a product request.
- `GET /requests` (Protected, Retailer) - Get logged-in retailer's requests.
- `GET /shipments` (Protected, Retailer) - Get logged-in retailer's shipments.
- `POST /verify-batch` (Protected, Retailer) - Verify shipment batch with QR data.
- `POST /receive-product` (Protected, Retailer) - Receive product, update blockchain, create inventory & traceability events.
- `GET /inventory` (Protected, Retailer) - Get retailer's inventory.
- `POST /sales` (Protected, Retailer) - Record a sale, update inventory.
- `GET /sales` (Protected, Retailer) - Get retailer's sales history.
- `POST /wastage` (Protected, Retailer) - Report wastage, update inventory.
- `GET /wastage` (Protected, Retailer) - Get wastage history.
- `GET /traceability/:batch_number` (Protected, Retailer) - Get batch traceability (product + events).
- `POST /returns` (Protected, Retailer) - Process a return (restock or waste).
- `GET /returns` (Protected, Retailer) - Get returns history.
- `GET /dashboard` (Protected, Retailer) - Get dashboard data (inventory, low stock, revenue).

## AI Service APIs (`/api/ai` or direct port 8000)
- `POST /predict/quality` - Classify crop quality from image (Mocked).
- `POST /predict/disease` - Detect crop disease (Mocked).
- `POST /predict/shelf-life` - Predict shelf life (Mocked).
- `POST /api/farmer/price-prediction` - Predict multi-day prices (Real, XGBoost).
- `POST /predict/demand` - Forecast demand (Mocked).
- `POST /predict/fraud` - Detect fraud (Mocked).
- `GET /health` - Service health check.
- `GET /api/kafka/health` - Kafka health check.
