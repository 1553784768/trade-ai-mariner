import os
os.environ.setdefault("TARIFF_SCHEDULER_ENABLED", "false")
os.environ.setdefault("TARIFF_COLLECTOR_MODE", "fixture")
os.environ.setdefault("TARIFF_AS_OF_DATE", "2026-10-31")
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
