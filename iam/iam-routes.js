import {Permission} from '../shared/authorization.js';
import {createRouteTable} from '../shared/route-table.js';
import {bodyOf} from '../shared/validation.js';

const LOCATION_PREFIX = '/api/v1/iam';

/**
 * Identity and Access Management endpoints, mounted at `/api/v1/iam`.
 *
 * | Method | Path | Permission |
 * | --- | --- | --- |
 * | POST | /sign-in | public |
 * | POST | /sign-up | public |
 * | POST | /sign-out | any authenticated user |
 * | GET, PUT | /profile | any authenticated user |
 * | GET, POST | /users | MANAGE_USERS |
 * | GET, PUT | /users/:id | MANAGE_USERS |
 * | PUT | /users/:id/role | MANAGE_USERS |
 *
 * @param {import('./iam-service.js').IamService} iam
 * @returns {import('express').RequestHandler}
 */
export function createIamRoutes(iam) {
    return createRouteTable([
        {
            method: 'POST', path: '/sign-in',
            handler: async (request, response) => {
                response.status(200).json(await iam.signIn(bodyOf(request)));
            }
        },
        {
            method: 'POST', path: '/sign-up',
            handler: async (request, response) => {
                const user = await iam.signUp(bodyOf(request));
                response.setHeader('Location', `${LOCATION_PREFIX}/users/${user.id}`);
                response.setHeader('Access-Control-Expose-Headers', 'Location');
                response.status(201).json(user);
            }
        },
        {
            method: 'POST', path: '/sign-out',
            handler: async (request, response) => {
                const {token} = iam.authenticate(request);
                iam.signOut(token);
                response.status(204).end();
            }
        },
        {
            method: 'GET', path: '/profile',
            handler: async (request, response) => {
                const {user} = iam.authenticate(request);
                response.status(200).json(iam.toResource(user));
            }
        },
        {
            method: 'PUT', path: '/profile',
            handler: async (request, response) => {
                const {user} = iam.authenticate(request);
                response.status(200).json(iam.updateOwnProfile(user, bodyOf(request)));
            }
        },
        {
            method: 'GET', path: '/users',
            handler: async (request, response) => {
                iam.authorize(request, Permission.MANAGE_USERS);
                response.status(200).json(iam.listUsers());
            }
        },
        {
            method: 'POST', path: '/users',
            handler: async (request, response) => {
                iam.authorize(request, Permission.MANAGE_USERS);
                const user = await iam.createUser(bodyOf(request));
                response.setHeader('Location', `${LOCATION_PREFIX}/users/${user.id}`);
                response.setHeader('Access-Control-Expose-Headers', 'Location');
                response.status(201).json(user);
            }
        },
        {
            method: 'GET', path: '/users/:id',
            handler: async (request, response, {id}) => {
                iam.authorize(request, Permission.MANAGE_USERS);
                response.status(200).json(iam.getUser(id));
            }
        },
        {
            method: 'PUT', path: '/users/:id',
            handler: async (request, response, {id}) => {
                iam.authorize(request, Permission.MANAGE_USERS);
                response.status(200).json(iam.updateUser(id, bodyOf(request)));
            }
        },
        {
            method: 'PUT', path: '/users/:id/role',
            handler: async (request, response, {id}) => {
                iam.authorize(request, Permission.MANAGE_USERS);
                response.status(200).json(iam.assignRole(id, bodyOf(request)));
            }
        }
    ]);
}
