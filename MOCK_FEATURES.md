# Mock / Placeholder Features

## 1. AI Quality Classification
- **Location:** `ai-service/main.py` -> `/predict/quality`
- **Current Behavior:** Randomly selects "Excellent", "Good", "Average", or "Poor" based on predefined weights. Generates a random score and confidence.
- **Real or Simulated:** Simulated
- **Impact:** Does not provide real image-based quality analysis.
- **Recommended Future Phase:** Phase 2 (AI Upgrades)

## 2. AI Disease Detection
- **Location:** `ai-service/main.py` -> `/predict/disease`
- **Current Behavior:** Randomly assigns a disease or "None" based on weights.
- **Real or Simulated:** Simulated
- **Impact:** No actual crop analysis being performed.
- **Recommended Future Phase:** Phase 2 (AI Upgrades)

## 3. AI Shelf Life Prediction
- **Location:** `ai-service/main.py` -> `/predict/shelf-life`
- **Current Behavior:** Uses a base lookup table for crops (e.g., tomatoes = 7 days) and applies a random variance and temperature modifier.
- **Real or Simulated:** Simulated
- **Impact:** Dates are approximations and not scientifically modeled yet.
- **Recommended Future Phase:** Phase 2 (AI Upgrades)

## 4. AI Demand Forecasting
- **Location:** `ai-service/main.py` -> `/predict/demand`
- **Current Behavior:** Averages historical sales and applies a random variance (0.9 to 1.2) to project future days.
- **Real or Simulated:** Simulated
- **Impact:** Not reliable for actual business forecasting.
- **Recommended Future Phase:** Phase 2 (AI Upgrades)

## 5. AI Fraud Detection
- **Location:** `ai-service/main.py` -> `/predict/fraud`
- **Current Behavior:** Generates a random float between 0.0 and 0.3 to determine a fraud score.
- **Real or Simulated:** Simulated
- **Impact:** Will occasionally flag batches as fraudulent based on RNG, not actual supply chain anomalies.
- **Recommended Future Phase:** Phase 2 (AI Upgrades)

## 6. Fake Blockchain Hash Generation
- **Location:** `backend/src/controllers/retailerController.ts` -> `receiveProduct`
- **Current Behavior:** If blockchain env vars are missing, it generates a random 32-byte hex string (`ethers.hexlify(ethers.randomBytes(32))`) to simulate a transaction hash.
- **Real or Simulated:** Simulated fallback
- **Impact:** Allows the system to progress without a real blockchain, but creates fake data that looks real.
- **Recommended Future Phase:** Phase 3 (Blockchain / Infrastructure Hardening)
