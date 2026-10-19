# Known Issues

## Critical
- None identified that prevent application startup. 

## High
- **Kafka Dependency on Windows:** The native `confluent_kafka` C-extensions fail to load due to OS Application Control policies blocking the DLLs. A patch was applied to `ai-service/services/kafka_client.py` to make Kafka optional, but event streaming will fail silently if the broker/client is unavailable. 
- **Blockchain Connectivity Fallback:** In `retailerController.ts` (receiveProduct), if the blockchain transaction fails, it catches the error and aborts the database transaction. However, if the environment variables aren't set, it generates a fake `ethers.hexlify(randomBytes(32))` hash instead of failing or using a mock network.

## Medium
- **Hardcoded Secrets Fallback:** `backend/src/middleware/auth.ts` and `backend/src/controllers/authController.ts` fall back to `'farmchain_super_secret_key'` if `JWT_SECRET` is not provided in the environment. This is a security risk if deployed without proper env vars.
- **Admin Approval Blockchain Logic:** In `adminController.approveProduct`, if the blockchain transaction fails, it logs an error and returns 500. It doesn't have a retry mechanism.

## Low
- **Incomplete Schema Definitions for Phone/Address:** The `users` table schema in `schema.sql` does not include `phone` or `address` columns, but `adminController.ts` (`getUserDetails`) attempts to query them and uses a fallback if they fail. 
- **AI Service Hardcoded URLs:** The frontend might have hardcoded assumptions about where the AI service lives if not proxied through the backend properly (though the backend seems to proxy/call it).
