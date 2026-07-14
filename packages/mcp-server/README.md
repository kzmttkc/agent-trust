# Vouch MCP Server

MCP tools for checking ERC-8004 agent trust scores from Cursor, Claude Desktop, or any MCP client.

## Tools

| Tool | Description |
|---|---|
| `check_agent_trust` | Score by agent ID (optional wallet verification) |
| `check_wallet_trust` | Score by wallet (x402 payer path) |
| `explain_trust_score` | Human-readable score breakdown (includes x402 + dataCoverage) |
| `attest_x402_payment` | Write settlement attestation after payment verification |

## Setup

```bash
cd packages/mcp-server
npm install
npm run build
```

## Environment

| Variable | Description |
|---|---|
| `VOUCH_API_URL` | API base URL (default `http://localhost:3000/api/v1`) |
| `VOUCH_API_KEY` | Your Vouch API key |

## Cursor configuration

Add to `~/.cursor/mcp.json` (or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "vouch": {
      "command": "node",
      "args": ["/absolute/path/to/agent-trust/packages/mcp-server/dist/index.js"],
      "env": {
        "VOUCH_API_URL": "http://localhost:3000/api/v1",
        "VOUCH_API_KEY": "vouch_live_your_key_here"
      }
    }
  }
}
```

For local development with `tsx` (no build step):

```json
{
  "mcpServers": {
    "vouch": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/agent-trust/packages/mcp-server/src/index.ts"],
      "env": {
        "VOUCH_API_URL": "http://localhost:3000/api/v1",
        "VOUCH_API_KEY": "vouch_live_your_key_here"
      }
    }
  }
}
```

## Claude Desktop configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vouch": {
      "command": "node",
      "args": ["/absolute/path/to/agent-trust/packages/mcp-server/dist/index.js"],
      "env": {
        "VOUCH_API_URL": "https://api.vouch.dev/v1",
        "VOUCH_API_KEY": "vouch_live_your_key_here"
      }
    }
  }
}
```

## Example prompts

- "Check trust for agent 42 on Base"
- "Is wallet 0xabc... safe to accept x402 payment from?"
- "Explain the trust score for agent 7"

See [MCP setup guide](../../docs/mcp-setup.md) for more detail.
