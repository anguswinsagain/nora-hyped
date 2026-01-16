import Database from "better-sqlite3";

const db = new Database(process.env.TICKETS_DB_PATH || "tickets.db");

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

export function logTicketResolution({ channelId, moderatorId, resolutionText }) {
  db.prepare(
    `UPDATE ticket_logs
     SET moderator_id=?, resolution_text=?, closed_at=datetime('now')
     WHERE ticket_channel_id=?`
  ).run(moderatorId, resolutionText, channelId);
}
