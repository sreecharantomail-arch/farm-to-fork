# Database Inventory (Supabase / Postgres)

## Overview
The application uses PostgreSQL (via Supabase) with Row Level Security (RLS) enabled. The Express backend connects using the Service Role key to bypass RLS, acting as the centralized authority.

## Tables

### 1. `users`
- **Purpose:** Stores all user accounts (Farmers, Retailers, Admins, etc.) and their roles.
- **Important Columns:**
  - `id` (UUID, Primary Key)
  - `email` (Text, Unique)
  - `password` (Text, hashed)
  - `role` (Text, constrained to specific roles or pending roles)
  - `wallet_address` (Text)
  - `availability_status` (Text)

### 2. `products`
- **Purpose:** Represents a batch of agricultural products registered by a farmer.
- **Important Columns:**
  - `id` (UUID, Primary Key)
  - `product_id` (Integer) - Mapping to blockchain ID.
  - `batch_number` (Text)
  - `quantity` (Numeric)
  - `farmer_id` (UUID, FK -> `users.id`)
  - `current_owner_id` (UUID, FK -> `users.id`)
  - `status` (Text) - E.g., 'Harvested', 'Pending Approval'
  - `blockchain_hash` (Text) - Transaction hash when recorded on blockchain.
  - `ai_quality_score`, `ai_quality_label`, `ai_shelf_life` (AI predictions)
  - `product_image_url`, `expiry_date`

### 3. `product_requests`
- **Purpose:** Retailers can request specific products.
- **Important Columns:**
  - `id` (UUID, PK)
  - `request_id` (Text) - e.g., 'REQ-1001'
  - `retailer_id` (UUID, FK -> `users.id`)
  - `product_name`, `quantity`, `unit`, `required_date`
  - `status` (Text) - e.g., 'PENDING', 'FULFILLED'

### 4. `shipments`
- **Purpose:** Tracks the physical movement of products between actors.
- **Important Columns:**
  - `id` (UUID, PK)
  - `shipment_tracking_id` (Text)
  - `request_id` (UUID, FK -> `product_requests.id`)
  - `batch_number` (Text)
  - `product_id` (UUID, FK -> `products.id`)
  - `retailer_id`, `processor_id`, `distributor_id` (UUIDs, FK -> `users.id`)
  - `status` (Text) - e.g., 'IN_TRANSIT', 'RECEIVED'

### 5. `retailer_inventory`
- **Purpose:** Tracks stock levels at retail locations.
- **Important Columns:**
  - `id` (UUID, PK)
  - `retailer_id` (UUID, FK -> `users.id`)
  - `product_id` (UUID, FK -> `products.id`)
  - `batch_number` (Text)
  - `quantity`, `unit`
  - `expiry_date`
  - `status` (Text) - e.g., 'AVAILABLE', 'DEPLETED'

### 6. `retailer_sales`
- **Purpose:** Records sales made by retailers.
- **Important Columns:**
  - `id` (UUID, PK)
  - `retailer_id` (UUID, FK -> `users.id`)
  - `inventory_id` (UUID, FK -> `retailer_inventory.id`)
  - `quantity_sold`, `price_per_unit`

### 7. `retailer_wastage`
- **Purpose:** Logs inventory lost due to damage or expiration.
- **Important Columns:**
  - `id` (UUID, PK)
  - `retailer_id` (UUID, FK -> `users.id`)
  - `inventory_id` (UUID, FK -> `retailer_inventory.id`)
  - `quantity`, `reason`

### 8. `retailer_returns`
- **Purpose:** Logs products returned by consumers.
- **Important Columns:**
  - `id` (UUID, PK)
  - `retailer_id` (UUID, FK -> `users.id`)
  - `inventory_id` (UUID, FK -> `retailer_inventory.id`)
  - `quantity`, `condition`, `reason`

### 9. `traceability_events`
- **Purpose:** Immutable log of events happening to a batch (used for timeline).
- **Important Columns:**
  - `id` (UUID, PK)
  - `product_id` (UUID, FK -> `products.id`)
  - `batch_number` (Text)
  - `event_type` (Text)
  - `actor_id` (UUID, FK -> `users.id`)
  - `blockchain_hash` (Text)
  - `metadata` (JSONB)

### 10. `event_outbox`
- **Purpose:** Implements the Transactional Outbox pattern for Kafka event streaming.
- **Important Columns:**
  - `id` (UUID, PK)
  - `event_id` (UUID)
  - `event_type` (Text)
  - `topic` (Text)
  - `payload` (JSONB)
  - `processed` (Boolean) - Default False.

## Storage
- **Buckets:** `product-images` (Public)

## Migrations / Schema
- Core schema is in `backend/supabase/schema.sql`.
- Contains triggers for auto-updating `updated_at`.
