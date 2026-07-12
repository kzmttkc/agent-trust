# MCP Setup Guide

Connect Vouch trust tools to Cursor or Claude Desktop via the MCP server in `packages/mcp-server`.

## Prerequisites

1. Vouch API running (`npm run dev` locally, or production URL)
2. API key (`npm run api-key:create` for database-backed keys)
3. MCP server built:

```bash
cd packages/mcp-server
npm install
npm run build
```

## Cursor

1. Open **Cursor Settings → MCP** (or edit `~/.cursor/mcp.json`)
2. Add the `vouch` server:

```json
{
  "mcpServers": {
    "vouch": {
      "command": "node",
      "args": ["/Users/you/Projects/agent-trust/packages/mcp-server/dist/index.js"],
      "env": {
        "VOUCH_API_URL": "http://localhost:3000/api/v1",
        "VOUCH_API_KEY": "vouch_live_..."
      }
    }
  }
}
```

3. Restart Cursor or reload MCP servers
4. In Agent chat, the model can call:
   - `check_agent_trust`
   - `check_wallet_trust`
   - `explain_trust_score`

## Claude Desktop

Edit `claude_desktop_config.json` with the same structure (see [packages/mcp-server/README.md](../packages/mcp-server/README.md)).

## Environment variables

| Variable | Required | Default |
|---|---|---|
| `VOUCH_API_KEY` | Yes | — |
| `VOUCH_API_URL` | No | `http://localhost:3000/api/v1` |

## Troubleshooting

| Issue | Fix |
|---|---|
| `invalid_api_key` | Use a database-backed key, not `DEV_API_KEY` in production |
| Connection refused | Ensure `npm run dev` is running for local API |
| MCP server not listed | Check absolute paths in config; rebuild with `npm run build` |
| Tools return errors | Verify `VOUCH_API_URL` has no trailing slash issues |

## Use cases

- **Agent runtime**: check counterparty trust before initiating x402 payment
- **Development**: inspect ERC-8004 agent scores from Cursor without curl
- **Support**: explain why a wallet received WARN or BLOCK
