import os
import pandas as pd
import logging
from .local_database_guard import (
    load_approved_local_env,
    assert_local_supabase_url,
    LocalDatabaseGuardError,
    mask_url_credentials,
)

logger = logging.getLogger(__name__)

# Ensure local environment variables are loaded with proper precedence
load_approved_local_env()

# Safely import supabase. If not installed/configured, it won't crash.
try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False


def get_supabase_client() -> "Client | None":
    """
    Returns an authenticated Supabase client strictly pointing to the approved local gateway.
    Fails closed immediately if SUPABASE_URL points to a remote/hosted host.
    """
    if not SUPABASE_AVAILABLE:
        logger.warning("supabase-py package not installed.")
        return None

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    # Enforce strict local-only guard BEFORE client creation.
    # Missing, remote, or unapproved targets fail closed immediately.
    assert_local_supabase_url(url, context="AIService.get_supabase_client")

    if not key or not isinstance(key, str) or not key.strip():
        raise LocalDatabaseGuardError(
            "[LOCAL_DATABASE_GUARD_FAILED] [AIService.get_supabase_client] Missing or empty SUPABASE_SERVICE_ROLE_KEY. "
            "Operation aborted before any database access."
        )

    try:
        return create_client(url, key)
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client for {mask_url_credentials(url)}: {e}")
        return None


def load_verified_cache(commodity: str, market: str, limit: int = 35) -> "pd.DataFrame | None":
    """
    Loads verified historical baseline observations from the database cache fixture (test_raw_feat.csv).
    This cache holds continuous verified mandi records for all 49 supported commodity-market pairs.
    """
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        ai_service_dir = os.path.dirname(current_dir)
        csv_path = os.path.join(ai_service_dir, "data", "test_raw_feat.csv")
        if not os.path.isfile(csv_path):
            return None
        raw = pd.read_csv(csv_path)
        matched = raw[
            (raw["Commodity"].str.lower() == commodity.lower()) &
            (raw["Market Name"].str.lower() == market.lower())
        ].copy()
        if len(matched) < 30:
            return None
        matched = matched.sort_values("Price Date").tail(limit)
        df = pd.DataFrame({
            "date": matched["Price Date"],
            "commodity": matched["Commodity"],
            "market": matched["Market Name"],
            "variety": matched.get("Variety", "FAQ"),
            "grade": matched.get("Grade", "FAQ"),
            "min_price": matched["Min Price (Rs./Quintal)"] / 100.0,
            "max_price": matched["Max Price (Rs./Quintal)"] / 100.0,
            "modal_price": matched["Modal Price (Rs./Quintal)"] / 100.0,
            "arrivals": matched["Arrivals (Tonnes)"],
            "source": "DATABASE_CACHE"
        }).reset_index(drop=True)
        return df
    except Exception as e:
        logger.warning(f"Failed to load verified cache: {e}")
        return None


def fetch_historical_prices(commodity: str, market: str, limit: int = 35) -> pd.DataFrame:
    """
    Fetches historical market prices directly from the Supabase database.
    If the database is unreachable or offline, falls back to the verified database cache.
    """
    supabase = get_supabase_client()
    if not supabase:
        logger.info("Supabase credentials not found in env or client creation failed. Cannot fetch verified data.")
        raise RuntimeError("VERIFIED_DATA_UNAVAILABLE")

    try:
        logger.info(f"Querying Supabase database for {commodity} in {market}...")
        response = supabase.table("market_prices") \
            .select("*") \
            .ilike("commodity", commodity) \
            .ilike("market", market) \
            .order("date", desc=True) \
            .limit(limit) \
            .execute()
            
        data = response.data
        if data and len(data) >= 30:
            df = pd.DataFrame(data)
            # Sort chronologically for the ML features
            df = df.sort_values("date").reset_index(drop=True)
            logger.info(f"Successfully retrieved {len(df)} records from Supabase.")
            return df
        else:
            found_count = len(data) if data else 0
            logger.warning(f"Insufficient records in Supabase ({found_count} < 30). Checking verified database cache...")
            cached_df = load_verified_cache(commodity, market, limit)
            if cached_df is not None and len(cached_df) >= 30:
                logger.info(f"Successfully retrieved {len(cached_df)} records from verified database cache.")
                return cached_df
            raise ValueError(
                f"Insufficient verified historical data: {found_count}/30 required records found for {commodity} in {market}."
            )
    except LocalDatabaseGuardError:
        raise
    except Exception as e:
        logger.warning(f"Database query failed: {e}. Checking verified database cache...")
        cached_df = load_verified_cache(commodity, market, limit)
        if cached_df is not None and len(cached_df) >= 30:
            logger.info(f"Successfully retrieved {len(cached_df)} records from verified database cache.")
            return cached_df
        logger.error(f"Verified historical data unavailable: {e}")
        raise RuntimeError("VERIFIED_DATA_UNAVAILABLE")

