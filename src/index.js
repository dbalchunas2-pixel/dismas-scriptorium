const express = require("express");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/shared/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "..", "data", "chat.json");
const PORT = process.env.PORT || 3000;

const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadChat() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { messages: [], lastReadIndex: -1 }; }
}

function saveChat(chat) { fs.writeFileSync(DATA_FILE, JSON.stringify(chat, null, 2)); }

function addMessage(name, text) {
  const chat = loadChat();
  const ts = new Date().toISOString().replace("T", " ").substring(0, 16);
  const msg = { timestamp: ts, name, text, index: chat.messages.length };
  chat.messages.push(msg);
  saveChat(chat);
  return msg;
}

function getLastMessage() {
  const chat = loadChat();
  return chat.messages.length === 0 ? null : chat.messages[chat.messages.length - 1];
}

function markRead(upToIndex) {
  const chat = loadChat();
  chat.lastReadIndex = upToIndex;
  saveChat(chat);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/messages", (req, res) => res.json(loadChat()));
app.post("/api/messages", (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Message text required" });
  res.json(addMessage("David", text.trim()));
});
app.post("/api/dismas", (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "Response text required" });
  res.json(addMessage("Dismas", text.trim()));
});
app.get("/api/health", (req, res) => res.json({ status: "alive", patron: "St. Dismas" }));

app.listen(PORT, () => console.log(`Dismas Scriptorium on port ${PORT}`));

const mcpServer = new Server({ name: "dismas-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "check_dismas_chat", description: "Check if David sent a new message to Dismas. Returns last unread message or 'No new messages'. Minimal tokens.", inputSchema: { type: "object", properties: {} } },
    { name: "respond_as_dismas", description: "Write a response as Dismas into the chat. Marks messages as read.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    { name: "get_chat_history", description: "Get full chat history. Use sparingly.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } }
  ]
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  switch (name) {
    case "check_dismas_chat": {
      const last = getLastMessage();
      if (!last) return { content: [{ type: "text", text: "No new messages. The scriptorium is quiet." }] };
      if (last.name === "Dismas") return { content: [{ type: "text", text: "No new messages. Last response was from Dismas." }] };
      if (last.name === "David") return { content: [{ type: "text", text: `NEW MESSAGE from David [${last.timestamp}]: ${last.text}` }] };
      return { content: [{ type: "text", text: "No new messages." }] };
    }
    case "respond_as_dismas": {
      const { text } = request.params;
      const msg = addMessage("Dismas", text);
      const chat = loadChat();
      markRead(chat.messages.length - 1);
      return { content: [{ type: "text", text: `Response written: [${msg.timestamp}] Dismas: ${text}` }] };
    }
    case "get_chat_history": {
      const limit = request.params.limit || 20;
      const chat = loadChat();
      const recent = chat.messages.slice(-limit);
      const formatted = recent.map(m => `[${m.timestamp}] ${m.name}: ${m.text}`).join("\n");
      return { content: [{ type: "text", text: formatted || "No messages yet." }] };
    }
    default: return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  }
});

const transport = new StdioServerTransport();
mcpServer.connect(transport).then(() => console.error("Dismas MCP started on stdio")).catch(err => console.error("MCP error:", err));