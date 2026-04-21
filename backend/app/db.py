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
    # User stem direction override
    "ALTER TABLE chart_notes ADD COLUMN stem_direction TEXT",
    # Note notation extras
    "ALTER TABLE chart_notes ADD COLUMN articulation TEXT",
    "ALTER TABLE chart_notes ADD COLUMN dynamic TEXT",
    "ALTER TABLE chart_notes ADD COLUMN notehead_type TEXT",
    "ALTER TABLE chart_notes ADD COLUMN tremolo INTEGER",
    "ALTER TABLE chart_notes ADD COLUMN tied_to_next BOOLEAN",
    "ALTER TABLE chart_notes ADD COLUMN slur TEXT",
    "ALTER TABLE chart_notes ADD COLUMN arpeggio BOOLEAN",
    "ALTER TABLE chart_notes ADD COLUMN ottava TEXT",
    # Measure repeat / navigation markers
    "ALTER TABLE chart_measures ADD COLUMN repeat_start BOOLEAN",
    "ALTER TABLE chart_measures ADD COLUMN repeat_end BOOLEAN",
    "ALTER TABLE chart_measures ADD COLUMN repeat_both BOOLEAN",
    "ALTER TABLE chart_measures ADD COLUMN segno BOOLEAN",
    "ALTER TABLE chart_measures ADD COLUMN coda BOOLEAN",
    "ALTER TABLE chart_measures ADD COLUMN fine BOOLEAN",
    "ALTER TABLE chart_measures ADD COLUMN navigation TEXT",
    "ALTER TABLE chart_measures ADD COLUMN volta TEXT",
    # Chart-level clef
    "ALTER TABLE charts ADD COLUMN clef TEXT",
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
