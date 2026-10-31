from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from pydantic import BaseModel
from mariner.api import routes, model_settings, pipeline_routes, knowledge, chat, import_jobs, schemas
from mariner.api.errors import register_errors
from mariner.runtime import open_runtime
from mariner.llm_store import MemoryLlmStore
from mariner.settings import Settings
from mariner.scheduler import make_scheduler


def install_openapi(app):
    def openapi():
        if app.openapi_schema is None:
            schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
            definitions = schema.setdefault("components", {}).setdefault("schemas", {})
            for name, model in vars(schemas).items():
                if isinstance(model, type) and issubclass(model, BaseModel) and model is not BaseModel:
                    data = model.model_json_schema(ref_template="#/components/schemas/{model}")
                    definitions.update(data.pop("$defs", {}))
                    definitions.setdefault(name, data)
            app.openapi_schema = schema
        return app.openapi_schema
    app.openapi = openapi


MARINER_VERSION = "0.3.0"
ROUTERS = [routes.router, model_settings.router, pipeline_routes.router,
           knowledge.router, chat.router, import_jobs.router]


def create_tariff_app(resolve_runtime, *, prefix: str = "") -> FastAPI:
    app = FastAPI(title="Mariner AI (Trade AI tariff module)", version=MARINER_VERSION)
    app.state.resolve_runtime = resolve_runtime
    register_errors(app)
    for router in ROUTERS:
        app.include_router(router, prefix=prefix)

    @app.get(f"{prefix}/health")
    def health():
        return {"status": "ok"}

    install_openapi(app)  # copy the custom openapi() from MA main.py unchanged
    return app


def create_standalone_app(settings: Settings | None = None) -> FastAPI:
    """Single-tenant app used ONLY by the ported MA tests and local debugging."""
    settings = settings or Settings()
    runtime = open_runtime(settings, settings.database_url, MemoryLlmStore())
    app = create_tariff_app(lambda request: runtime, prefix="/api/tariff")
    app.state.runtime = runtime
    app.state.factory = runtime.factory      # the ported tests use these three names
    app.state.settings = settings
    app.state.pipeline = runtime.pipeline
    scheduler = make_scheduler(settings, runtime.pipeline)

    @asynccontextmanager
    async def lifespan(_app):
        if settings.scheduler_enabled:
            scheduler.start()
        try:
            yield
        finally:
            if scheduler.running:
                scheduler.shutdown()
            runtime.close()

    app.router.lifespan_context = lifespan
    return app
