import {AccountStatus, RoleType} from '../shared/authorization.js';

/**
 * Fictitious accounts created the first time the mock starts. They exist only so the three roles
 * and the non-active account states can be exercised locally; the passwords are public demo
 * values, never real secrets. Their hashes are generated at start-up and stored in the private
 * data file, never in the committed repository.
 */
export const demoAccounts = Object.freeze([
    {
        id: 'usr-001',
        email: 'admin@molinex.test',
        password: 'Demo-Admin-2026',
        fullName: 'Demo Administrator',
        jobTitle: 'Plant administrator',
        phoneNumber: '',
        role: RoleType.ADMINISTRATOR,
        status: AccountStatus.ACTIVE
    },
    {
        id: 'usr-002',
        email: 'technician@molinex.test',
        password: 'Demo-Technician-2026',
        fullName: 'Demo Technician',
        jobTitle: 'Maintenance technician',
        phoneNumber: '',
        role: RoleType.MAINTENANCE_TECHNICIAN,
        status: AccountStatus.ACTIVE
    },
    {
        id: 'usr-003',
        email: 'operator@molinex.test',
        password: 'Demo-Operator-2026',
        fullName: 'Demo Operator',
        jobTitle: 'Production operator',
        phoneNumber: '',
        role: RoleType.PRODUCTION_OPERATOR,
        status: AccountStatus.ACTIVE
    },
    {
        id: 'usr-004',
        email: 'inactive@molinex.test',
        password: 'Demo-Inactive-2026',
        fullName: 'Demo Inactive User',
        jobTitle: '',
        phoneNumber: '',
        role: RoleType.PRODUCTION_OPERATOR,
        status: AccountStatus.INACTIVE
    },
    {
        id: 'usr-005',
        email: 'locked@molinex.test',
        password: 'Demo-Locked-2026',
        fullName: 'Demo Locked User',
        jobTitle: '',
        phoneNumber: '',
        role: RoleType.MAINTENANCE_TECHNICIAN,
        status: AccountStatus.LOCKED
    }
]);
