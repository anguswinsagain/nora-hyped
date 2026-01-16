import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.TICKETS_DB_PATH || "tickets.db";
const dir = path.dirname(dbPath);

// create directory if needed and not just "."
if (dir && dir !== "." && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_channel_id TEXT,
    user_id TEXT,
    category TEXT,
    moderator_id TEXT,
    resolution_text TEXT,
    created_at TEXT,
    closed_at TEXT
  );
`);

export function logTicketCreation({ channelId, userId, category }) {
  db.prepare(
    `INSERT INTO ticket_logs
     (ticket_channel_id, user_id, category, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(channelId, userId, category);
}

export function logTicketResolution({
  channelId,
  moderatorId,
  resolutionText,
}) {
  db.prepare(
    `UPDATE ticket_logs
     SET moderator_id = ?, resolution_text = ?, closed_at = datetime('now')
     WHERE ticket_channel_id = ?`
  ).run(moderatorId, resolutionText, channelId);
}
