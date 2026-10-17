-- Custom migration: pgvector must exist before any vector column (memory, P3).
CREATE EXTENSION IF NOT EXISTS vector;
