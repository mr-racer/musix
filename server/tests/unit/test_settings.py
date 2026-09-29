import pytest

from musix.settings import Settings


def test_one_dsn_gives_the_three_driver_forms() -> None:
    s = Settings(_env_file=None, database_url="postgresql+asyncpg://u:p@db:5432/musix")  # type: ignore[call-arg]
    assert s.sqlalchemy_async_url == "postgresql+asyncpg://u:p@db:5432/musix"
    assert s.sqlalchemy_sync_url == "postgresql+psycopg://u:p@db:5432/musix"
    assert s.procrastinate_conninfo == "postgresql://u:p@db:5432/musix"


def test_rejects_a_non_postgres_dsn() -> None:
    with pytest.raises(ValueError, match="postgresql"):
        Settings(_env_file=None, database_url="mysql://x@h/d")  # type: ignore[call-arg]
