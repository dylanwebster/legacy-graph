import { FastifyInstance } from 'fastify';
import { GraphEngine } from '../core/GraphEngine';
import { TransactionManager } from '../core/TransactionManager';
import { AuthConfig } from '../schemas/AuthSchema';
import type { GeocodingService } from '../core/GeocodingService';

export interface AppServices {
    graphEngine: GraphEngine;
    txManager: TransactionManager;
    authConfig: AuthConfig | null;
    dataDir: string;
    geocodingService: GeocodingService;
}

export type AppInstance = FastifyInstance & {
    appServices: AppServices;
};
