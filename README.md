<div align="center">
  <h1>Rethunk MCP for TypeScript</h1>
  <p><b>A production-grade Model Context Protocol (MCP) server featuring TypeScript code inspection, atomic git commits with intelligent message validation, and robust support for building scalable MCP applications.</b></p>
  <div>2 Tools • 0 Resources • 1 Prompt</div>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-2.8.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![MCP Spec](https://img.shields.io/badge/MCP%20Spec-2025--11--25-8A2BE2.svg?style=flat-square)](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/changelog.mdx) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.26.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Status](https://img.shields.io/badge/Status-Stable-brightgreen.svg?style=flat-square)](https://github.com/Rethunk-AI/rethunk-mcp-ts/issues) [![TypeScript](https://img.shields.io/badge/TypeScript-^5.9.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.2.21-blueviolet.svg?style=flat-square)](https://bun.sh/) [![Tests](https://img.shields.io/badge/Tests-2233_passed-green.svg?style=flat-square)](./vitest.config.ts)

</div>

---

## ✨ Features

- **Declarative Tools & Resources**: Define capabilities in single, self-contained files
- **Elicitation Support**: Tools can interactively prompt for missing parameters
- **Robust Error Handling**: Unified `McpError` system for consistent responses
- **Pluggable Authentication**: Zero-fuss support for `none`, `jwt`, or `oauth` modes
- **Abstracted Storage**: Swap backends (in-memory, filesystem, Supabase, SurrealDB, Cloudflare) without code changes
- **Full-Stack Observability**: Structured logging (Pino) and OpenTelemetry instrumentation
- **Dependency Injection**: Built with `tsyringe` for clean, testable architecture
- **Edge-Ready**: Write once, run locally or on Cloudflare Workers

## 🚀 Getting Started

- **Setup & Installation:** See [HUMANS.md](HUMANS.md)
- **Development & Architecture:** See [AGENTS.md](AGENTS.md)
- **Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security:** See [SECURITY.md](SECURITY.md)
- **Changes:** See [CHANGELOG.md](CHANGELOG.md)

## 📜 License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.

---

<div align="center">
  <p>
    <a href="https://rethunk.ai/">Visit Rethunk.Tech</a> •
    <a href="https://github.com/Rethunk-AI/rethunk-mcp-ts/issues">Report an Issue</a>
  </p>
</div>
