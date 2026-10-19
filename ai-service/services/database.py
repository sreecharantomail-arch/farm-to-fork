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


def fetch_historical_prices(commodity: str, market: str, limit: int = 35) -> pd.DataFrame:
    """
    Fetches historical market prices directly from the Supabase database.
    If the database is unconfigured or fails, it throws an error.
    It NEVER falls back to unverified local CSVs.
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
            logger.warning(f"Insufficient records in Supabase ({found_count} < 30).")
            raise ValueError(
                f"Insufficient verified historical data: {found_count}/30 required records found for {commodity} in {market}."
            )
    except (ValueError, LocalDatabaseGuardError):
        raise
    except Exception as e:
        logger.error(f"Database query failed: {e}.")
        raise RuntimeError("VERIFIED_DATA_UNAVAILABLE")
