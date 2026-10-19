CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    capability TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    latency_ms INTEGER,
    model_version TEXT,
    related_entity_type TEXT,
    related_entity_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_capability ON ai_audit_logs(capability);
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_created_at ON ai_audit_logs(created_at);

ALTER TABLE ai_audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY IF NOT EXISTS "Service Role has full access to ai_audit_logs"
    ON ai_audit_logs
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- Allow authenticated users to insert their own logs (if calling from frontend via RLS, though we will use service role)
-- Allow admin users to read all logs
CREATE POLICY IF NOT EXISTS "Admins can read ai_audit_logs"
    ON ai_audit_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid() AND users.role = 'admin'
        )
    );
