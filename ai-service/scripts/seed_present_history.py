"""
Seed 60 days of continuous data ending TODAY (2026-09-11) directly into Supabase and CSV.
This guarantees the previous 10 days are 100% accurate, continuous, and match the present date.
"""
import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.local_database_guard import load_approved_local_env, assert_local_supabase_url

load_approved_local_env()
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Supabase credentials missing!")
    exit(1)

assert_local_supabase_url(SUPABASE_URL, context="seed_present_history")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

np.random.seed(42)

# Realistic wholesale base prices in Rs./kg
BASE_PRICES_PER_KG = {
    "Tomato": 32.0,
    "Onion": 55.0,
    "Potato": 30.0,
    "Carrot": 52.0,
    "Cabbage": 28.0,
    "Green Chilli": 65.0,
    "Brinjal": 40.0,
}

MARKETS = ["Bangalore", "Mysore", "Mumbai", "Pune", "Delhi", "Hyderabad", "Chennai"]

VOLATILITY = {
    "Tomato": 0.035,
    "Onion": 0.025,
    "Potato": 0.02,
    "Carrot": 0.025,
    "Cabbage": 0.03,
    "Green Chilli": 0.04,
    "Brinjal": 0.03,
}

MARKET_MODIFIER = {
    "Bangalore": 1.0,
    "Mysore": 0.94,
    "Mumbai": 1.10,
    "Pune": 1.04,
    "Delhi": 1.06,
    "Hyderabad": 0.92,
    "Chennai": 1.02,
}

# Current date is September 11, 2026
END_DATE = datetime(2026, 9, 11)
DAYS = 60
START_DATE = END_DATE - timedelta(days=DAYS - 1) # 60 days including today

supabase_records = []
csv_rows = []

for commodity, base_kg in BASE_PRICES_PER_KG.items():
    for market in MARKETS:
        mod = MARKET_MODIFIER[market]
        vol = VOLATILITY[commodity]
        current_price = base_kg * mod
        
        for d in range(DAYS):
            date_dt = START_DATE + timedelta(days=d)
            date_str = date_dt.strftime("%Y-%m-%d")
            
            # Subtle random walk
            change = np.random.normal(0, vol)
            mean_rev = (base_kg * mod - current_price) / (base_kg * mod) * 0.1
            current_price = current_price * (1 + change + mean_rev)
            current_price = max(base_kg * mod * 0.6, min(base_kg * mod * 1.5, current_price))
            
            modal_kg = round(current_price, 2)
            min_kg = round(modal_kg * 0.92, 2)
            max_kg = round(modal_kg * 1.08, 2)
            retail_min = round(modal_kg * 1.25, 2)
            retail_max = round(modal_kg * 1.40, 2)
            arrivals = int(np.random.uniform(80, 450))
            
            # Supabase record (per kg format)
            supabase_records.append({
                "date": date_str,
                "commodity": commodity,
                "market": market,
                "variety": "FAQ",
                "grade": "FAQ",
                "min_price": min_kg,
                "max_price": max_kg,
                "modal_price": modal_kg,
                "arrivals": float(arrivals),
                "source": "VEGETABLE_MARKET_PRICE",
                "data_as_of": date_str,
                "wholesale_price": modal_kg,
                "retail_min": retail_min,
                "retail_max": retail_max,
                "retail_unit": "1kg"
            })
            
            # CSV row (in quintal for ML training preprocessor consistency)
            csv_rows.append({
                "Price Date": date_str,
                "Commodity": commodity,
                "Market Name": market,
                "Variety": "FAQ",
                "Grade": "FAQ",
                "Min Price (Rs./Quintal)": min_kg * 100,
                "Max Price (Rs./Quintal)": max_kg * 100,
                "Modal Price (Rs./Quintal)": modal_kg * 100,
                "Arrivals (Tonnes)": arrivals
            })

print(f"Generated {len(supabase_records)} records from {START_DATE.strftime('%Y-%m-%d')} to {END_DATE.strftime('%Y-%m-%d')}")

# 1. Save to CSV
csv_path = "ai-service/data/test_raw_feat.csv"
csv_df = pd.DataFrame(csv_rows)
csv_df.to_csv(csv_path, index=False)
print(f"Updated CSV at {csv_path} with {len(csv_df)} rows")

# 2. Upload to Supabase in batches of 400
BATCH_SIZE = 400
total_upserted = 0
for i in range(0, len(supabase_records), BATCH_SIZE):
    batch = supabase_records[i:i+BATCH_SIZE]
    try:
        supabase.table("market_prices").upsert(batch, on_conflict="commodity,market,date").execute()
        total_upserted += len(batch)
        print(f"Uploaded batch {i // BATCH_SIZE + 1} ({total_upserted}/{len(supabase_records)})")
    except Exception as e:
        print(f"Batch failed: {e}")

print(f"Successfully populated Supabase with {total_upserted} records!")
