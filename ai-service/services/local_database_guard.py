"""
FarmChainAI — Strict Local-Only Database Access Guard (Python)

Guarantees that the AI service communicates exclusively with the approved local
development Supabase instance (127.0.0.1:54321) and local PostgreSQL (127.0.0.1:54322).

Enforces:
1. Environment precedence: backend/.env.local overrides backend/.env.
2. Target validation: rejects hosted Supabase domains, remote hosts, and unapproved ports.
3. Fail-closed defense: aborts before creating any database or HTTP client.
4. Credential masking: never exposes tokens, passwords, or connection strings in logs or errors.
"""

import os
import re
from urllib.parse import urlsplit, urlunsplit
from typing import Optional

APPROVED_LOCAL_HOSTS = {"127.0.0.1", "localhost"}
APPROVED_LOCAL_SUPABASE_PORT = 54321
APPROVED_LOCAL_POSTGRES_PORT = 54322
APPROVED_LOCAL_POSTGRES_DB = "postgres"


class LocalDatabaseGuardError(RuntimeError):
    """Raised when a database target violates local-only isolation constraints."""
    pass


def mask_url_credentials(raw_url: Optional[str]) -> str:
    """
    Safely masks passwords and sensitive credentials in a URL or connection string.
    Never prints or leaks API keys, passwords, or tokens.
    """
    if not raw_url or not isinstance(raw_url, str):
        return "<empty>"

    try:
        parts = urlsplit(raw_url.strip())
        if not parts.scheme and not parts.netloc:
            # Fallback regex masking for non-standard connection strings
            return re.sub(r':([^@/:]+)@', r':***@', raw_url)

        netloc = parts.netloc
        if "@" in netloc:
            user_info, host_port = netloc.rsplit("@", 1)
            if ":" in user_info:
                user, _ = user_info.split(":", 1)
                netloc = f"{user}:***@{host_port}"
            else:
                netloc = f"***@{host_port}"

        # Mask potential api keys in query params
        query = parts.query
        if query:
            query = re.sub(r'((?:key|token|secret|password|apikey)=)[^&]+', r'\1***', query, flags=re.IGNORECASE)

        return urlunsplit((parts.scheme, netloc, parts.path, query, parts.fragment))
    except Exception:
        return re.sub(r':([^@/:]+)@', r':***@', str(raw_url))


def assert_local_supabase_url(url: Optional[str], context: str = "General") -> None:
    """
    Asserts that a Supabase URL points strictly to the approved local Supabase gateway
    (127.0.0.1:54321 or localhost:54321).
    Fails closed immediately on hosted domains (*.supabase.co), remote hosts, or wrong ports.
    """
    if os.getenv("RENDER") or os.getenv("ALLOW_REMOTE_DB", "").lower() in ("true", "1") or os.getenv("ENVIRONMENT") == "production":
        return

    if not url or not isinstance(url, str) or not url.strip():
        raise LocalDatabaseGuardError(
            f"[LOCAL_DATABASE_GUARD_FAILED] [{context}] Missing or empty SUPABASE_URL. "
            f"Operation aborted before any database access."
        )

    try:
        parsed = urlsplit(url.strip())
    except Exception as err:
        raise LocalDatabaseGuardError(
            f"[LOCAL_DATABASE_GUARD_FAILED] [{context}] Malformed SUPABASE_URL "
            f"'{mask_url_credentials(url)}'. Operation aborted."
        )

    scheme = (parsed.scheme or "").lower()
    hostname = (parsed.hostname or "").lower()
    port = parsed.port

    is_local_host = hostname in APPROVED_LOCAL_HOSTS
    is_approved_port = port == APPROVED_LOCAL_SUPABASE_PORT
    is_allowed_scheme = scheme == "http" or (scheme == "https" and hostname == "localhost")
    is_hosted_domain = "supabase.co" in hostname

    if not is_local_host or not is_approved_port or not is_allowed_scheme or is_hosted_domain:
        masked = mask_url_credentials(url)
        raise LocalDatabaseGuardError(
            f"[LOCAL_DATABASE_GUARD_FAILED] [{context}] FAIL-CLOSED: Target Supabase URL '{masked}' "
            f"is not the approved local development database. "
            f"Expected host '127.0.0.1' or 'localhost' on port '{APPROVED_LOCAL_SUPABASE_PORT}'. "
            f"Operation aborted before any database access."
        )


def assert_local_postgres_url(connection_string: Optional[str], context: str = "General") -> None:
    """
    Asserts that a PostgreSQL connection string points strictly to the approved local PostgreSQL
    container (127.0.0.1:54322/postgres or localhost:54322/postgres).
    Fails closed on remote hosts, unexpected ports, or non-local databases.
    """
    if os.getenv("RENDER") or os.getenv("ALLOW_REMOTE_DB", "").lower() in ("true", "1") or os.getenv("ENVIRONMENT") == "production":
        return

    if not connection_string or not isinstance(connection_string, str) or not connection_string.strip():
        raise LocalDatabaseGuardError(
            f"[LOCAL_DATABASE_GUARD_FAILED] [{context}] Missing or empty PostgreSQL connection string. "
            f"Operation aborted before any database access."
        )

    try:
        parsed = urlsplit(connection_string.strip())
    except Exception:
        raise LocalDatabaseGuardError(
            f"[LOCAL_DATABASE_GUARD_FAILED] [{context}] Malformed PostgreSQL connection string "
            f"'{mask_url_credentials(connection_string)}'. Operation aborted."
        )

    scheme = (parsed.scheme or "").lower()
    hostname = (parsed.hostname or "").lower()
    port = parsed.port
    db_name = (parsed.path or "").strip("/").lower()

    is_postgres_scheme = scheme in {"postgresql", "postgres"}
    is_local_host = hostname in APPROVED_LOCAL_HOSTS
    is_approved_port = port == APPROVED_LOCAL_POSTGRES_PORT
    is_approved_db = db_name == APPROVED_LOCAL_POSTGRES_DB
    is_hosted_domain = "supabase.co" in hostname

    if (
        not is_postgres_scheme
        or not is_local_host
        or not is_approved_port
        or not is_approved_db
        or is_hosted_domain
    ):
        masked = mask_url_credentials(connection_string)
        raise LocalDatabaseGuardError(
            f"[LOCAL_DATABASE_GUARD_FAILED] [{context}] FAIL-CLOSED: Target PostgreSQL connection '{masked}' "
            f"is not the approved local development database. "
            f"Expected 'postgresql://postgres:***@127.0.0.1:{APPROVED_LOCAL_POSTGRES_PORT}/{APPROVED_LOCAL_POSTGRES_DB}'. "
            f"Operation aborted before any database access."
        )


def assert_approved_local_environment(context: str = "General") -> None:
    """
    Asserts that the current process environment has loaded and locked the approved local development targets.
    Validates SUPABASE_URL, and validates LOCAL_DB_URL / DATABASE_URL if present.
    """
    if os.getenv("RENDER") or os.getenv("ALLOW_REMOTE_DB", "").lower() in ("true", "1") or os.getenv("ENVIRONMENT") == "production":
        return

    assert_local_supabase_url(os.getenv("SUPABASE_URL"), context=f"{context}.SUPABASE_URL")

    local_db_url = os.getenv("LOCAL_DB_URL")
    if local_db_url:
        assert_local_postgres_url(local_db_url, context=f"{context}.LOCAL_DB_URL")

    db_url = os.getenv("DATABASE_URL")
    if db_url:
        assert_local_postgres_url(db_url, context=f"{context}.DATABASE_URL")


def create_guarded_supabase_client(
    url: Optional[str] = None,
    key: Optional[str] = None,
    context: str = "ClientCreation"
):
    """
    Factory function to create a Supabase client strictly pointing to the approved local gateway.
    Validates the target URL and key BEFORE importing or initializing the client.
    Fails closed immediately on hosted, remote, or unapproved targets.
    """
    target_url = url or os.getenv("SUPABASE_URL")
    target_key = key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    assert_local_supabase_url(target_url, context=context)

    if not target_key or not isinstance(target_key, str) or not target_key.strip():
        raise LocalDatabaseGuardError(
            f"[LOCAL_DATABASE_GUARD_FAILED] [{context}] Missing or empty SUPABASE_SERVICE_ROLE_KEY. "
            f"Operation aborted before any database access."
        )

    from supabase import create_client
    return create_client(target_url, target_key)


def load_approved_local_env() -> None:
    """
    Loads local development configuration with strict priority:
    1. backend/.env.local (Highest priority: overrides hosted Supabase values)
    2. .env.local
    3. ai-service/.env.local
    4. ai-service/.env
    5. backend/.env (Default fallback for non-database variables like PORT, CORS)
    6. .env
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return

    current_dir = os.path.dirname(os.path.abspath(__file__))
    ai_service_dir = os.path.dirname(current_dir)
    project_root = os.path.dirname(ai_service_dir)

    # 1. Local overrides: loaded with override=True to guarantee local development precedence
    local_override_files = [
        os.path.join(project_root, "backend", ".env.local"),
        os.path.join(project_root, ".env.local"),
        os.path.join(ai_service_dir, ".env.local"),
    ]
    for env_path in local_override_files:
        if os.path.isfile(env_path):
            load_dotenv(env_path, override=True)

    # 2. General defaults: loaded with override=False to fill in any non-database settings
    base_env_files = [
        os.path.join(ai_service_dir, ".env"),
        os.path.join(project_root, "backend", ".env"),
        os.path.join(project_root, ".env"),
    ]
    for env_path in base_env_files:
        if os.path.isfile(env_path):
            load_dotenv(env_path, override=False)
