# NPM Publishing Guide

This guide explains how to publish the `rethunk-mcp-typescript` package to npm registry.

## Quick Overview

The project supports **two complementary publishing workflows**:

1. **Automated CI/CD via GitHub Actions** (recommended for releases)
   - Triggered on git tags matching `v*` (e.g., `v2.8.1`)
   - Automatically builds and publishes to npm
   - Requires `NPM_TOKEN` secret in GitHub repository settings

2. **Manual Publishing** (useful for testing or local releases)
   - Direct `bun publish` command
   - Requires npm authentication locally
   - Useful for dev/pre-release versions

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    PUBLISHING WORKFLOW                       │
└─────────────────────────────────────────────────────────────┘

                    OPTION A: CI/CD (Recommended)
                    ┌──────────────────────────┐
                    │                          │
                    │  git push v2.8.1 tag     │
                    │                          │
                    └───────────┬──────────────┘
                                │
                    ┌───────────▼──────────────┐
                    │  GitHub Actions          │
                    │  (publish.yml)           │
                    │                          │
                    │  1. Setup Bun            │
                    │  2. npm auth             │
                    │  3. bun install          │
                    │  4. bun run build        │
                    │  5. bun publish          │
                    └───────────┬──────────────┘
                                │
                    ┌───────────▼──────────────┐
                    │  npm Registry            │
                    │  (npmjs.org)             │
                    └──────────────────────────┘

                   OPTION B: Manual Publish
                    ┌──────────────────────────┐
                    │  Local Terminal          │
                    │                          │
                    │  npm login               │
                    │  bun run build           │
                    │  bun publish --access    │
                    │         public           │
                    └───────────┬──────────────┘
                                │
                    ┌───────────▼──────────────┐
                    │  npm Registry            │
                    │  (npmjs.org)             │
                    └──────────────────────────┘
```

## Prerequisites

### For CI/CD Publishing (GitHub Actions)

1. **NPM Account**: Create an account at [npmjs.com](https://www.npmjs.com/)
2. **NPM Token**: Generate an authentication token
   - Visit: <https://www.npmjs.com/settings/~/tokens>
   - Create a new token (use "Automation" type for CI/CD)
   - Save the token securely

3. **GitHub Secret**: Add the token to your repository
   - Go to: Settings → Secrets and variables → Actions
   - Create new secret: `NPM_TOKEN` with your token value

### For Manual Publishing (Local)

1. **Bun**: Ensure v1.2.0+ installed

   ```bash
   bun --version
   ```

2. **npm Login**: Store credentials locally

   ```bash
   npm login
   ```

   This creates `~/.npmrc` with your authentication token

## Automated CI/CD Publishing (Recommended)

### How It Works

The GitHub Actions workflow (`[.github/workflows/publish.yml](.github/workflows/publish.yml)`) triggers automatically when you create a git tag:

```bash
# Create and push a version tag
git tag v2.8.1
git push origin v2.8.1
```

**Workflow Steps:**

1. Checkout code
2. Setup Bun runtime
3. Configure npm registry authentication (via `NPM_TOKEN` secret)
4. Install dependencies with lockfile
5. Build distribution files
6. Publish to npm with `bun publish --access public`

### Prerequisites

- `package.json` version matches tag (e.g., `"version": "2.8.1"` for tag `v2.8.1`)
- `NPM_TOKEN` secret configured in GitHub repository
- `publishConfig.access` set to `"public"` in `package.json`

### Troubleshooting CI/CD Publishing

| Issue | Cause | Solution |
|-------|-------|----------|
| 404 when publishing | `NPM_TOKEN` not set | Add `NPM_TOKEN` to GitHub secrets |
| 403 Forbidden | Invalid/expired token | Regenerate token at npmjs.com |
| Tag not triggering | Wrong tag format | Use `v*` format (e.g., `v2.8.1`) |
| Version mismatch | Tag ≠ package.json | Update `package.json` version first |

## Manual Publishing (Local)

### Step 1: Verify Package Configuration

Check that `package.json` has:

```json
{
  "name": "rethunk-mcp-typescript",
  "version": "2.8.1",
  "publishConfig": {
    "access": "public"
  }
}
```

### Step 2: Authenticate with npm

```bash
npm login
```

This prompts for:

- **Username**: Your npm account username
- **Password**: Your npm account password
- **Email**: Associated email address
- **OTP** (optional): If 2FA is enabled

Credentials are stored in `~/.npmrc`.

### Step 3: Build the Package

```bash
bun run build
```

This creates the `dist/` directory with compiled JavaScript and TypeScript declarations.

### Step 4: Publish

```bash
bun publish --access public
```

Or use the standard npm command:

```bash
npm publish --access public
```

### Step 5: Verify Publication

Check that your package appears on npm:

```bash
npm view rethunk-mcp-typescript
```

Or visit: <https://www.npmjs.com/package/rethunk-mcp-typescript>

## Package Contents

The npm package includes:

```
dist/
├── index.js          # Main entry point (CJS/ESM)
├── index.d.ts        # TypeScript declarations
├── worker.ts         # Cloudflare Worker bundle
├── config/           # Configuration module
├── mcp-server/       # MCP server implementation
├── services/         # Business logic services
├── storage/          # Storage abstraction layer
├── utils/            # Shared utilities
└── ...               # Other compiled modules
```

## Version Management

### Semantic Versioning

Follow [semver.org](https://semver.org/):

- **MAJOR** (X.0.0): Breaking API changes
- **MINOR** (X.Y.0): New features, backward compatible
- **PATCH** (X.Y.Z): Bug fixes, no API changes

### Updating Version

1. Update `package.json`:

   ```json
   "version": "2.8.2"
   ```

2. For MCP Registry sync (if using `publish-mcp` script):

   ```bash
   bun run publish-mcp --sync-only
   ```

   This updates `server.json` with the new version.

3. Commit changes:

   ```bash
   git add package.json server.json
   git commit -m "chore(release): bump to v2.8.2"
   ```

4. Create tag and push:

   ```bash
   git tag v2.8.2
   git push origin v2.8.2
   ```

## NPM Registry vs MCP Registry

This project publishes to **two registries**:

| Registry | Purpose | Tool | Trigger |
|----------|---------|------|---------|
| **npm** | General package distribution | `bun publish` | Git tag `v*` |
| **MCP** | MCP server registry | `mcp-publisher` | Manual `bun run publish-mcp` |

Both publishes are independent:

- Update package version → triggers npm CI/CD
- Run `publish-mcp` → syncs to MCP Registry

See [publishing-mcp-server-registry.md](publishing-mcp-server-registry.md) for MCP Registry details.

## Files Involved in Publishing

| File | Purpose |
|------|---------|
| `[package.json](../package.json)` | Package metadata, version, scripts |
| `[.github/workflows/publish.yml](.github/workflows/publish.yml)` | CI/CD workflow definition |
| `[server.json](../server.json)` | MCP Registry metadata (separate) |
| `[src/index.ts](../src/index.ts)` | Entry point for distribution |
| `[tsconfig.json](../tsconfig.json)` | TypeScript compilation config |

## Best Practices

1. **Always update version before tagging**

   ```bash
   # ✅ Good
   npm version patch  # Updates package.json + creates tag
   git push --tags

   # ❌ Bad
   git tag v2.8.2     # Mismatch with package.json
   git push --tags
   ```

2. **Verify build before publishing**

   ```bash
   bun run build
   ls -la dist/
   ```

3. **Test locally if unsure**

   ```bash
   npm publish --dry-run
   ```

4. **Keep credentials secure**
   - Never commit tokens to git
   - Use GitHub Secrets for CI/CD
   - Rotate tokens periodically

5. **Monitor npm package page**
   - Verify package appears within 1-2 minutes
   - Check that types are included
   - Confirm tarball contains `dist/`

## Troubleshooting

### "You must be logged in to publish"

**Solution**: Run `npm login` or check `~/.npmrc` exists

```bash
cat ~/.npmrc
npm login
```

### "no dist/ directory"

**Solution**: Build first

```bash
bun run build
```

### "Cannot find main entry point"

**Solution**: Check `package.json` entry points:

```json
{
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

### Version already published

**Solution**: Choose a new version number or use pre-release tags

```bash
npm publish --tag beta   # Publishes as@latest-beta
```

## Next Steps

- See [publishing-mcp-server-registry.md](publishing-mcp-server-registry.md) for MCP Registry publishing
- See [README.md](../README.md) for package documentation
- See [package.json](../package.json) for current version
