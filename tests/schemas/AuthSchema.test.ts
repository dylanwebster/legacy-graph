import { describe, it, expect } from 'vitest';
import { AuthConfigSchema, AuthUserSchema } from '../../src/schemas/AuthSchema';

describe('AuthSchema', () => {
    it('should validate a correct auth config', () => {
        const config = {
            jwt_secret: 'a-very-long-secret-key-that-is-at-least-32-chars',
            session_expiry: '24h',
            users: [
                { username: 'admin', password_hash: '$2a$10$somevalidhash' }
            ]
        };
        const result = AuthConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
    });

    it('should reject jwt_secret shorter than 32 characters', () => {
        const config = {
            jwt_secret: 'short',
            session_expiry: '24h',
            users: [
                { username: 'admin', password_hash: '$2a$10$somevalidhash' }
            ]
        };
        const result = AuthConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
    });

    it('should reject empty users array', () => {
        const config = {
            jwt_secret: 'a-very-long-secret-key-that-is-at-least-32-chars',
            session_expiry: '24h',
            users: []
        };
        const result = AuthConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
    });

    it('should reject user with empty username', () => {
        const user = { username: '', password_hash: '$2a$10$somevalidhash' };
        const result = AuthUserSchema.safeParse(user);
        expect(result.success).toBe(false);
    });

    it('should default session_expiry to 24h', () => {
        const config = {
            jwt_secret: 'a-very-long-secret-key-that-is-at-least-32-chars',
            users: [
                { username: 'admin', password_hash: '$2a$10$somevalidhash' }
            ]
        };
        const result = AuthConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.session_expiry).toBe('24h');
        }
    });
});
