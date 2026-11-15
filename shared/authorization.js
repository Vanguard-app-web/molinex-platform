/**
 * Identity and Access Management vocabulary of the mock API. The names mirror the frontend design
 * (frontend-identity-access-management-class-diagram) and must not be renamed.
 */
export const RoleType = Object.freeze({
    ADMINISTRATOR: 'ADMINISTRATOR',
    MAINTENANCE_TECHNICIAN: 'MAINTENANCE_TECHNICIAN',
    PRODUCTION_OPERATOR: 'PRODUCTION_OPERATOR'
});

export const Permission = Object.freeze({
    MANAGE_USERS: 'MANAGE_USERS',
    MANAGE_PRODUCTION: 'MANAGE_PRODUCTION',
    MANAGE_MAINTENANCE: 'MANAGE_MAINTENANCE',
    VIEW_OPERATIONAL_INFORMATION: 'VIEW_OPERATIONAL_INFORMATION',
    VIEW_REPORTS: 'VIEW_REPORTS'
});

export const AccountStatus = Object.freeze({
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    LOCKED: 'LOCKED'
});

/**
 * Minimum permission matrix derived from the C4 actors and relationships:
 * - Administrator administers users and supervises operations and reports (no write access to
 *   production or maintenance data).
 * - Maintenance technician manages machines and maintenance work.
 * - Production operator records production, quality and waste information.
 * Every role can read operational information. This is the single source of truth of the mock.
 */
export const rolePermissions = Object.freeze({
    [RoleType.ADMINISTRATOR]: Object.freeze([
        Permission.MANAGE_USERS,
        Permission.VIEW_OPERATIONAL_INFORMATION,
        Permission.VIEW_REPORTS
    ]),
    [RoleType.MAINTENANCE_TECHNICIAN]: Object.freeze([
        Permission.MANAGE_MAINTENANCE,
        Permission.VIEW_OPERATIONAL_INFORMATION
    ]),
    [RoleType.PRODUCTION_OPERATOR]: Object.freeze([
        Permission.MANAGE_PRODUCTION,
        Permission.VIEW_OPERATIONAL_INFORMATION
    ])
});

/** Role assigned to accounts created through public sign-up (see README, "Decisions and gaps"). */
export const DEFAULT_SIGN_UP_ROLE = RoleType.PRODUCTION_OPERATOR;

export const isRoleType = value => typeof value === 'string' && Object.hasOwn(rolePermissions, value);

export const isAccountStatus = value => typeof value === 'string' && Object.hasOwn(AccountStatus, value);

/** @param {string} role a RoleType. @returns {string[]} a copy of its permissions. */
export const permissionsOf = role => [...(rolePermissions[role] ?? [])];

/** @param {string} role a RoleType. @param {string} permission a Permission. */
export const roleAllows = (role, permission) => (rolePermissions[role] ?? []).includes(permission);
