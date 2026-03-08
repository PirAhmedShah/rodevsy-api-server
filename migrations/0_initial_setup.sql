-- migrate:up
--------------------------------------------------------------------------------
-- 1. Extensions & Global Settings
--------------------------------------------------------------------------------
-- Standard extensions (adding uuid-ossp as a best practice for modern schemas)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
--------------------------------------------------------------------------------
-- 2. Custom Types & Enums
--------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS(
        SELECT
            1
        FROM
            pg_type
        WHERE
            typname = 'gender_enum') THEN
    CREATE TYPE gender_enum AS ENUM(
        'male',
        'female',
        'others'
);
    --
END IF;
        IF NOT EXISTS(
            SELECT
                1
            FROM
                pg_type
            WHERE
                typname = 'skill_category_enum') THEN
        CREATE TYPE skill_category_enum AS ENUM(
            'Programming',
            'Building',
            'Art & Design',
            'Audio',
            'Management'
);
        --
END IF;
        IF NOT EXISTS(
            SELECT
                1
            FROM
                pg_type
            WHERE
                typname = 'skill_subcategory_enum') THEN
        CREATE TYPE skill_subcategory_enum AS ENUM(
            'Gameplay Scripter',
            'Systems/Backend',
            'UI Programmer',
            'Anti-Exploit',
            'Bot/Web Developer',
            'Architectural Builder',
            'Terrain Artist',
            'Level Designer',
            '3D Modeler',
            'UI/UX Designer',
            'VFX Artist',
            'GFX Artist',
            'Animator',
            'Clothing Designer',
            'Sound Designer',
            'Composer',
            'Game Producer',
            'QA Tester',
            'Community Manager'
);
        --
END IF;
        IF NOT EXISTS(
            SELECT
                1
            FROM
                pg_type
            WHERE
                typname = 'skill_tier_enum') THEN
        CREATE TYPE skill_tier_enum AS ENUM(
            '1.Tier V',
            '2.Tier IV',
            '3.Tier III',
            '4.Tier II',
            '5.Tier I',
            '6.Champion'
);
        --
END IF;
END
$$;

--------------------------------------------------------------------------------
-- 3. Functions & Procedures
--------------------------------------------------------------------------------
-- Function to handle timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$
LANGUAGE plpgsql;

-- Function to prevent deletions or updates on immutable tables
CREATE OR REPLACE FUNCTION raise_exception()
    RETURNS TRIGGER
    AS $$
BEGIN
    RAISE EXCEPTION 'Operation % on table % is strictly prohibited.', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
END;
$$
LANGUAGE plpgsql;

--------------------------------------------------------------------------------
-- 4. Tables (Ordered by Dependency)
--------------------------------------------------------------------------------
-- Independent Table: users
CREATE TABLE IF NOT EXISTS users(
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    first_name text NOT NULL,
    last_name text NOT NULL,
    date_of_birth date NOT NULL,
    gender gender_enum NOT NULL,
    email text NOT NULL,
    username text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    hashed_password text NOT NULL,
    pin varchar(6),
    is_email_verified boolean NOT NULL DEFAULT FALSE,
    is_2fa_enabled boolean NOT NULL DEFAULT FALSE,
    -- this is cached balance to avoid expensive ledger sum calculation for reads. This may not be used for anything other than showing balance.
    balance bigint NOT NULL DEFAULT 0
);

-- Dependent: client_account (FK -> users)
CREATE TABLE IF NOT EXISTS client_account(
    user_id uuid NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name text NOT NULL,
    trust_score numeric(5, 4) NOT NULL DEFAULT 0,
    review_count bigint NOT NULL DEFAULT 0,
    is_verified_org boolean NOT NULL DEFAULT FALSE,
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Dependent: developer_account (FK -> users)
CREATE TABLE IF NOT EXISTS developer_account(
    user_id uuid NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    average_rating numeric(5, 4) NOT NULL DEFAULT 0,
    review_count bigint NOT NULL DEFAULT 0,
    is_for_hire boolean NOT NULL DEFAULT FALSE,
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Dependent: user_skills_current (FK -> users)
CREATE TABLE IF NOT EXISTS user_skills_current(
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sub_category skill_subcategory_enum NOT NULL,
    tier skill_tier_enum NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, sub_category)
);

-- Dependent: user_skills_history (FK -> users)
CREATE TABLE IF NOT EXISTS user_skills_history(
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sub_category skill_subcategory_enum NOT NULL,
    tier skill_tier_enum NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Dependent: login_history (FK -> users)
CREATE TABLE IF NOT EXISTS login_history(
    -- UUIDv7 for sequential primary key performance
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Session & Security Metadata
    jti uuid, -- Nullable for failed logins
    fingerprint text NOT NULL,
    user_agent text NOT NULL,
    ip inet NOT NULL,
    -- Status Metadata
    success boolean NOT NULL,
    used_2fa boolean NOT NULL DEFAULT FALSE,
    -- Timing
    login_at timestamptz NOT NULL DEFAULT NOW()
);

--------------------------------------------------------------------------------
-- 5. Specialized Functions (Requiring Tables)
--------------------------------------------------------------------------------
-- Function to log skill changes to history
CREATE OR REPLACE FUNCTION log_skill_change()
    RETURNS TRIGGER
    AS $$
BEGIN
    -- Log on initial insert or if the tier value has actually changed
    IF(TG_OP = 'INSERT') OR(OLD.tier IS DISTINCT FROM NEW.tier) THEN
        INSERT INTO user_skills_history(user_id, sub_category, tier, created_at)
            VALUES(NEW.user_id, NEW.sub_category, NEW.tier, NEW.updated_at);
    END IF;
    RETURN NEW;
END;
$$
LANGUAGE plpgsql;

--------------------------------------------------------------------------------
-- 6. Constraints & Indexes
--------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Index for searching specific user history (ordered by newest first)
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id, login_at DESC);

--
CREATE INDEX IF NOT EXISTS idx_user_skills_history_lookup ON user_skills_history(user_id, sub_category, created_at DESC) INCLUDE (tier);

--
--------------------------------------------------------------------------------
-- 7. Triggers
--------------------------------------------------------------------------------
-- Timestamp Triggers
CREATE OR REPLACE TRIGGER trg_update_updated_at_users
    BEFORE UPDATE ON users
    FOR EACH ROW
    WHEN(OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION update_updated_at();

--
CREATE OR REPLACE TRIGGER trg_update_updated_at_client_account
    BEFORE UPDATE ON client_account
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

--
CREATE OR REPLACE TRIGGER trg_update_updated_at_developer_account
    BEFORE UPDATE ON developer_account
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

--
CREATE OR REPLACE TRIGGER trg_update_updated_at_user_skills_current
    BEFORE UPDATE ON user_skills_current
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

--
-- History/Audit Logging
CREATE OR REPLACE TRIGGER trg_log_skill_change
    AFTER INSERT OR UPDATE ON user_skills_current
    FOR EACH ROW
    EXECUTE FUNCTION log_skill_change();

--
-- Security/Immutability Triggers
CREATE OR REPLACE TRIGGER trg_secure_login_history
    BEFORE UPDATE OR DELETE ON login_history
    FOR EACH ROW
    EXECUTE FUNCTION raise_exception();

--
ALTER TABLE login_history ENABLE ALWAYS TRIGGER trg_secure_login_history;

CREATE OR REPLACE TRIGGER trg_secure_user_skill_history
    BEFORE UPDATE OR DELETE ON user_skills_history
    FOR EACH ROW
    EXECUTE FUNCTION raise_exception();

--
ALTER TABLE user_skills_history ENABLE ALWAYS TRIGGER trg_secure_user_skill_history;

--------------------------------------------------------------------------------
-- 8. Seed Data (Optional/Initial)
--------------------------------------------------------------------------------
-- No seed data provided in snippets, but block is prepared for future use.
-- migrate:down
-- Drop Triggers first
DROP TRIGGER IF EXISTS trg_secure_user_skill_history ON user_skills_history;

DROP TRIGGER IF EXISTS trg_secure_login_history ON login_history;

DROP TRIGGER IF EXISTS trg_log_skill_change ON user_skills_current;

DROP TRIGGER IF EXISTS trg_update_updated_at_user_skills_current ON user_skills_current;

DROP TRIGGER IF EXISTS trg_update_updated_at_developer_account ON developer_account;

DROP TRIGGER IF EXISTS trg_update_updated_at_client_account ON client_account;

DROP TRIGGER IF EXISTS trg_update_updated_at_users ON users;

-- Drop Tables (Reverse order of dependencies)
DROP TABLE IF EXISTS login_history;

DROP TABLE IF EXISTS user_skills_history;

DROP TABLE IF EXISTS user_skills_current;

DROP TABLE IF EXISTS developer_account;

DROP TABLE IF EXISTS client_account;

DROP TABLE IF EXISTS users;

-- Drop Functions
DROP FUNCTION IF EXISTS log_skill_change();

DROP FUNCTION IF EXISTS raise_exception();

DROP FUNCTION IF EXISTS update_updated_at();

-- Drop Types
DROP TYPE IF EXISTS skill_tier_enum;

DROP TYPE IF EXISTS skill_subcategory_enum;

DROP TYPE IF EXISTS skill_category_enum;

DROP TYPE IF EXISTS gender_enum;

-- Drop Extensions
-- DROP EXTENSION IF EXISTS "uuid-ossp";
