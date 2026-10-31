from dataclasses import dataclass
from datetime import datetime, timedelta

from mariner.db.models import ImportJob
from mariner.db.store import database, rows, seed
from mariner.engine.service import create_run
from mariner.pipeline.orchestrator import Pipeline
from mariner.settings import now


@dataclass
class TariffRuntime:
    settings: object
    engine: object
    factory: object
    pipeline: Pipeline
    llm: object

    def close(self):
        self.pipeline.close()
        self.engine.dispose()


def open_runtime(settings, database_url, llm) -> TariffRuntime:
    engine, factory = database(database_url)
    with factory.begin() as session:
        seed(session, str(settings.today), sample_orders=settings.seed_sample_orders)
        create_run(session, settings)
        cutoff = datetime.fromisoformat(now()) - timedelta(days=7)
        for job in rows(session, ImportJob):          # moved from MA main.lifespan
            created = job.payload.get("created_at")
            if created and datetime.fromisoformat(created) < cutoff:
                session.delete(job)
    return TariffRuntime(settings, engine, factory, Pipeline(factory, settings, llm), llm)
