import { FastifyInstance } from 'fastify';
import { authenticateUser, issueToken } from '../middleware/auth';
import type { AppInstance } from '../types';

export async function authRoutes(server: FastifyInstance) {
    const { authConfig } = (server as AppInstance).appServices;

    server.post<{
        Body: { username?: string; password?: string }
    }>('/api/auth/login', async (request, reply) => {
        const { username, password } = request.body || {};

        if (!username || !password) {
            return reply.status(400).send({
                error: 'Username and password are required',
                code: 'MISSING_CREDENTIALS'
            });
        }

        if (!authConfig) {
            return reply.status(500).send({
                error: 'Authentication is not configured',
                code: 'AUTH_NOT_CONFIGURED'
            });
        }

        const authenticatedUser = await authenticateUser(authConfig, username, password);
        if (!authenticatedUser) {
            return reply.status(401).send({
                error: 'Invalid username or password',
                code: 'INVALID_CREDENTIALS'
            });
        }

        const token = issueToken(authConfig, authenticatedUser);

        reply.setCookie('token', token, {
            httpOnly: true,
            path: '/',
            sameSite: 'strict',
            secure: false
        });

        return { message: 'Login successful', username: authenticatedUser };
    });

    server.post('/api/auth/logout', async (_request, reply) => {
        reply.clearCookie('token', {
            path: '/',
            httpOnly: true,
            sameSite: 'strict',
            secure: false
        });

        return { message: 'Logout successful' };
    });
}
