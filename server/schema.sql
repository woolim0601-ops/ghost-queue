CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), accepting INTEGER NOT NULL DEFAULT 1);
INSERT OR IGNORE INTO settings (id, accepting) VALUES (1,1);
CREATE TABLE IF NOT EXISTS tickets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT NOT NULL UNIQUE,
 token TEXT NOT NULL UNIQUE,
 student_id TEXT NOT NULL,
 name TEXT NOT NULL,
 phone TEXT NOT NULL,
 people INTEGER NOT NULL CHECK(people BETWEEN 1 AND 10),
 status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','called','entered','absent','cancelled')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS active_phone ON tickets(phone) WHERE status IN ('waiting','called','absent');
CREATE INDEX IF NOT EXISTS ticket_status ON tickets(status,id);
