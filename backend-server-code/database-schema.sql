-- Database Schema for iSchool AI Quality Dashboard
-- Run this SQL to create all required tables in PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create ENUM types
CREATE TYPE app_role AS ENUM ('admin', 'manager', 'reviewer');
CREATE TYPE session_status AS ENUM ('pending', 'in_review', 'completed', 'flagged');
CREATE TYPE activity_status AS ENUM ('active', 'idle', 'on_break', 'offline');

-- Users table (for authentication)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles table
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles table
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    role app_role DEFAULT 'reviewer' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tutors table
CREATE TABLE tutors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT,
    subject TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tutor_id UUID REFERENCES tutors(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    video_url TEXT,
    transcript TEXT,
    duration_minutes INTEGER,
    subject TEXT,
    session_type TEXT DEFAULT 'mobile',
    status session_status DEFAULT 'pending',
    assigned_reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Analyses table
CREATE TABLE ai_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
    overall_score NUMERIC,
    confidence_level NUMERIC,
    engagement_score NUMERIC,
    content_accuracy_score NUMERIC,
    communication_score NUMERIC,
    issues_identified JSONB DEFAULT '[]',
    analysis_summary TEXT,
    raw_response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Human Reviews table
CREATE TABLE human_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
    reviewer_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    overall_score NUMERIC,
    engagement_score NUMERIC,
    content_accuracy_score NUMERIC,
    communication_score NUMERIC,
    comments TEXT,
    review_time_minutes INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tutor Presence table
CREATE TABLE tutor_presence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tutor_id UUID REFERENCES tutors(id) ON DELETE CASCADE NOT NULL,
    login_time TIMESTAMPTZ NOT NULL,
    logout_time TIMESTAMPTZ,
    activity_status activity_status DEFAULT 'offline',
    session_type TEXT DEFAULT 'mobile',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quality Criteria table
CREATE TABLE quality_criteria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    weight NUMERIC DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    action TEXT NOT NULL,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_sessions_tutor_id ON sessions(tutor_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_assigned_reviewer ON sessions(assigned_reviewer_id);
CREATE INDEX idx_ai_analyses_session_id ON ai_analyses(session_id);
CREATE INDEX idx_human_reviews_session_id ON human_reviews(session_id);
CREATE INDEX idx_human_reviews_reviewer_id ON human_reviews(reviewer_id);
CREATE INDEX idx_tutor_presence_tutor_id ON tutor_presence(tutor_id);
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tutors_updated_at BEFORE UPDATE ON tutors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_human_reviews_updated_at BEFORE UPDATE ON human_reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
