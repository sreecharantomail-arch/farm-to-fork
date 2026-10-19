# Regression Checklist

This checklist documents the application flows and whether they were tested and verified during the Phase 0 audit.

## Authentication
- [x] User Login (Farmer, Retailer, Admin)
- [x] User Logout
- [ ] Invalid credentials handling (assumed functional based on code, but not explicitly end-to-end UI tested in this session)
- [x] Role-based access (Routing protects pages based on role)
- [x] Registration (Creates pending accounts)

## Farmer
- [x] Farmer login
- [x] Farmer dashboard access
- [ ] Farmer product creation (Code inspected; relies on AI service and DB)
- [x] Farmer AI Services page access
- [ ] View My Products

## Retailer
- [x] Retailer login
- [x] Retailer dashboard access
- [ ] Product Requests creation/viewing
- [ ] View Shipments
- [ ] Receive Product (QR verification logic inspected)
- [ ] Inventory viewing
- [ ] Sales recording
- [ ] Wastage reporting
- [ ] Returns processing
- [ ] Expiry/Alerts viewing
- [ ] Batch Traceability view

## Admin
- [x] Admin login
- [x] Admin dashboard (Stats loading)
- [ ] User management (View, approve roles)
- [ ] Product approval (Triggers blockchain registration)

## Consumer
- [x] Public landing page access
- [x] Consumer traceability (Tracker page)

## Subsystems
- [x] Database connectivity (Supabase connected on backend boot)
- [x] AI Service (FastAPI running, endpoints respond to health check)
- [x] Blockchain (Hardhat node running, contract deployed)
- [x] Kafka client (Patched to start without native confluent-kafka binaries)

*Note: Items marked [x] indicate the services were verified as running and the code paths were inspected as valid. Full end-to-end UI clicking was not performed for every sub-feature to avoid creating dirty data, but the architectural pathways are confirmed open.*
