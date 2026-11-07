import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_session
from app.main import app

APP_DB_URL = make_url(os.environ["DATABASE_URL"])
TEST_DB_URL = APP_DB_URL.set(database=f"{APP_DB_URL.database}_test")


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    admin = create_engine(APP_DB_URL.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{TEST_DB_URL.database}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{TEST_DB_URL.database}"'))
    admin.dispose()

    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", TEST_DB_URL.render_as_string(hide_password=False))
    command.upgrade(config, "head")

    engine = create_engine(TEST_DB_URL)
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> sessionmaker[Session]:
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE email_jobs, patients RESTART IDENTITY"))
    return sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
def client(session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    def override() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()
