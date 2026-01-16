import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.TICKETS_DB_PATH || "tickets.db";
const dir = path.dirname(dbPath);

if (dir && dir !== "." && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath);

// Base schema
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
    closed_at TEXT,
    awaiting_review INTEGER DEFAULT 0,
    review_text TEXT,
    review_created_at TEXT
  );
`);

// Safe migrations (in case older versions exist)
const addColumn = (name, def) => {
  try {
    db.exec(`ALTER TABLE ticket_logs ADD COLUMN ${name} ${def};`);
  } catch {
    // ignore if it already exists
  }
};

addColumn("awaiting_review", "INTEGER DEFAULT 0");
addColumn("review_text", "TEXT");
addColumn("review_created_at", "TEXT");

export function createTicket({ channelId, userId, category, initialDescription }) {
  const stmt = db.prepare(`
    INSERT INTO ticket_logs
      (ticket_channel_id, user_id, category, initial_description, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);

  stmt.run(channelId, userId, category, initialDescription || null);
}

export function getTicketByChannelId(channelId) {
  const stmt = db.prepare(`
    SELECT * FROM ticket_logs
    WHERE ticket_channel_id = ?
    ORDER BY id DESC
    LIMIT 1
  `);
  return stmt.get(channelId) || null;
}

export function getOpenTicketForUser(userId) {
  const stmt = db.prepare(`
    SELECT * FROM ticket_logs
    WHERE user_id = ? AND closed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return stmt.get(userId) || null;
}

export function closeTicket({ channelId, moderatorId, resolutionText }) {
  const stmt = db.prepare(`
    UPDATE ticket_logs
    SET moderator_id = ?, resolution_text = ?, closed_at = datetime('now'),
        awaiting_review = 1
    WHERE ticket_channel_id = ? AND closed_at IS NULL
  `);

  stmt.run(moderatorId, resolutionText || null, channelId);

  // Return updated row
  return getTicketByChannelId(channelId);
}

export function getPendingReviewTicketForUser(userId) {
  const stmt = db.prepare(`
    SELECT * FROM ticket_logs
    WHERE user_id = ? AND awaiting_review = 1
    ORDER BY closed_at DESC, id DESC
    LIMIT 1
  `);
  return stmt.get(userId) || null;
}

export function saveReview({ ticketId, reviewText }) {
  const stmt = db.prepare(`
    UPDATE ticket_logs
    SET review_text = ?, review_created_at = datetime('now'),
        awaiting_review = 0
    WHERE id = ?
  `);
  stmt.run(reviewText, ticketId);
}
