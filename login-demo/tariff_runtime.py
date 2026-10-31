"""Tenant-isolated tariff runtimes and encrypted workspace model settings."""
import json
import logging
from pathlib import Path
from threading import RLock

from fastapi import HTTPException
from database import connection
from tenancy import require_tenant
from mariner.runtime import open_runtime

logger = logging.getLogger(__name__)


class WorkspaceLlmStore:
    def __init__(self, db_path, workspace_id, secret_store):
        self.db_path, self.workspace_id, self.secret_store = db_path, workspace_id, secret_store

    def get(self):
        with connection(self.db_path) as conn:
            row = conn.execute('SELECT * FROM tariff_model_settings WHERE workspace_id=?', (self.workspace_id,)).fetchone()
        if row is None:
            return None
        try:
            key = self.secret_store.decrypt(self.workspace_id, row['api_key_encrypted'])
        except ValueError:
            logger.warning('Cannot decrypt tariff model settings for workspace %s', self.workspace_id)
            return None
        return dict(base_url=row['base_url'], model=row['model'], api_key=key, last_test=json.loads(row['last_test']))

    def save(self, *, base_url, model, api_key):
        encrypted = self.secret_store.encrypt(self.workspace_id, api_key)
        with connection(self.db_path) as conn:
            conn.execute("""INSERT INTO tariff_model_settings(workspace_id,base_url,model,api_key_encrypted)
                VALUES (?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET
                base_url=excluded.base_url, model=excluded.model, api_key_encrypted=excluded.api_key_encrypted,
                last_test='null', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')""",
                (self.workspace_id, base_url, model, encrypted))
        return self.get()

    def clear(self):
        with connection(self.db_path) as conn:
            conn.execute('DELETE FROM tariff_model_settings WHERE workspace_id=?', (self.workspace_id,))

    def record_test(self, result):
        with connection(self.db_path) as conn:
            conn.execute('UPDATE tariff_model_settings SET last_test=? WHERE workspace_id=?',
                         (json.dumps(result, ensure_ascii=False), self.workspace_id))


class TariffRegistry:
    def __init__(self, db_path, data_dir, settings, secret_store):
        self.db_path, self.data_dir = db_path, Path(data_dir)
        self.settings, self.secret_store = settings, secret_store
        self._lock, self._runtimes = RLock(), {}

    def path_for(self, ws, company):
        return self.data_dir / f'w{ws}' / f'c{company}.sqlite3'

    def is_opened(self, ws, company):
        return self.path_for(ws, company).is_file()

    def get(self, ws, company):
        with self._lock:
            key = (ws, company)
            if key not in self._runtimes:
                self._runtimes[key] = open_runtime(self.settings, 'sqlite:///' + self.path_for(ws, company).as_posix(),
                                                  WorkspaceLlmStore(self.db_path, ws, self.secret_store))
            return self._runtimes[key]

    def resolve(self, request):
        tenant = require_tenant(request)
        if tenant.company_id is None:
            raise HTTPException(404, 'Company not found')
        return self.get(tenant.workspace_id, tenant.company_id)

    def existing_tenants(self):
        with connection(self.db_path) as conn:
            companies = conn.execute('SELECT id, workspace_id FROM companies').fetchall()
        return [(c['workspace_id'], c['id']) for c in companies if self.is_opened(c['workspace_id'], c['id'])]

    def run_scheduled(self):
        for ws, company in self.existing_tenants():
            try:
                self.get(ws, company).pipeline.start(trigger='schedule_0730', background=False)
            except Exception:
                logger.exception('Scheduled tariff pipeline failed for %s/%s', ws, company)

    def close_all(self):
        with self._lock:
            for runtime in self._runtimes.values():
                runtime.close()
            self._runtimes.clear()
