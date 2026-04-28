# Security Policy

## Reporting Security Vulnerabilities

**DO NOT** open a public GitHub issue for security vulnerabilities. Instead, please report them responsibly to:

**Email:** security@rethunk.tech  
**Response SLA:** We aim to respond to security reports within 24 hours.

When reporting a vulnerability, please include:
- Description of the vulnerability
- Affected component(s) and version(s)
- Steps to reproduce (if applicable)
- Potential impact
- Suggested fix (optional)

## Supported Versions

The following versions of rethunk-mcp-ts are currently supported with security updates:

| Version | Release Date | Support Status | End of Support |
|---------|--------------|---|---|
| 2.8.x | April 2026 | Active | April 2027 |
| 2.7.x | March 2026 | LTS | March 2028 |

Only the current major version and previous LTS version receive security patches. Users are encouraged to upgrade to the latest version.

## Security Practices

### Dependency Management

- Dependencies are regularly audited via `npm audit` and `bun audit`
- Critical and high-severity vulnerabilities are patched immediately
- CI/CD pipeline includes automated dependency scanning
- Sensitive credentials (API keys, auth tokens) are never committed to version control

### Code Security

- All code changes go through peer review
- TypeScript strict mode enforced throughout codebase
- ESLint and linting rules prevent common security anti-patterns
- Input validation implemented at all API boundaries

### Storage & Authentication

- Storage layer abstracts implementation details, preventing accidental credential exposure
- Authentication modes (`none`, `jwt`, `oauth`) are configurable and pluggable
- Auth middleware validates all requests before processing
- No sensitive data logged; logging respects privacy requirements

### Cryptography

- OpenAI API keys and other secrets handled via environment variables
- Tokens never logged or exposed in error messages
- HTTPS enforced for all external API communication

### Testing & Validation

- Comprehensive test suite with 2233+ passing tests validates security properties
- Unit tests for auth, storage, and service integrations
- Integration tests validate end-to-end security flows

## Known Vulnerabilities

None currently known. Reports are welcome via security@rethunk.tech.

## Third-Party Security

### Dependencies

This project depends on key libraries with strong security records:
- **Vercel AI SDK** - Validated message generation with GPT model integration
- **tsyringe** - Dependency injection for clean architecture
- **Pino** - Structured logging with security-aware defaults
- **MCP SDK** - Official SDK with security best practices

### Transitive Dependencies

- Dependency lock files (`bun.lock`) ensure reproducible builds
- Vulnerable transitive dependencies are resolved via overrides
- Regular dependency audits identify supply-chain risks

## OpenTelemetry & Observability

- Optional OpenTelemetry instrumentation provides visibility without exposing secrets
- Traces and metrics redact sensitive information
- Logging respects PII and credential masking

## Deployment Security

### Edge Deployment (Cloudflare Workers)

- Code runs in Cloudflare's isolated worker environment
- Environment variables stored in Cloudflare secrets manager
- No direct filesystem access (uses abstracted storage)
- Rate limiting and DDoS protection built-in

### Self-Hosted Deployment

- Follow principle of least privilege for service accounts
- Restrict network access to MCP server endpoints
- Use environment-specific configuration files
- Enable audit logging for all operations

## Incident Response

In the event of a confirmed security vulnerability:
1. Impact assessment and triage
2. Fix development in private branch
3. Security update release with advisory
4. Public disclosure (after patch availability)
5. Post-incident review and lessons learned

## Security Contact

- **Security Issues:** security@rethunk.tech
- **General Support:** support@rethunk.tech
- **Website:** https://rethunk.tech

---

**Last updated:** 2026-04-27
