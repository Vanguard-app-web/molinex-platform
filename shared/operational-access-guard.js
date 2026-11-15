import {ApiError, sendError} from './api-error.js';
import {Permission} from './authorization.js';

/**
 * Permission required to change each JSON Server collection. Reading any of them requires
 * VIEW_OPERATIONAL_INFORMATION. The assignment follows the C4 relationships: the production
 * operator records production, quality and waste information; the maintenance technician
 * manages machines and maintenance work.
 */
export const operationalResourcePermissions = Object.freeze({
    'raw-material-receptions': Permission.MANAGE_PRODUCTION,
    'production-batches': Permission.MANAGE_PRODUCTION,
    'production-records': Permission.MANAGE_PRODUCTION,
    'quality-assessments': Permission.MANAGE_PRODUCTION,
    'waste-records': Permission.MANAGE_PRODUCTION,
    machines: Permission.MANAGE_MAINTENANCE,
    'maintenance-records': Permission.MANAGE_MAINTENANCE
});

const READ_METHODS = new Set(['GET', 'HEAD']);
const API_PREFIX = /^\/api\/v1(?=\/|$)/;

/**
 * Express middleware placed in front of the JSON Server router. Only the operational collections
 * reach the router, always behind a bearer token and the matching permission. Every other path
 * (including `/db`, which would dump the whole database, and names such as `/users` or
 * `/commercial-inquiries`) answers 404. It protects the prefixed and the unprefixed form of each
 * path, because the router is reachable through both.
 *
 * @param {import('../iam/iam-service.js').IamService} iam
 * @returns {import('express').RequestHandler}
 */
export function operationalAccessGuard(iam) {
    return (request, response, next) => {
        if (request.method === 'OPTIONS') return next();

        const segments = request.path.replace(API_PREFIX, '').split('/').filter(Boolean);
        const managePermission = Object.hasOwn(operationalResourcePermissions, segments[0])
            ? operationalResourcePermissions[segments[0]]
            : undefined;
        if (!managePermission) return sendError(response, ApiError.notFound());

        try {
            iam.authorize(request, READ_METHODS.has(request.method) ? Permission.VIEW_OPERATIONAL_INFORMATION : managePermission);
        } catch (error) {
            if (error instanceof ApiError) return sendError(response, error);
            return next(error);
        }
        return next();
    };
}
