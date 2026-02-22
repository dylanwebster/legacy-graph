import { FastifyInstance } from 'fastify';
import { GraphEngine } from '../core/GraphEngine';
import { TransactionManager } from '../core/TransactionManager';
import { AuthConfig } from '../schemas/AuthSchema';

export interface AppServices {
    graphEngine: GraphEngine;
    txManager: TransactionManager;
    authConfig: AuthConfig | null;
    dataDir: string;
}

export type AppInstance = FastifyInstance & {
    appServices: AppServices;
};
