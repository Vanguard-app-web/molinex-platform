import {randomBytes, randomUUID} from 'node:crypto';
import {ApiError} from '../shared/api-error.js';
import {
    AccountStatus,
    DEFAULT_SIGN_UP_ROLE,
    isRoleType,
    permissionsOf,
    roleAllows,
    RoleType
} from '../shared/authorization.js';
import {FieldProblems, isNonBlankString, normalizeEmail} from '../shared/validation.js';
import {demoAccounts} from './demo-accounts.js';
import {hashPassword, hashPasswordSync, verifyPassword} from './password-hasher.js';

export const MAX_NAME_LENGTH = 100;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Adds the `iam` section (users and sessions) to a private data document, seeding the demo
 * accounts the first time. Returns true when the document changed.
 * @param {object} data
 */
export function ensureIamData(data) {
    if (data.iam?.users && data.iam?.sessions) return false;
    const now = new Date().toISOString();
    data.iam = {
        users: demoAccounts.map(account => ({
            id: account.id,
            email: account.email,
            fullName: account.fullName,
            jobTitle: account.jobTitle,
            phoneNumber: account.phoneNumber,
            role: account.role,
            status: account.status,
            password: hashPasswordSync(account.password),
            createdAt: now,
            updatedAt: now
        })),
        sessions: []
    };
    return true;
}

/** True when both lists hold exactly the same items, in any order. */
const sameMembers = (first, second) =>
    Array.isArray(first) && first.length === second.length && second.every(item => first.includes(item));

/**
 * Application service of Identity and Access Management in the mock API. It enforces the same
 * rules the real service is expected to enforce: credential checks, account states, privilege
 * protection and permission-based authorization. Passwords are only ever handled as scrypt hashes.
 */
export class IamService {
    #store;
    #sessions;
    #dummyPassword = hashPasswordSync(randomBytes(12).toString('hex'));

    /**
     * @param {import('../shared/private-data-store.js').PrivateDataStore} store
     * @param {import('./session-service.js').SessionService} sessions
     */
    constructor(store, sessions) {
        this.#store = store;
        this.#sessions = sessions;
    }

    get #users() {
        return this.#store.data.iam.users;
    }

    /** Public projection of a stored user: never includes the password record. */
    toResource(user) {
        return {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            jobTitle: user.jobTitle ?? '',
            phoneNumber: user.phoneNumber ?? '',
            role: user.role,
            permissions: permissionsOf(user.role),
            status: user.status
        };
    }

    // ---- Authentication ------------------------------------------------------------------

    /**
     * Authenticates the bearer token of a request.
     * @returns {{user: object, token: string}}
     * @throws {ApiError} 401 when the token is absent, malformed, unknown, expired or revoked.
     */
    authenticate(request) {
        const header = request.get('Authorization');
        if (!header) throw ApiError.authenticationRequired();
        const [scheme, token, ...rest] = header.trim().split(/\s+/);
        if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) throw ApiError.invalidToken();

        const session = this.#sessions.resolve(token);
        const user = session ? this.#users.find(candidate => candidate.id === session.userId) : undefined;
        if (!user || user.status !== AccountStatus.ACTIVE) throw ApiError.invalidToken();
        return {user, token};
    }

    /**
     * Authenticates the request and checks that the user's role grants the permission.
     * @throws {ApiError} 401 or 403.
     */
    authorize(request, permission) {
        const context = this.authenticate(request);
        if (!roleAllows(context.user.role, permission)) {
            throw ApiError.forbidden(`The permission ${permission} is required.`);
        }
        return context;
    }

    async signIn(body) {
        const problems = new FieldProblems();
        if (!isNonBlankString(body.email)) problems.add('email', 'REQUIRED');
        if (typeof body.password !== 'string' || body.password.length === 0) problems.add('password', 'REQUIRED');
        if (problems.hasProblems) throw ApiError.validation(problems.list);

        const user = this.#users.find(candidate => candidate.email === normalizeEmail(body.email));
        // A dummy hash is verified for unknown emails so response time does not reveal them.
        const passwordMatches = await verifyPassword(body.password, user ? user.password : this.#dummyPassword);
        if (!user || !passwordMatches) {
            throw new ApiError(401, 'INVALID_CREDENTIALS', 'The email address or the password is incorrect.');
        }
        if (user.status === AccountStatus.INACTIVE) {
            throw new ApiError(403, 'ACCOUNT_INACTIVE', 'The account is inactive and cannot sign in.');
        }
        if (user.status === AccountStatus.LOCKED) {
            throw new ApiError(403, 'ACCOUNT_LOCKED', 'The account is locked and cannot sign in.');
        }

        const {token} = this.#sessions.issue(user.id);
        return {
            userId: user.id,
            token,
            role: user.role,
            permissions: permissionsOf(user.role)
        };
    }

    signOut(token) {
        this.#sessions.revoke(token);
    }

    // ---- Registration and user administration --------------------------------------------

    /** Public registration. The account always gets the default role and an ACTIVE status. */
    async signUp(body) {
        this.#assertNoPrivilegeRequest(body, {
            role: DEFAULT_SIGN_UP_ROLE,
            status: AccountStatus.ACTIVE,
            permissions: permissionsOf(DEFAULT_SIGN_UP_ROLE)
        });
        const problems = this.#validateNewUser(body);
        if (problems.hasProblems) throw ApiError.validation(problems.list);
        return this.#insertUser(body, DEFAULT_SIGN_UP_ROLE);
    }

    /** Registration of a user by an administrator, who also chooses the role. */
    async createUser(body) {
        const problems = this.#validateNewUser(body);
        if (!isRoleType(body.role)) problems.add('role', body.role === undefined ? 'REQUIRED' : 'INVALID_VALUE');
        if (problems.hasProblems) throw ApiError.validation(problems.list);
        return this.#insertUser(body, body.role);
    }

    listUsers() {
        return this.#users.map(user => this.toResource(user));
    }

    getUser(id) {
        return this.toResource(this.#userOrThrow(id));
    }

    /** Administrator update of another user's profile fields. Privileged fields are immutable here. */
    updateUser(id, body) {
        const user = this.#userOrThrow(id);
        const problems = this.#validateProfile(body);
        this.#assertImmutable(body, user, ['id', 'email', 'role', 'permissions', 'status']);
        if (problems.hasProblems) throw ApiError.validation(problems.list);
        return this.#applyProfile(user, body);
    }

    assignRole(id, body) {
        const user = this.#userOrThrow(id);
        if (!isRoleType(body.role)) {
            throw ApiError.validation([{field: 'role', code: body.role === undefined ? 'REQUIRED' : 'INVALID_VALUE'}]);
        }
        if (user.role === RoleType.ADMINISTRATOR && body.role !== RoleType.ADMINISTRATOR && this.#isLastActiveAdministrator(user)) {
            throw ApiError.conflict('LAST_ADMINISTRATOR', 'The last active administrator cannot lose the administrator role.');
        }
        user.role = body.role;
        user.updatedAt = new Date().toISOString();
        this.#store.commit();
        return this.toResource(user);
    }

    // ---- Own profile ---------------------------------------------------------------------

    /** Own profile update. The role, permissions and status can never change through it. */
    updateOwnProfile(user, body) {
        this.#assertNoPrivilegeRequest(body, {role: user.role, status: user.status, permissions: permissionsOf(user.role)});
        this.#assertImmutable(body, user, ['id', 'email']);
        const problems = this.#validateProfile(body);
        if (problems.hasProblems) throw ApiError.validation(problems.list);
        return this.#applyProfile(user, body);
    }

    // ---- Internals -----------------------------------------------------------------------

    #userOrThrow(id) {
        const user = this.#users.find(candidate => candidate.id === id);
        if (!user) throw ApiError.notFound('USER_NOT_FOUND', 'The user does not exist.');
        return user;
    }

    #isLastActiveAdministrator(user) {
        return !this.#users.some(candidate => candidate.id !== user.id
            && candidate.role === RoleType.ADMINISTRATOR && candidate.status === AccountStatus.ACTIVE);
    }

    #validateNewUser(body) {
        const problems = this.#validateProfile(body);
        problems.requireEmail(body.email);
        if (typeof body.password !== 'string' || body.password.length === 0) problems.add('password', 'REQUIRED');
        else if (body.password.length < MIN_PASSWORD_LENGTH) problems.add('password', 'TOO_SHORT');
        else if (body.password.length > MAX_PASSWORD_LENGTH) problems.add('password', 'TOO_LONG');
        return problems;
    }

    #validateProfile(body) {
        return new FieldProblems()
            .requireText(body.fullName, 'fullName', MAX_NAME_LENGTH)
            .optionalText(body.jobTitle, 'jobTitle', MAX_NAME_LENGTH)
            .optionalPhone(body.phoneNumber, 'phoneNumber');
    }

    async #insertUser(body, role) {
        const password = await hashPassword(body.password);
        // Check-and-insert happens synchronously after hashing, so concurrent sign-ups cannot both win.
        const email = normalizeEmail(body.email);
        if (this.#users.some(candidate => candidate.email === email)) {
            throw ApiError.conflict('EMAIL_ALREADY_REGISTERED', 'An account with this email address already exists.');
        }
        const now = new Date().toISOString();
        const user = {
            id: `usr-${randomUUID()}`,
            email,
            fullName: body.fullName.trim(),
            jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle.trim() : '',
            phoneNumber: typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '',
            role,
            status: AccountStatus.ACTIVE,
            password,
            createdAt: now,
            updatedAt: now
        };
        this.#users.push(user);
        this.#store.commit();
        return this.toResource(user);
    }

    #applyProfile(user, body) {
        user.fullName = body.fullName.trim();
        user.jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim() : '';
        user.phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
        user.updatedAt = new Date().toISOString();
        this.#store.commit();
        return this.toResource(user);
    }

    /**
     * Rejects a request that tries to set a role, permissions or status different from `allowed`.
     * Sending the unchanged value is accepted because the profile resource carries every field.
     */
    #assertNoPrivilegeRequest(body, allowed) {
        const escalates =
            (body.role !== undefined && body.role !== allowed.role)
            || (body.status !== undefined && body.status !== allowed.status)
            || (body.permissions !== undefined && !sameMembers(body.permissions, allowed.permissions));
        if (escalates) {
            throw new ApiError(403, 'PRIVILEGE_CHANGE_FORBIDDEN',
                'The role, permissions and status cannot be set through this operation.');
        }
    }

    /** Rejects a request that tries to change fields this operation never modifies. */
    #assertImmutable(body, user, fields) {
        const current = {...user, permissions: permissionsOf(user.role)};
        const changed = fields.filter(field => body[field] !== undefined
            && (field === 'permissions' ? !sameMembers(body[field], current.permissions) : body[field] !== current[field]));
        if (changed.length > 0) {
            throw ApiError.validation(changed.map(field => ({field, code: 'IMMUTABLE_FIELD'})),
                'These fields cannot be changed through this operation.');
        }
    }
}
