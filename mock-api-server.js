import fs from 'node:fs';
import jsonServer from 'json-server';
import {createCommercialRoutes} from './commercial-engagement/commercial-routes.js';
import {CommercialService, ensureCommercialData, loadCommercialContent} from './commercial-engagement/commercial-service.js';
import {createIamRoutes} from './iam/iam-routes.js';
import {IamService, ensureIamData} from './iam/iam-service.js';
import {SessionService} from './iam/session-service.js';
import {errorHandler} from './shared/api-error.js';
import {operationalAccessGuard} from './shared/operational-access-guard.js';
import {PrivateDataStore} from './shared/private-data-store.js';

const emptyDatabase = () => ({
    'raw-material-receptions': [],
    'production-batches': [],
    'production-records': [],
    'quality-assessments': [],
    'waste-records': [],
    machines: [],
    'maintenance-records': []
});

/**
 * Hosts the deployable JSON Server adapter used by Molinex demonstrations.
 *
 * JSON Server only serves the operational collections of the database file, always behind a bearer
 * token. Identity and Access Management and Commercial Engagement are custom handlers whose data
 * lives in a separate private file, so the generic CRUD routes can never reach it.
 */
export class MockApiServer {
    #config;
    #app;

    /**
     * @param {import('./mock-api-server-config.js').MockApiServerConfig} config
     */
    constructor(config) {
        this.#config = config;
        this.#ensureDatabaseFile();
        this.#app = this.#buildApp();
    }

    /**
     * Starts listening on the port supplied by the runtime environment.
     * @returns {import('node:http').Server}
     */
    start() {
        return this.#app.listen(this.#config.port, () => {
            const host = process.env.WEBSITE_HOSTNAME
                ? `https://${process.env.WEBSITE_HOSTNAME}`
                : `http://localhost:${this.#config.port}`;
            console.log(`Molinex Mock API running on ${host}`);
        });
    }

    #ensureDatabaseFile() {
        if (!fs.existsSync(this.#config.dbPath)) {
            fs.writeFileSync(this.#config.dbPath, JSON.stringify(emptyDatabase(), null, 2));
        }
    }

    #buildPrivateServices() {
        const store = new PrivateDataStore(this.#config.privateDataPath, () => ({}));
        const iamChanged = ensureIamData(store.data);
        const commercialChanged = ensureCommercialData(store.data);
        if (iamChanged || commercialChanged) store.commit();

        const iam = new IamService(store, new SessionService(store));
        const commercial = new CommercialService(store, loadCommercialContent(this.#config.commercialContentPath));
        return {iam, commercial};
    }

    #buildApp() {
        const app = jsonServer.create();
        const router = jsonServer.router(this.#config.dbPath);
        const {iam, commercial} = this.#buildPrivateServices();

        app.get('/', (_request, response) => response.json({
            name: 'Molinex Mock API',
            version: '0.1.0',
            resources: Object.keys(this.#resourceState(router))
        }));
        app.get('/api/v1/health', (_request, response) => response.json({
            status: 'ok',
            time: new Date().toISOString()
        }));

        app.use(jsonServer.defaults());
        app.use(jsonServer.bodyParser);
        app.use('/api/v1/iam', createIamRoutes(iam));
        app.use('/api/v1/commercial', createCommercialRoutes(commercial));
        app.use(operationalAccessGuard(iam));
        app.use(jsonServer.rewriter({
            '/api/v1/*': '/$1'
        }));
        app.use(router);
        app.use(errorHandler);

        return app;
    }

    #resourceState(router) {
        return typeof router.db.getState === 'function'
            ? router.db.getState()
            : router.db.data;
    }
}
