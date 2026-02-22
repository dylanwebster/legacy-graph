// src/schemas/AuthSchema.ts
import { z } from 'zod';

// A single user entry in /_meta/auth.yaml
export const AuthUserSchema = z.object({
    username: z.string().min(1),
    password_hash: z.string().min(1), // BCrypt hash
});

// The auth config file structure
export const AuthConfigSchema = z.object({
    jwt_secret: z.string().min(32),  // Secret for signing JWTs
    session_expiry: z.string().default('24h'), // JWT expiry duration
    users: z.array(AuthUserSchema).min(1),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
