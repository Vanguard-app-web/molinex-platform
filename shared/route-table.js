import {ApiError, sendError} from './api-error.js';

/**
 * Compiles a path pattern such as `/users/:id/role` into a matcher.
 * @param {string} pattern
 */
function compile(pattern) {
    const names = [];
    const source = pattern
        .split('/')
        .map(segment => {
            if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            names.push(segment.slice(1));
            return '([^/]+)';
        })
        .join('/');
    return {regex: new RegExp(`^${source}/?$`), names};
}

/**
 * Builds an Express middleware that dispatches the requests of one namespace (mounted with
 * `app.use(prefix, middleware)`) to async handlers. Unknown paths answer 404 and known paths with
 * another method answer 405, always in the common error format.
 *
 * @param {{method: string, path: string, handler: (request, response, parameters: Record<string, string>) => Promise<void>}[]} routes
 * @returns {import('express').RequestHandler}
 */
export function createRouteTable(routes) {
    const compiled = routes.map(route => ({...route, ...compile(route.path)}));

    return async (request, response, next) => {
        try {
            const matches = compiled.filter(route => route.regex.test(request.path));
            if (matches.length === 0) throw ApiError.notFound();

            const route = matches.find(candidate => candidate.method === request.method)
                ?? (request.method === 'HEAD' ? matches.find(candidate => candidate.method === 'GET') : undefined);
            if (!route) {
                if (request.method === 'OPTIONS') return next();
                throw ApiError.methodNotAllowed([...new Set(matches.map(candidate => candidate.method))]);
            }

            const values = route.regex.exec(request.path).slice(1);
            let parameters;
            try {
                parameters = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(values[index])]));
            } catch {
                throw ApiError.notFound();
            }
            await route.handler(request, response, parameters);
        } catch (error) {
            if (error instanceof ApiError) return sendError(response, error);
            return next(error);
        }
    };
}
