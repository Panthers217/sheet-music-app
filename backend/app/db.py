from collections.abc import Generator
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/app.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ---------------------------------------------------------------------------
# Incremental schema migrations
# Each statement is attempted once; errors (column already exists) are ignored.
# Add new ALTER TABLE statements here as the schema evolves.
# ---------------------------------------------------------------------------
_MIGRATIONS = [
    "ALTER TABLE chart_measures ADD COLUMN chord_confidence REAL",
    "ALTER TABLE chart_measures ADD COLUMN chord_alternatives TEXT",
    "ALTER TABLE chart_notes ADD COLUMN velocity INTEGER",
    "ALTER TABLE chart_notes ADD COLUMN start_time_s REAL",
    "ALTER TABLE chart_notes ADD COLUMN end_time_s REAL",
    # Notation timing layer (separate from raw MIDI performance timing)
    "ALTER TABLE chart_notes ADD COLUMN notation_position INTEGER",
    "ALTER TABLE chart_notes ADD COLUMN notation_duration TEXT",
]


def run_migrations() -> None:
    """Apply any pending incremental column additions. Idempotent."""
    with engine.connect() as conn:
        for stmt in _MIGRATIONS:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists — safe to ignore


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
