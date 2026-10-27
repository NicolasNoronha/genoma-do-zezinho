CREATE TABLE IF NOT EXISTS classes (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    modality VARCHAR(30) NOT NULL DEFAULT 'Futebol 7',
    min_age SMALLINT NOT NULL,
    max_age SMALLINT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 30 CHECK (capacity > 0),
    location VARCHAR(180),
    schedule VARCHAR(180),
    coach_name VARCHAR(120),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
    id BIGSERIAL PRIMARY KEY,
    class_id BIGINT REFERENCES classes(id) ON DELETE SET NULL,
    full_name VARCHAR(160) NOT NULL,
    cpf VARCHAR(14),
    birth_date DATE NOT NULL,
    medical_notes TEXT,
    guardian_name VARCHAR(160) NOT NULL,
    guardian_cpf VARCHAR(14),
    relationship VARCHAR(40),
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(180),
    image_authorized BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(30) NOT NULL DEFAULT 'Ativo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS students_cpf_unique ON students (cpf) WHERE cpf IS NOT NULL AND cpf <> '';

CREATE TABLE IF NOT EXISTS charges (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('one_time', 'subscription')),
    include_enrollment BOOLEAN NOT NULL DEFAULT FALSE,
    include_monthly BOOLEAN NOT NULL DEFAULT TRUE,
    enrollment_amount NUMERIC(10,2) NOT NULL DEFAULT 70.00,
    monthly_amount NUMERIC(10,2) NOT NULL DEFAULT 90.00,
    total_amount NUMERIC(10,2) NOT NULL,
    reference VARCHAR(120) NOT NULL,
    due_date DATE,
    provider VARCHAR(30) NOT NULL DEFAULT 'mercado_pago',
    provider_reference VARCHAR(160),
    subscription_reference VARCHAR(160),
    payment_link TEXT,
    enrollment_payment_link TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS students_class_id_index ON students(class_id);
CREATE INDEX IF NOT EXISTS charges_student_id_index ON charges(student_id);
CREATE INDEX IF NOT EXISTS charges_provider_reference_index ON charges(provider_reference);

INSERT INTO classes (name, category, modality, min_age, max_age, capacity, location, schedule, coach_name)
SELECT 'Sub-13 A', 'Sub-13', 'Futebol 7', 12, 13, 30, 'Em definição', 'Em definição', 'Zezinho'
WHERE NOT EXISTS (SELECT 1 FROM classes);
