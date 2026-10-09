import fs from 'node:fs';
import jsonServer from 'json-server';

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
     * @returns {void}
     */
    start() {
        this.#app.listen(this.#config.port, () => {
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

    #buildApp() {
        const app = jsonServer.create();
        const router = jsonServer.router(this.#config.dbPath);

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
        app.use(jsonServer.rewriter({
            '/api/v1/*': '/$1'
        }));
        app.use(router);

        return app;
    }

    #resourceState(router) {
        return typeof router.db.getState === 'function'
            ? router.db.getState()
            : router.db.data;
    }
}
