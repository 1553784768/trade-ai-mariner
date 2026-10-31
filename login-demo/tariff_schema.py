TABLES = [
    """CREATE TABLE IF NOT EXISTS tariff_model_settings (
        workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        last_test TEXT NOT NULL DEFAULT 'null',
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )""",
    """CREATE TABLE IF NOT EXISTS tariff_order_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL,
        tariff_order_id TEXT NOT NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
        item_position INTEGER,               -- 0-based index into GET /api/orders/{id} items
        item_name TEXT NOT NULL DEFAULT '',  -- product_name at conversion time; used to detect stale links
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(workspace_id, company_id, tariff_order_id),
        FOREIGN KEY(company_id, workspace_id) REFERENCES companies(id, workspace_id) ON DELETE CASCADE
    )""",
    "CREATE INDEX IF NOT EXISTS idx_tariff_links_customer ON tariff_order_links(workspace_id, company_id, customer_id)",
    "CREATE INDEX IF NOT EXISTS idx_tariff_links_order ON tariff_order_links(workspace_id, company_id, order_id)",
    # Two triggers, BEFORE INSERT and BEFORE UPDATE, with the same WHEN:
    #  (NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id=NEW.customer_id
    #       AND workspace_id=NEW.workspace_id AND company_id=NEW.company_id))
    #  OR (NEW.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id
    #       AND workspace_id=NEW.workspace_id AND company_id=NEW.company_id))
    #  BEGIN SELECT RAISE(ABORT, 'Link target belongs to another company'); END
]

for operation in ("INSERT", "UPDATE"):
    TABLES.append(f"""CREATE TRIGGER IF NOT EXISTS tariff_link_scope_{operation.lower()}
        BEFORE {operation} ON tariff_order_links
        WHEN (NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id=NEW.customer_id
            AND workspace_id=NEW.workspace_id AND company_id=NEW.company_id))
        OR (NEW.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.order_id
            AND workspace_id=NEW.workspace_id AND company_id=NEW.company_id))
        BEGIN SELECT RAISE(ABORT, 'Link target belongs to another company'); END""")
