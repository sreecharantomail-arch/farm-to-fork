-- Migration: 7_add_blockchain_status.sql
-- Description: Adds formal explicit blockchain status tracking to the products table.

ALTER TABLE products 
ADD COLUMN IF NOT EXISTS blockchain_status VARCHAR(50) DEFAULT 'DATABASE_ONLY',
ADD COLUMN IF NOT EXISTS blockchain_network VARCHAR(50) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS blockchain_contract_address VARCHAR(255) DEFAULT NULL;

-- If a hash already exists, assume it was confirmed on the previous network
UPDATE products 
SET blockchain_status = 'ON_CHAIN_CONFIRMED'
WHERE blockchain_hash IS NOT NULL AND blockchain_status = 'DATABASE_ONLY';
