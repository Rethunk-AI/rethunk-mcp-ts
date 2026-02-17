/**
 * @fileoverview Predefined scope configurations for common authentication scenarios.
 * Provides templates for user authentication, API access, and admin scopes.
 * @module src/storage/providers/surrealdb/auth/scopeDefinitions
 */

import type {
  JwtAccessConfig,
  JwtAlgorithm,
  RecordAccessConfig,
} from './authManager.js'

/**
 * Predefined scope configurations for common use cases.
 */
export const ScopeDefinitions = {
  /**
   * Create a JWT access configuration for API authentication.
   *
   * @param secret - JWT signing secret
   * @param name - Access method name (default: 'api_access')
   * @param algorithm - JWT algorithm (default: HS512)
   * @returns JWT access configuration
   *
   * @example
   * ```ts
   * const apiAccess = ScopeDefinitions.apiJwt(process.env.JWT_SECRET!, 'api_access');
   * await authManager.configureJwt(apiAccess, context);
   * ```
   */
  apiJwt(
    secret: string,
    name = 'api_access',
    algorithm: JwtAlgorithm = 'HS512',
  ): JwtAccessConfig {
    return {
      name,
      algorithm,
      key: secret,
    }
  },

  /**
   * Create a JWT access configuration with issuer/audience validation.
   *
   * @param name - Access method name
   * @param secret - JWT signing secret
   * @param issuer - Token issuer URL
   * @param audience - Token audience
   * @param algorithm - JWT algorithm (default: HS512)
   * @returns JWT access configuration
   *
   * @example
   * ```ts
   * const validatedAccess = ScopeDefinitions.validatedJwt(
   *   'validated_api',
   *   secret,
   *   'https://myapp.com',
   *   'api'
   * );
   * ```
   */
  validatedJwt(
    name: string,
    secret: string,
    issuer: string,
    audience: string,
    algorithm: JwtAlgorithm = 'HS512',
  ): JwtAccessConfig {
    return {
      name,
      algorithm,
      key: secret,
      issuer,
      audience,
    }
  },

  /**
   * Create a JWT access configuration using JWKS for third-party auth providers.
   *
   * @param name - Access method name
   * @param jwksUrl - JWKS endpoint URL (e.g., Auth0, Okta)
   * @param issuer - Expected token issuer
   * @param audience - Expected token audience
   * @param algorithm - JWT algorithm (default: RS256 for JWKS)
   * @returns JWT access configuration
   *
   * @example
   * ```ts
   * const auth0Access = ScopeDefinitions.jwksAuth(
   *   'auth0_access',
   *   'https://myapp.auth0.com/.well-known/jwks.json',
   *   'https://myapp.auth0.com/',
   *   'api'
   * );
   * ```
   */
  jwksAuth(
    name: string,
    jwksUrl: string,
    issuer: string,
    audience: string,
    algorithm: JwtAlgorithm = 'RS256',
  ): JwtAccessConfig {
    return {
      name,
      algorithm,
      key: '', // Not used with JWKS
      jwksUrl,
      issuer,
      audience,
    }
  },

  /**
   * Create a record access configuration for standard user authentication.
   *
   * @param jwtSecret - JWT secret for session tokens
   * @param name - Access method name (default: 'user_access')
   * @param table - User table name (default: 'user')
   * @param duration - Token duration (default: '24h')
   * @param algorithm - JWT algorithm (default: 'HS512')
   * @returns Record access configuration
   *
   * @example
   * ```ts
   * const userAccess = ScopeDefinitions.userAuth(secret, 'user_access', 'user');
   * await authManager.configureRecord(userAccess, context);
   * ```
   */
  userAuth(
    jwtSecret: string,
    name = 'user_access',
    table = 'user',
    duration = '24h',
    algorithm: JwtAlgorithm = 'HS512',
  ): RecordAccessConfig {
    return {
      name,
      table,
      usernameField: 'email',
      passwordField: 'password',
      jwt: {
        algorithm,
        key: jwtSecret,
        duration,
      },
    }
  },

  /**
   * Create a record access configuration with custom signin/signup queries.
   *
   * @param name - Access method name
   * @param table - User table name
   * @param signinQuery - Custom signin query
   * @param signupQuery - Custom signup query
   * @param jwtSecret - JWT secret for session tokens
   * @returns Record access configuration
   *
   * @example
   * ```ts
   * const customAccess = ScopeDefinitions.customRecordAuth(
   *   'custom_user',
   *   'user',
   *   'SELECT * FROM user WHERE email = $email AND active = true...',
   *   'CREATE user SET email = $email, password = crypto::argon2::generate($password)...',
   *   secret
   * );
   * ```
   */
  customRecordAuth(
    name: string,
    table: string,
    signinQuery: string,
    signupQuery: string,
    jwtSecret: string,
  ): RecordAccessConfig {
    return {
      name,
      table,
      usernameField: 'email', // Still required even with custom queries
      passwordField: 'password',
      signinQuery,
      signupQuery,
      jwt: {
        algorithm: 'HS512',
        key: jwtSecret,
        duration: '24h',
      },
    }
  },

  /**
   * Create an admin-level record access with extended duration.
   *
   * @param jwtSecret - JWT secret
   * @param name - Access method name (default: 'admin_access')
   * @param table - Admin table name (default: 'admin')
   * @param duration - Token duration (default: '7d')
   * @returns Record access configuration
   */
  adminAuth(
    jwtSecret: string,
    name = 'admin_access',
    table = 'admin',
    duration = '7d',
  ): RecordAccessConfig {
    return {
      name,
      table,
      usernameField: 'username',
      passwordField: 'password',
      jwt: {
        algorithm: 'HS512',
        key: jwtSecret,
        duration,
      },
    }
  },
}

/**
 * Common permission patterns for database access control.
 */
export const PermissionPatterns = {
  /**
   * Generate a WHERE clause for tenant-scoped access.
   *
   * @param tokenVar - Variable containing the token (default: $token)
   * @param tenantField - Field name for tenant ID (default: tenant_id)
   * @returns SurrealQL WHERE clause
   *
   * @example
   * ```surql
   * FOR select WHERE tenant_id = $token.tid
   * FOR create WHERE tenant_id = $token.tid
   * ```
   */
  tenantScoped(tokenVar = '$token', tenantField = 'tenant_id'): string {
    return `${tenantField} = ${tokenVar}.tid`
  },

  /**
   * Generate a WHERE clause for owner-only access.
   *
   * @param tokenVar - Variable containing the token (default: $token)
   * @param ownerField - Field name for owner ID (default: owner)
   * @returns SurrealQL WHERE clause
   *
   * @example
   * ```surql
   * FOR select WHERE owner = $token.sub
   * FOR update WHERE owner = $token.sub
   * ```
   */
  ownerOnly(tokenVar = '$token', ownerField = 'owner'): string {
    return `${ownerField} = ${tokenVar}.sub`
  },

  /**
   * Generate a WHERE clause for role-based access.
   *
   * @param roles - Array of allowed roles
   * @param tokenVar - Variable containing the token (default: $token)
   * @returns SurrealQL WHERE clause
   *
   * @example
   * ```surql
   * FOR delete WHERE $token.role INSIDE ['admin', 'moderator']
   * ```
   */
  roleBasedAccess(roles: string[], tokenVar = '$token'): string {
    const roleList = roles.map((r) => `'${r}'`).join(', ')
    return `${tokenVar}.role INSIDE [${roleList}]`
  },

  /**
   * Generate a WHERE clause combining tenant and owner access.
   *
   * @param tokenVar - Variable containing the token (default: $token)
   * @param tenantField - Field name for tenant ID
   * @param ownerField - Field name for owner ID
   * @returns SurrealQL WHERE clause
   */
  tenantAndOwner(
    tokenVar = '$token',
    tenantField = 'tenant_id',
    ownerField = 'owner',
  ): string {
    return `${tenantField} = ${tokenVar}.tid AND ${ownerField} = ${tokenVar}.sub`
  },
}
