"""The assistant, track chat, chat and AI playlists as queue jobs: a turn is
`POST /assistant/turns` → 202 {turnId}; its stages stream over the WebSocket and its
result is a row (`assistant_turns`) the client reads when `assistant.done` arrives."""
