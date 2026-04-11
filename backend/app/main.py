import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.db import Base, engine

app = FastAPI(title="Sheet Music MVP API")

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Path("data").mkdir(parents=True, exist_ok=True)
    Path(os.getenv("UPLOAD_DIR", "./uploads")).mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


app.include_router(router)
