import logging
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.local_database_guard import load_approved_local_env, assert_local_supabase_url

# Load env variables with local precedence
load_approved_local_env()

from supabase import create_client, Client
from services.price_ingestion import PriceDataSourceManager

def main():
    logger.info("Starting price sync process...")
    
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        logger.error("Supabase credentials missing. Exiting.")
        return
        
    assert_local_supabase_url(supabase_url, context="daily_sync")
    supabase: Client = create_client(supabase_url, supabase_key)

    manager = PriceDataSourceManager(supabase)

    # List of commodities/markets to sync
    commodities = ["Tomato", "Onion", "Potato", "Carrot", "Cabbage", "Green Chilli", "Brinjal"]
    markets = ["Bangalore", "Mysore", "Mumbai", "Pune", "Delhi", "Hyderabad", "Chennai"]
    
    targets = [(c, m) for c in commodities for m in markets]

    for commodity, market in targets:
        manager.fetch_and_publish(commodity, market)
        
    logger.info("Daily sync completed.")

if __name__ == "__main__":
    main()
