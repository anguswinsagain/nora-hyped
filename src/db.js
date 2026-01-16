import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.TICKETS_DB_PATH || "tickets.db";
const dir = path.dirname(dbPath);

if (dir && dir !== "." && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);

// Base table
db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_channel_id TEXT,
    user_id TEXT,
    category TEXT,
    moderator_id TEXT,
    resolution_text TEXT,
    initial_description TEXT,
    created_at TEXT,
    closed_at TEXT
  );
`);

// In case the table existed without initial_description before, try to add it
try {
  db.exec(`ALTER TABLE ticket_logs ADD COLUMN initial_description TEXT;`);
} catch {
  // ignore if it already exists
}

export function logTicketCreation({
  channelId,
  userId,
  category,
  initialDescription,
}) {
  db.prepare(
    `INSERT INTO ticket_logs
     (ticket_channel_id, user_id, category, initial_description, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(channelId, userId, category, initialDescription || null);
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
