import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from app.models import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

url = config.get_main_option("sqlalchemy.url") or os.environ["DATABASE_URL"]
engine = create_engine(url)

with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()

engine.dispose()
