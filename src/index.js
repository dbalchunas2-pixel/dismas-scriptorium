const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/shared/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "dismas.db");
const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.DISMAS_PASSWORD_HASH || "";
const TOTP_SECRET = process.env.DISMAS_TOTP_SECRET || "";
const SESSION_SECRET = process.env.DISMAS_SESSION_SECRET || "dismas-scriptorium-" + Math.random();

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// === SQLITE STORAGE (DBA-7) ===
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function addMessage(name, text) {
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const stmt = db.prepare("INSERT INTO messages (timestamp, name, text) VALUES (?, ?, ?)");
  const info = stmt.run(ts, name, text);
  return { id: info.lastInsertRowid, timestamp: ts, name, text };
}

function getLastMessage() {
  const row = db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT 1").get();
  return row || null;
}

function getAllMessages() {
  return db.prepare("SELECT * FROM messages ORDER BY id ASC").all();
}

function getRecentMessages(limit) {
  return db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?").all(limit).reverse();
}

function getUnsyncedMessages() {
  const lastSync = db.prepare("SELECT value FROM sync_state WHERE key = 'lastSyncId'").get();
  const lastSyncId = lastSync ? parseInt(lastSync.value) : 0;
  const unsynced = db.prepare("SELECT * FROM messages WHERE id > ? ORDER BY id ASC").all(lastSyncId);
  return { unsynced, lastSyncId };
}

function markSynced(upToId) {
  const stmt = db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('lastSyncId', ?)");
  stmt.run(String(upToId));
}

function getLastReadId() {
  const row = db.prepare("SELECT value FROM sync_state WHERE key = 'lastReadId'").get();
  return row ? parseInt(row.value) : 0;
}

function markRead(upToId) {
  const stmt = db.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('lastReadId', ?)");
  stmt.run(String(upToId));
}

// === HTTP SERVER ===
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000, httpOnly: true, sameSite: "strict" }
}));

// DBA-5: Rate limiting on login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "The door is barred. Return later." }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Not authenticated" });
  res.redirect("/login");
}

// DBA-6: Setup route
app.get("/setup", (req, res) => {
  if (PASSWORD_HASH) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "..", "public", "setup.html"));
});

app.post("/api/setup/hash", (req, res) => {
  if (PASSWORD_HASH) return res.status(403).json({ error: "Already configured" });
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  const hash = bcrypt.hashSync(password, 10);
  res.json({ hash, instructions: "Copy this to Railway env var DISMAS_PASSWORD_HASH" });
});

app.get("/api/setup/totp", (req, res) => {
  if (PASSWORD_HASH) return res.status(403).json({ error: "Already configured" });
  const secret = speakeasy.generateSecret({ length: 20, name: "Dismas Scriptorium" });
  QRCode.toDataURL(secret.otpauth_url, (err, dataUrl) => {
    if (err) return res.status(500).json({ error: "QR generation failed" });
    res.json({ base32: secret.base32, qr: dataUrl, otpauth_url: secret.otpauth_url });
  });
});

app.get("/login", (req, res) => {
  if (!PASSWORD_HASH) return res.redirect("/setup");
  res.sendFile(path.join(__dirname, "..", "public", "login.html"));
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const { password, token } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  if (!bcrypt.compareSync(password, PASSWORD_HASH)) return res.status(401).json({ error: "The door remains barred." });
  if (TOTP_SECRET) {
    if (!token) return res.status(401).json({ error: "The second key is required.", needsToken: true });
    const verified = speakeasy.totp.verify({ secret: TOTP_SECRET, encoding: "base32", token, window: 1 });
    if (!verified) return res.status(401).json({ error: "The second key does not turn." });
  }
  req.session.authenticated = true;
  res.json({ success: true, message: "The scriptorium opens." });
});

app.post("/api/logout", (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get("/api/auth-status", (req, res) => res.json({ authenticated: !!(req.session && req.session.authenticated) }));

app.get("/", requireAuth, (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.get("/api/messages", requireAuth, (req, res) => res.json({ messages: getAllMessages() }));
app.post("/api/messages", requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Required" });
  res.json(addMessage("David", text.trim()));
});
app.post("/api/dismas", requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Required" });
  res.json(addMessage("Dismas", text.trim()));
});
app.get("/api/unsynced", requireAuth, (req, res) => res.json(getUnsyncedMessages()));
app.post("/api/mark-synced", requireAuth, (req, res) => {
  const { upToId } = req.body;
  markSynced(upToId);
  res.json({ success: true });
});
app.get("/api/health", (req, res) => res.json({ status: "alive", patron: "St. Dismas", storage: "sqlite" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.listen(PORT, () => console.log(`Dismas Scriptorium on port ${PORT} (SQLite at ${DB_FILE})`));

// === MCP SERVER ===
const mcpServer = new Server({ name: "dismas-mcp", version: "3.0.0" }, { capabilities: { tools: {} } });
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "check_dismas_chat", description: "Check if David sent a new message. Returns last unread or 'No new messages'.", inputSchema: { type: "object", properties: {} } },
    { name: "respond_as_dismas", description: "Write a response as Dismas.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    { name: "get_chat_history", description: "Get chat history. Use sparingly.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
    { name: "get_unsynced_messages", description: "Get messages not yet synced to Obsidian.", inputSchema: { type: "object", properties: {} } },
    { name: "mark_synced", description: "Mark messages as synced up to ID.", inputSchema: { type: "object", properties: { upToId: { type: "number" } }, required: ["upToId"] } }
  ]
}));
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  switch (name) {
    case "check_dismas_chat": {
      const last = getLastMessage();
      const lastReadId = getLastReadId();
      if (!last) return { content: [{ type: "text", text: "No new messages. The scriptorium is quiet." }] };
      if (last.name === "Dismas") return { content: [{ type: "text", text: "No new messages. Last response was from Dismas." }] };
      if (last.name === "David" && last.id > lastReadId) {
        markRead(last.id);
        return { content: [{ type: "text", text: `NEW MESSAGE from David [${last.timestamp}]: ${last.text}` }] };
      }
      return { content: [{ type: "text", text: "No new messages." }] };
    }
    case "respond_as_dismas": {
      const { text } = request.params;
      const msg = addMessage("Dismas", text);
      return { content: [{ type: "text", text: `Response written: [${msg.timestamp}] Dismas: ${text}` }] };
    }
    case "get_chat_history": {
      const limit = request.params.limit || 20;
      const msgs = getRecentMessages(limit);
      return { content: [{ type: "text", text: msgs.map(m => `[${m.timestamp}] ${m.name}: ${m.text}`).join("\n") || "No messages." }] };
    }
    case "get_unsynced_messages": {
      const { unsynced, lastSyncId } = getUnsyncedMessages();
      if (unsynced.length === 0) return { content: [{ type: "text", text: "No unsynced messages." }] };
      return { content: [{ type: "text", text: `${unsynced.length} unsynced:\n${unsynced.map(m => `[${m.timestamp}] ${m.name}: ${m.text}`).join("\n")}` }] };
    }
    case "mark_synced": {
      const { upToId } = request.params;
      markSynced(upToId);
      return { content: [{ type: "text", text: `Synced up to ${upToId}.` }] };
    }
    default: return { content: [{ type: "text", text: `Unknown: ${name}` }] };
  }
});
const transport = new StdioServerTransport();
mcpServer.connect(transport).then(() => console.error("Dismas MCP started")).catch(e => console.error("MCP error:", e));