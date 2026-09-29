"""Module-level queue app for the CLI: `procrastinate --app=musix.workers.app.app worker`."""

from musix.infra.queue import make_queue_app
from musix.settings import Settings

app = make_queue_app(Settings())
