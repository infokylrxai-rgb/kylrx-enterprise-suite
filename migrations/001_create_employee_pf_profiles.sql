-- ============================================================================
-- KYLRX AI ENTERPRISE HRMS - DATABASE MIGRATION 001
-- Employee PF Profile Subsystem Schema & Staging Rejections
-- ============================================================================
-- Version: 6.1.0
-- Dialect: PostgreSQL / ANSI SQL Standard
-- Engine: Kylrx Statutory Compliance Subsystem
-- ============================================================================

-- 1. Create table: employee_pf_profiles
CREATE TABLE IF NOT EXISTS employee_pf_profiles (
    employee_id             VARCHAR(64) PRIMARY KEY,
    employee_name           VARCHAR(255),
    uan                     VARCHAR(12) NOT NULL DEFAULT '',
    pf_member_id            VARCHAR(64) NOT NULL DEFAULT '',
    pf_applicable           BOOLEAN NOT NULL DEFAULT TRUE,
    pf_join_date            DATE NOT NULL,
    pf_exit_date            DATE,
    eps_applicable          BOOLEAN NOT NULL DEFAULT TRUE,
    contribution_type       VARCHAR(32) NOT NULL DEFAULT 'STANDARD',
    voluntary_pf_percent    NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    voluntary_pf_amount     NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    is_active               BOOLEAN GENERATED ALWAYS AS (pf_applicable AND pf_exit_date IS NULL) STORED,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version                 INTEGER NOT NULL DEFAULT 1,

    -- Statutory Constraints
    CONSTRAINT chk_pf_contribution_type CHECK (
        contribution_type IN ('STANDARD', 'RESTRICTED_15K', 'ACTUAL_WAGE')
    ),
    CONSTRAINT chk_pf_date_sequence CHECK (
        pf_exit_date IS NULL OR pf_exit_date >= pf_join_date
    ),
    CONSTRAINT chk_pf_vpf_percent_bounds CHECK (
        voluntary_pf_percent >= 0.00 AND voluntary_pf_percent <= 88.00
    ),
    CONSTRAINT chk_pf_mandatory_identifiers CHECK (
        pf_applicable = FALSE OR (
            uan ~ '^[0-9]{12}$' AND 
            pf_member_id IS NOT NULL AND 
            LENGTH(TRIM(pf_member_id)) >= 5
        )
    )
);

-- Comments on table and columns
COMMENT ON TABLE employee_pf_profiles IS 'Master profile storage for Employee Provident Fund (EPFO) & Pension Scheme (EPS) registrations.';
COMMENT ON COLUMN employee_pf_profiles.uan IS 'Strictly 12 numeric digits Universal Account Number issued by EPFO.';
COMMENT ON COLUMN employee_pf_profiles.pf_member_id IS 'Regional establishment-linked Member ID (e.g. KN/12345/1234567 or MH/BAN/0012345/000/0000101).';
COMMENT ON COLUMN employee_pf_profiles.contribution_type IS 'Statutory wage ceiling enforcement policy: STANDARD, RESTRICTED_15K, or ACTUAL_WAGE.';

-- 2. Filtered Unique Indexes (Enforces zero duplicates across active employee profiles)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pf_profiles_active_uan
    ON employee_pf_profiles (uan)
    WHERE pf_applicable = TRUE AND pf_exit_date IS NULL AND LENGTH(uan) = 12;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pf_profiles_active_member_id
    ON employee_pf_profiles (pf_member_id)
    WHERE pf_applicable = TRUE AND pf_exit_date IS NULL AND LENGTH(pf_member_id) > 0;

CREATE INDEX IF NOT EXISTS idx_pf_profiles_join_date
    ON employee_pf_profiles (pf_join_date);

CREATE INDEX IF NOT EXISTS idx_pf_profiles_is_active
    ON employee_pf_profiles (is_active);

-- 3. Create table: pf_staging_rejections (Row-level audit logging for rejected bulk imports)
CREATE TABLE IF NOT EXISTS pf_staging_rejections (
    rejection_id        VARCHAR(64) PRIMARY KEY,
    batch_id            VARCHAR(64) NOT NULL,
    line_number         INTEGER NOT NULL,
    column_name         VARCHAR(64) NOT NULL,
    rejected_value      TEXT,
    error_code          VARCHAR(64) NOT NULL,
    error_message       TEXT NOT NULL,
    suggested_action    TEXT NOT NULL,
    source_file         VARCHAR(255) NOT NULL DEFAULT 'Employee_PF_Master.xlsx',
    timestamp           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pf_rejections_batch_id
    ON pf_staging_rejections (batch_id);

CREATE INDEX IF NOT EXISTS idx_pf_rejections_error_code
    ON pf_staging_rejections (error_code);

-- 4. Trigger for automatic updated_at timestamping
CREATE OR REPLACE FUNCTION update_pf_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_pf_profile_timestamp ON employee_pf_profiles;
CREATE TRIGGER trg_update_pf_profile_timestamp
    BEFORE UPDATE ON employee_pf_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_pf_profile_timestamp();
