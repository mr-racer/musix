"""structlog JSON logs, Prometheus /metrics, optional OpenTelemetry (spec §11)."""

from __future__ import annotations

import logging
import os
import time
import uuid

import structlog
from fastapi import FastAPI, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from musix.settings import Settings

REQUESTS = Histogram(
    "musix_http_request_seconds",
    "API latency",
    ["method", "route", "status"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)
# with several uvicorn workers, PROMETHEUS_MULTIPROC_DIR makes /metrics the sum of all
WS_CONNECTIONS = Gauge("musix_ws_connections", "Open realtime sockets", multiprocess_mode="livesum")
QUEUE_DEPTH = Gauge(
    "musix_queue_jobs",
    "Queue jobs by queue and status",
    ["queue", "status"],
    multiprocess_mode="max",
)


def configure_logging(level: str) -> None:
    logging.basicConfig(level=level, format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
    )


class Observe:
    """Request log context + latency histogram. Pure ASGI: BaseHTTPMiddleware
    (`@app.middleware`) costs a task and a stream per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        structlog.contextvars.clear_contextvars()
        rid = dict(scope["headers"]).get(b"x-request-id")
        structlog.contextvars.bind_contextvars(trace_id=rid.decode() if rid else uuid.uuid4().hex)
        t0, status = time.perf_counter(), 500

        async def observed(m: Message) -> None:
            nonlocal status
            if m["type"] == "http.response.start":
                status = m["status"]
            await send(m)

        try:
            await self.app(scope, receive, observed)
        finally:
            # the route TEMPLATE, never the raw path: ids would explode the label cardinality
            route = getattr(scope.get("route"), "path", "unmatched")
            REQUESTS.labels(scope["method"], route, str(status)).observe(time.perf_counter() - t0)


def install(app: FastAPI, settings: Settings) -> None:
    configure_logging(settings.log_level)
    app.add_middleware(Observe)

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(registry)  # type: ignore[no-untyped-call]
            return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    if settings.otlp_endpoint:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider()
        provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.otlp_endpoint))
        )
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
