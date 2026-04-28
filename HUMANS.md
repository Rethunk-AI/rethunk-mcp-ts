# Setup & Operations

User-facing setup, installation, configuration, and running guides.

## Prerequisites

- [Bun v1.2.21](https://bun.sh/) or higher
- OpenAI API key (for commit message validation). Get one [here](https://platform.openai.com/account/api-keys)

## Installation & Configuration by IDE

Choose your IDE and follow the setup steps.

### VSCode + Cline Extension

1. Install the [Cline extension](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) in VSCode.
2. Open VSCode settings, locate Cline configuration (usually at `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/cline_mcp_settings.json`).

**Option A: Using Published Registry (easiest)**

```json
{
  "mcpServers": {
    "rethunk-mcp-typescript": {
      "type": "stdio",
      "command": "bunx",
      "args": ["rethunk-mcp-typescript@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

**Option B: Using Local Clone (for development)**

1. Clone and build:
```bash
git clone https://github.com/Rethunk-AI/rethunk-mcp-ts.git /path/to/local/rethunk-mcp-ts
cd /path/to/local/rethunk-mcp-ts
bun install
bun rebuild
```

2. Add configuration (replace `/path/to/local/rethunk-mcp-ts`):
```json
{
  "mcpServers": {
    "rethunk-mcp-typescript": {
      "type": "stdio",
      "command": "bun",
      "args": ["--cwd", "/path/to/local/rethunk-mcp-ts", "start:stdio"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Cursor IDE

1. Open Cursor → **Settings → MCP**

**Option A: Using Published Registry (easiest)**

1. Click **Add Server** and add:
```json
{
  "name": "rethunk-mcp-typescript",
  "type": "stdio",
  "command": "bunx",
  "args": ["rethunk-mcp-typescript@latest"],
  "env": {
    "MCP_TRANSPORT_TYPE": "stdio",
    "MCP_LOG_LEVEL": "info",
    "OPENAI_API_KEY": "sk-..."
  }
}
```

**Option B: Using Local Clone (for development)**

1. Clone and build:
```bash
git clone https://github.com/Rethunk-AI/rethunk-mcp-ts.git /path/to/local/rethunk-mcp-ts
cd /path/to/local/rethunk-mcp-ts
bun install
bun rebuild
```

2. Click **Add Server** and add (replace path):
```json
{
  "name": "rethunk-mcp-typescript",
  "type": "stdio",
  "command": "bun",
  "args": ["--cwd", "/path/to/local/rethunk-mcp-ts", "start:stdio"],
  "env": {
    "MCP_TRANSPORT_TYPE": "stdio",
    "MCP_LOG_LEVEL": "info",
    "OPENAI_API_KEY": "sk-..."
  }
}
```

3. Save and restart Cursor to enable the tool.

### Claude Desktop

1. Locate your Claude Desktop configuration:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Option A: Using Published Registry (easiest)**

```json
{
  "mcpServers": {
    "rethunk-mcp-typescript": {
      "command": "bunx",
      "args": ["rethunk-mcp-typescript@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

**Option B: Using Local Clone (for development)**

1. Clone and build:
```bash
git clone https://github.com/Rethunk-AI/rethunk-mcp-ts.git /path/to/local/rethunk-mcp-ts
cd /path/to/local/rethunk-mcp-ts
bun install
bun rebuild
```

2. Add configuration (replace path):
```json
{
  "mcpServers": {
    "rethunk-mcp-typescript": {
      "command": "bun",
      "args": ["--cwd", "/path/to/local/rethunk-mcp-ts", "start:stdio"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

3. Restart Claude Desktop to activate.

### Local Development (Direct Execution)

For development or testing without IDE integration:

```bash
# Clone the repository
git clone https://github.com/Rethunk-AI/rethunk-mcp-ts.git
cd rethunk-mcp-ts

# Install dependencies
bun install

# Build the server
bun rebuild

# Set environment variables
export MCP_TRANSPORT_TYPE=stdio
export MCP_LOG_LEVEL=info
export OPENAI_API_KEY="sk-your-key-here"

# Run the server
bun start:stdio
```

## Environment Configuration

All instances require these key variables:

| Variable             | Description                                                | Required | Example           |
| :------------------- | :--------------------------------------------------------- | :------- | :---------------- |
| `OPENAI_API_KEY`     | OpenAI API key for commit message validation (GPT-5 Nano). | ✅ Yes   | `sk-proj-...`     |
| `MCP_TRANSPORT_TYPE` | Transport protocol for MCP communication.                  | No       | `stdio` (default) |
| `MCP_LOG_LEVEL`      | Logging verbosity (`debug`, `info`, `warn`, `error`).      | No       | `info`            |

**Important**: Never commit your `.env` file or API keys to version control. Use environment variables or secure secret management tools instead.

## Running the Server

### Local Development

- **Build and run the production version**:
  ```bash
  # One-time build
  bun rebuild

  # Run the built server
  bun start:http
  # or
  bun start:stdio
  ```

- **Run checks and tests**:
  ```bash
  bun devcheck # Lints, formats, type-checks, and more
  bun test    # Runs the test suite
  ```

### Cloudflare Workers

1. **Build the Worker bundle**:
   ```bash
   bun build:worker
   ```

2. **Run locally with Wrangler**:
   ```bash
   bun deploy:dev
   ```

3. **Deploy to Cloudflare**:
   ```bash
   bun deploy:prod
   ```

> **Note**: The `wrangler.toml` file is pre-configured with `nodejs_compat` for best results.

## FAQ

- **Does this work with both STDIO and HTTP?** Yes. Both transports are first-class citizens. Use `bun run dev:stdio` or `bun run dev:http`.
- **Can I deploy this to the edge?** Yes. Designed for Cloudflare Workers. Run `bun run build:worker` and deploy with Wrangler.
- **Do I have to use OpenTelemetry?** No, disabled by default. Enable with `OTEL_ENABLED=true`.
- **How do I publish my server to the MCP Registry?** Follow the guide in `docs/publishing-mcp-server-registry.md`.

---

See [AGENTS.md](AGENTS.md) for developer onboarding and implementation constraints.
