-- FarmChainAI — Security Hardening for Business Transaction Stored Procedures
-- Migration 17: Restrict execution of atomicity stored procedures to service_role and postgres
-- Revokes public/anon/authenticated access to prevent direct RPC execution bypassing application middleware.

-- 1. Security hardening for register_harvest_batch
REVOKE ALL ON FUNCTION public.register_harvest_batch(
  uuid, integer, text, text, text, numeric, text, date, text, numeric, text, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.register_harvest_batch(
  uuid, integer, text, text, text, numeric, text, date, text, numeric, text, jsonb, text
) TO service_role, postgres;

ALTER FUNCTION public.register_harvest_batch(
  uuid, integer, text, text, text, numeric, text, date, text, numeric, text, jsonb, text
) SET search_path = public, pg_temp;

-- 2. Security hardening for submit_proof_of_delivery
REVOKE ALL ON FUNCTION public.submit_proof_of_delivery(
  uuid, uuid, text, numeric, text, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_proof_of_delivery(
  uuid, uuid, text, numeric, text, text, text, text
) TO service_role, postgres;

ALTER FUNCTION public.submit_proof_of_delivery(
  uuid, uuid, text, numeric, text, text, text, text
) SET search_path = public, pg_temp;

-- 3. Security hardening for acknowledge_delivery_receipt
REVOKE ALL ON FUNCTION public.acknowledge_delivery_receipt(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acknowledge_delivery_receipt(
  uuid, uuid, text, text
) TO service_role, postgres;

ALTER FUNCTION public.acknowledge_delivery_receipt(
  uuid, uuid, text, text
) SET search_path = public, pg_temp;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
