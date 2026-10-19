"""
FarmChainAI — Isolated Security Test Suite for Local Database Guard
Validates strict local-only database access enforcement in the AI service.

Requirements Verified:
1. Correct local Supabase (127.0.0.1:54321, localhost:54321) and PostgreSQL (127.0.0.1:54322/postgres) targets accepted.
2. Hosted Supabase URLs (*.supabase.co) rejected fail-closed.
3. Remote database hosts and unexpected ports rejected fail-closed.
4. Missing configuration fails closed before network access.
5. Environment precedence selects intended local override (backend/.env.local) without exposing secrets.
6. Rejected configurations fail before a client or network request is created.
7. Client creation succeeds only after target validation.
8. No test contacts a hosted service or modifies actual database records.
"""

import os
import sys
import unittest
from unittest.mock import patch, MagicMock

# Ensure ai-service root is in sys.path
_current_dir = os.path.dirname(os.path.abspath(__file__))
_ai_service_dir = os.path.dirname(_current_dir)
if _ai_service_dir not in sys.path:
    sys.path.insert(0, _ai_service_dir)

from services.local_database_guard import (
    LocalDatabaseGuardError,
    mask_url_credentials,
    assert_local_supabase_url,
    assert_local_postgres_url,
    assert_approved_local_environment,
    create_guarded_supabase_client,
    load_approved_local_env,
    APPROVED_LOCAL_HOSTS,
    APPROVED_LOCAL_SUPABASE_PORT,
    APPROVED_LOCAL_POSTGRES_PORT,
    APPROVED_LOCAL_POSTGRES_DB,
)
import services.database as database_module


class TestLocalSupabaseUrlValidation(unittest.TestCase):
    """Verifies that Supabase URL validation allows ONLY approved local instances."""

    def test_accepts_valid_local_endpoints(self):
        approved_urls = [
            "http://127.0.0.1:54321",
            "http://127.0.0.1:54321/",
            "http://127.0.0.1:54321/rest/v1",
            "http://localhost:54321",
            "http://localhost:54321/",
            "http://localhost:54321/auth/v1",
            "https://localhost:54321",
        ]
        for url in approved_urls:
            with self.subTest(url=url):
                try:
                    assert_local_supabase_url(url, context="test_accepts_valid_local_endpoints")
                except LocalDatabaseGuardError as e:
                    self.fail(f"Approved local URL '{url}' was unexpectedly rejected: {e}")

    def test_rejects_hosted_supabase_urls(self):
        hosted_urls = [
            "https://nadnjpqusxweictjdydw.supabase.co",
            "https://nadnjpqusxweictjdydw.supabase.co:54321",
            "https://example-project.supabase.co",
            "http://supabase.co:54321",
            "https://app.supabase.co",
            "https://prod-db.supabase.co:443",
        ]
        for url in hosted_urls:
            with self.subTest(url=url):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_supabase_url(url, context="test_rejects_hosted_supabase_urls")
                self.assertIn("FAIL-CLOSED", str(ctx.exception))
                self.assertIn("not the approved local development database", str(ctx.exception))

    def test_rejects_remote_hosts(self):
        remote_urls = [
            "http://192.168.1.50:54321",
            "http://10.0.0.5:54321",
            "http://example.com:54321",
            "http://remote-gateway.internal:54321",
            "http://172.20.0.2:54321",
        ]
        for url in remote_urls:
            with self.subTest(url=url):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_supabase_url(url, context="test_rejects_remote_hosts")
                self.assertIn("FAIL-CLOSED", str(ctx.exception))

    def test_rejects_unexpected_ports(self):
        bad_port_urls = [
            "http://127.0.0.1:54322",  # PostgreSQL container port (not Supabase REST gateway port)
            "http://127.0.0.1:8000",   # AI service port
            "http://127.0.0.1:3000",   # Backend port
            "http://127.0.0.1:5432",   # Default PostgreSQL port
            "http://localhost:54322",
            "http://localhost:80",
            "http://localhost",        # Missing port
            "http://127.0.0.1",        # Missing port
        ]
        for url in bad_port_urls:
            with self.subTest(url=url):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_supabase_url(url, context="test_rejects_unexpected_ports")
                self.assertIn("FAIL-CLOSED", str(ctx.exception))

    def test_rejects_missing_or_empty_url(self):
        invalid_urls = [None, "", "   ", "\t\n"]
        for url in invalid_urls:
            with self.subTest(url=url):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_supabase_url(url, context="test_rejects_missing_or_empty_url")
                self.assertIn("Missing or empty SUPABASE_URL", str(ctx.exception))

    def test_rejects_malformed_url(self):
        malformed_urls = [
            "://missing-scheme",
            "not_a_valid_url",
            "http://",
        ]
        for url in malformed_urls:
            with self.subTest(url=url):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_supabase_url(url, context="test_rejects_malformed_url")
                self.assertIn("LOCAL_DATABASE_GUARD_FAILED", str(ctx.exception))


class TestLocalPostgresUrlValidation(unittest.TestCase):
    """Verifies that PostgreSQL connection string validation allows ONLY approved local targets."""

    def test_accepts_valid_local_postgres(self):
        approved_strings = [
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
            "postgres://postgres:postgres@localhost:54322/postgres",
            "postgresql://postgres:local_secret_pass@127.0.0.1:54322/postgres?sslmode=disable",
            "postgresql://postgres:postgres@localhost:54322/postgres?client_encoding=utf8",
        ]
        for conn_str in approved_strings:
            with self.subTest(conn_str=conn_str):
                try:
                    assert_local_postgres_url(conn_str, context="test_accepts_valid_local_postgres")
                except LocalDatabaseGuardError as e:
                    self.fail(f"Approved local PostgreSQL string '{conn_str}' was unexpectedly rejected: {e}")

    def test_rejects_hosted_supabase_postgres(self):
        hosted_strings = [
            "postgresql://postgres:pass@db.nadnjpqusxweictjdydw.supabase.co:54322/postgres",
            "postgresql://postgres:pass@db.nadnjpqusxweictjdydw.supabase.co:5432/postgres",
            "postgres://postgres:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
        ]
        for conn_str in hosted_strings:
            with self.subTest(conn_str=conn_str):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_postgres_url(conn_str, context="test_rejects_hosted_supabase_postgres")
                self.assertIn("FAIL-CLOSED", str(ctx.exception))

    def test_rejects_remote_postgres_hosts(self):
        remote_strings = [
            "postgresql://postgres:pass@192.168.1.100:54322/postgres",
            "postgresql://postgres:pass@db.example.internal:54322/postgres",
            "postgresql://postgres:pass@10.0.0.1:54322/postgres",
        ]
        for conn_str in remote_strings:
            with self.subTest(conn_str=conn_str):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_postgres_url(conn_str, context="test_rejects_remote_postgres_hosts")
                self.assertIn("FAIL-CLOSED", str(ctx.exception))

    def test_rejects_unexpected_postgres_ports(self):
        wrong_port_strings = [
            "postgresql://postgres:pass@127.0.0.1:5432/postgres",   # 5432 is default, not 54322
            "postgresql://postgres:pass@localhost:54321/postgres",  # 54321 is Kong port
            "postgresql://postgres:pass@127.0.0.1:3306/postgres",   # MySQL port
            "postgresql://postgres:pass@localhost/postgres",        # Missing port
        ]
        for conn_str in wrong_port_strings:
            with self.subTest(conn_str=conn_str):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_postgres_url(conn_str, context="test_rejects_unexpected_postgres_ports")
                self.assertIn("FAIL-CLOSED", str(ctx.exception))

    def test_rejects_unexpected_database_name(self):
        wrong_db_strings = [
            "postgresql://postgres:pass@127.0.0.1:54322/production",
            "postgresql://postgres:pass@127.0.0.1:54322/staging",
            "postgresql://postgres:pass@127.0.0.1:54322/",
            "postgresql://postgres:pass@127.0.0.1:54322",
        ]
        for conn_str in wrong_db_strings:
            with self.subTest(conn_str=conn_str):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_postgres_url(conn_str, context="test_rejects_unexpected_database_name")
                self.assertIn("FAIL-CLOSED", str(ctx.exception))

    def test_rejects_missing_or_empty_postgres_url(self):
        for invalid_val in [None, "", "   "]:
            with self.subTest(val=invalid_val):
                with self.assertRaises(LocalDatabaseGuardError) as ctx:
                    assert_local_postgres_url(invalid_val, context="test_rejects_missing_or_empty_postgres_url")
                self.assertIn("Missing or empty PostgreSQL connection string", str(ctx.exception))


class TestCredentialMasking(unittest.TestCase):
    """Verifies that secrets, passwords, and tokens are NEVER exposed in errors or logs."""

    def test_mask_url_credentials_redacts_passwords(self):
        raw = "postgresql://my_user:MySecretPassword123@127.0.0.1:54322/postgres"
        masked = mask_url_credentials(raw)
        self.assertNotIn("MySecretPassword123", masked)
        self.assertIn("***", masked)
        self.assertIn("127.0.0.1:54322", masked)

    def test_mask_url_credentials_redacts_apikeys_and_tokens(self):
        raw_url = "http://127.0.0.1:54321?apikey=sbp_super_secret_jwt_token_9999"
        masked = mask_url_credentials(raw_url)
        self.assertNotIn("sbp_super_secret_jwt_token_9999", masked)
        self.assertIn("apikey=***", masked)

    def test_error_message_never_leaks_secrets(self):
        secret_pass = "UltraSecretDBPasswordXYZ"
        secret_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SecretPayload"

        # Negative test for PostgreSQL
        bad_pg = f"postgresql://postgres:{secret_pass}@remote-server.com:54322/postgres"
        with self.assertRaises(LocalDatabaseGuardError) as ctx_pg:
            assert_local_postgres_url(bad_pg, context="test_leak_check")
        err_msg_pg = str(ctx_pg.exception)
        self.assertNotIn(secret_pass, err_msg_pg)
        self.assertIn("***", err_msg_pg)

        # Negative test for Supabase
        bad_sb = f"https://nadnjpqusxweictjdydw.supabase.co?apikey={secret_token}"
        with self.assertRaises(LocalDatabaseGuardError) as ctx_sb:
            assert_local_supabase_url(bad_sb, context="test_leak_check")
        err_msg_sb = str(ctx_sb.exception)
        self.assertNotIn(secret_token, err_msg_sb)
        self.assertIn("***", err_msg_sb)


class TestEnvironmentPrecedenceAndSafety(unittest.TestCase):
    """Verifies that local override precedence rules select 127.0.0.1 without leaking secrets."""

    def test_assert_approved_local_environment_positive(self):
        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "LOCAL_DB_URL": "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        }, clear=False):
            # Should not raise
            try:
                assert_approved_local_environment(context="test_positive")
            except LocalDatabaseGuardError as e:
                self.fail(f"Valid local environment rejected: {e}")

    def test_assert_approved_local_environment_rejects_remote_supabase(self):
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://nadnjpqusxweictjdydw.supabase.co",
        }, clear=False):
            with self.assertRaises(LocalDatabaseGuardError):
                assert_approved_local_environment(context="test_remote_sb")

    def test_assert_approved_local_environment_rejects_remote_postgres(self):
        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "LOCAL_DB_URL": "postgresql://postgres:pass@remote-host:54322/postgres",
        }, clear=False):
            with self.assertRaises(LocalDatabaseGuardError):
                assert_approved_local_environment(context="test_remote_pg")


    def test_environment_precedence_selects_local_override(self):
        """Proves backend/.env.local takes precedence over backend/.env."""
        # Save current env
        saved_url = os.environ.get("SUPABASE_URL")
        try:
            # Set a fake remote URL simulating an inherited shell variable or backend/.env
            os.environ["SUPABASE_URL"] = "https://nadnjpqusxweictjdydw.supabase.co"
            # Execute load_approved_local_env
            load_approved_local_env()
            resolved = os.environ.get("SUPABASE_URL")
            # Should have been overridden by backend/.env.local (http://127.0.0.1:54321)
            self.assertEqual(resolved, "http://127.0.0.1:54321")
            # And it must pass local Supabase validation
            assert_local_supabase_url(resolved, context="test_precedence")
        finally:
            if saved_url is not None:
                os.environ["SUPABASE_URL"] = saved_url


class TestClientCreationFailClosed(unittest.TestCase):
    """Verifies that database client creation fails closed before any network request is attempted."""

    @patch("services.database.create_client")
    def test_get_supabase_client_fails_closed_on_hosted_target(self, mock_create):
        """Proves zero clients created and zero network requests made when target is hosted."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "https://nadnjpqusxweictjdydw.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "mock_secret_key",
        }, clear=False):
            with self.assertRaises(LocalDatabaseGuardError) as ctx:
                database_module.get_supabase_client()
            self.assertIn("FAIL-CLOSED", str(ctx.exception))
            # Critical proof: create_client was never called!
            mock_create.assert_not_called()

    @patch("services.database.create_client")
    def test_get_supabase_client_fails_closed_on_missing_url(self, mock_create):
        """Proves missing SUPABASE_URL fails closed before client creation."""
        env_without_url = dict(os.environ)
        env_without_url.pop("SUPABASE_URL", None)
        with patch.dict(os.environ, env_without_url, clear=True):
            with self.assertRaises(LocalDatabaseGuardError) as ctx:
                database_module.get_supabase_client()
            self.assertIn("Missing or empty SUPABASE_URL", str(ctx.exception))
            mock_create.assert_not_called()

    @patch("services.database.create_client")
    def test_get_supabase_client_fails_closed_on_missing_key(self, mock_create):
        """Proves missing SUPABASE_SERVICE_ROLE_KEY fails closed before client creation."""
        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "SUPABASE_SERVICE_ROLE_KEY": "",
        }, clear=False):
            with self.assertRaises(LocalDatabaseGuardError) as ctx:
                database_module.get_supabase_client()
            self.assertIn("Missing or empty SUPABASE_SERVICE_ROLE_KEY", str(ctx.exception))
            mock_create.assert_not_called()

    @patch("services.database.create_client")
    def test_get_supabase_client_succeeds_only_after_validation(self, mock_create):
        """Proves client creation succeeds with approved local parameters."""
        mock_client = MagicMock()
        mock_create.return_value = mock_client

        with patch.dict(os.environ, {
            "SUPABASE_URL": "http://127.0.0.1:54321",
            "SUPABASE_SERVICE_ROLE_KEY": "mock_valid_key_local",
        }, clear=False):
            client = database_module.get_supabase_client()
            self.assertEqual(client, mock_client)
            mock_create.assert_called_once_with("http://127.0.0.1:54321", "mock_valid_key_local")

    @patch("supabase.create_client")
    def test_create_guarded_supabase_client_factory_safety(self, mock_create):
        """Proves the standalone factory function enforces target validation."""
        # Negative case: hosted domain
        with self.assertRaises(LocalDatabaseGuardError):
            create_guarded_supabase_client(
                url="https://remote.supabase.co",
                key="mock_key",
                context="FactoryTest"
            )
        mock_create.assert_not_called()

        # Positive case: local endpoint
        mock_client = MagicMock()
        mock_create.return_value = mock_client
        result = create_guarded_supabase_client(
            url="http://127.0.0.1:54321",
            key="mock_key",
            context="FactoryTest"
        )
        self.assertEqual(result, mock_client)
        mock_create.assert_called_once_with("http://127.0.0.1:54321", "mock_key")


class TestEndpointGuardIntegration(unittest.TestCase):
    """Verifies that the FastAPI application handles LocalDatabaseGuardError with HTTP 503."""

    def test_prediction_endpoint_returns_503_on_guard_failure(self):
        from fastapi.testclient import TestClient
        from main import app

        client = TestClient(app)

        with patch("main.fetch_historical_prices", side_effect=LocalDatabaseGuardError("LOCAL_GUARD_TEST")):
            response = client.post("/api/farmer/price-prediction", json={
                "commodity": "Tomato",
                "market": "Bangalore",
                "forecast_days": 7
            })
            self.assertEqual(response.status_code, 503)
            data = response.json()
            self.assertFalse(data["success"])
            self.assertEqual(data["error_code"], "LOCAL_DATABASE_GUARD_FAILED")
            self.assertIn("violates local-only policy", data["message"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
