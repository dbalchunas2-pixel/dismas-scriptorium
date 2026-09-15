# Dismas Scriptorium MCP

A custom MCP server + web UI for chatting with Dismas, the Good Thief.

## Architecture

- **HTTP server** (Express) serves the web UI and REST API on the same port
- **MCP server** (stdio) exposes tools for Littlebird routines
- **Chat state** stored in a simple JSON file

## MCP Tools

- `check_dismas_chat` - Returns last unread message from David, or 'No new messages'. Minimal tokens.
- `respond_as_dismas` - Writes a Dismas response into the chat
- `get_chat_history` - Returns full chat history (use sparingly)

## HTTP API

- `GET /` - Web UI (KCD2 Catholic themed chat interface)
- `GET /api/messages` - All messages
- `POST /api/messages` - Send a message as David
- `POST /api/dismas` - Send a response as Dismas
- `GET /api/health` - Health check

## Deploy to Render

1. Create a new Web Service on Render
2. Connect this GitHub repo
3. Render auto-detects from render.yaml
4. Your service URL is the Dismas chat UI

## Token Efficiency

- `check_dismas_chat` returns ~20 tokens when empty, ~50 when there is a message
- Reading the full Obsidian Scriptorium note = ~3000+ tokens (includes base64 image)
- That is a 60x reduction per check