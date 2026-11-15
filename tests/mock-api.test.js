import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createTemporaryDataDirectory, startMockServer} from './support/mock-server-fixture.js';

const accounts = {
    admin: {email: 'admin@molinex.test', password: 'Demo-Admin-2026'},
    technician: {email: 'technician@molinex.test', password: 'Demo-Technician-2026'},
    operator: {email: 'operator@molinex.test', password: 'Demo-Operator-2026'},
    inactive: {email: 'inactive@molinex.test', password: 'Demo-Inactive-2026'},
    locked: {email: 'locked@molinex.test', password: 'Demo-Locked-2026'}
};
const sensitiveFragments = ['password', 'passwordHash', 'salt', 'scrypt', 'tokenHash'];

describe('Molinex mock API', () => {
    const data = createTemporaryDataDirectory();
    const contentPath = path.join(data.directory, 'commercial-content.json');
    const sampleContent = {
        plans: [{id: 'plan-test-1', name: 'Test plan', priceLabel: 'Test price label', features: ['Test feature']}],
        valueProposition: {headline: 'Test headline', benefits: ['Test benefit']}
    };
    let server;
    const tokens = {};

    const signIn = async (account, current = server) => {
        const response = await current.request('POST', '/api/v1/iam/sign-in', {body: accounts[account]});
        assert.equal(response.status, 200, `sign-in as ${account}`);
        return response.body.token;
    };

    before(async () => {
        fs.writeFileSync(contentPath, JSON.stringify(sampleContent));
        server = await startMockServer({dbPath: data.dbPath, commercialContentPath: contentPath});
        for (const account of ['admin', 'technician', 'operator']) tokens[account] = await signIn(account);
    });

    after(async () => {
        await server.stop();
    });

    describe('health and operational resources', () => {
        test('health and root stay public', async () => {
            const health = await server.request('GET', '/api/v1/health');
            assert.equal(health.status, 200);
            assert.equal(health.body.status, 'ok');
            const root = await server.request('GET', '/');
            assert.equal(root.status, 200);
            assert.deepEqual(root.body.resources.sort(), [
                'machines', 'maintenance-records', 'production-batches', 'production-records',
                'quality-assessments', 'raw-material-receptions', 'waste-records'
            ]);
        });

        test('operational collections require a valid bearer token', async () => {
            for (const resource of ['/api/v1/machines', '/machines']) {
                const anonymous = await server.request('GET', resource);
                assert.equal(anonymous.status, 401);
                assert.equal(anonymous.body.code, 'AUTHENTICATION_REQUIRED');
                assert.equal(anonymous.headers.get('www-authenticate'), 'Bearer realm="molinex-mock-api"');
                const invalid = await server.request('GET', resource, {token: 'mlx-demo.not-a-real-token'});
                assert.equal(invalid.status, 401);
                assert.equal(invalid.body.code, 'INVALID_TOKEN');
            }
        });

        test('every role can read the seven operational collections', async () => {
            const resources = ['raw-material-receptions', 'production-batches', 'production-records',
                'quality-assessments', 'waste-records', 'machines', 'maintenance-records'];
            for (const role of ['admin', 'technician', 'operator']) {
                for (const resource of resources) {
                    const response = await server.request('GET', `/api/v1/${resource}`, {token: tokens[role]});
                    assert.equal(response.status, 200, `${role} reads ${resource}`);
                    assert.ok(Array.isArray(response.body) && response.body.length > 0, `${resource} keeps its seed data`);
                }
            }
        });

        test('writes require the matching MANAGE permission', async () => {
            const machine = {code: 'TEST-01', name: 'Test machine', model: 'T-1', status: 'OPERATIONAL', statusChangedAt: '2026-10-01T00:00:00Z'};
            const batch = {code: 'LOT-TEST-1', receptionId: '1', registeredAt: '2026-10-01T00:00:00Z'};

            assert.equal((await server.request('POST', '/api/v1/machines', {token: tokens.operator, body: machine})).status, 403);
            assert.equal((await server.request('POST', '/api/v1/machines', {token: tokens.admin, body: machine})).status, 403);
            assert.equal((await server.request('POST', '/api/v1/production-batches', {token: tokens.technician, body: batch})).status, 403);
            assert.equal((await server.request('POST', '/api/v1/production-batches', {token: tokens.admin, body: batch})).status, 403);
            assert.equal((await server.request('DELETE', '/api/v1/machines/1', {token: tokens.operator})).status, 403);

            const createdMachine = await server.request('POST', '/api/v1/machines', {token: tokens.technician, body: machine});
            assert.equal(createdMachine.status, 201);
            const createdBatch = await server.request('POST', '/api/v1/production-batches', {token: tokens.operator, body: batch});
            assert.equal(createdBatch.status, 201);
        });

        test('the generic CRUD cannot reach private or unknown resources', async () => {
            const paths = ['/db', '/api/v1/db', '/users', '/api/v1/users', '/tokens', '/api/v1/tokens', '/sessions',
                '/commercial-inquiries', '/api/v1/commercial-inquiries', '/db.private.json', '/api/v1/iam-private'];
            for (const resource of paths) {
                for (const token of [undefined, tokens.admin]) {
                    const response = await server.request('GET', resource, {token});
                    assert.equal(response.status, 404, `GET ${resource} ${token ? 'as admin' : 'anonymously'}`);
                    assert.equal(response.body.code, 'NOT_FOUND');
                }
            }
            const write = await server.request('POST', '/users', {token: tokens.admin, body: {email: 'x@molinex.test'}});
            assert.equal(write.status, 404);
        });
    });

    describe('sign-in', () => {
        test('returns the SignInResource and never credentials', async () => {
            const response = await server.request('POST', '/api/v1/iam/sign-in', {body: accounts.technician});
            assert.equal(response.status, 200);
            assert.deepEqual(Object.keys(response.body).sort(), ['permissions', 'role', 'token', 'userId']);
            assert.equal(response.body.role, 'MAINTENANCE_TECHNICIAN');
            assert.deepEqual([...response.body.permissions].sort(), ['MANAGE_MAINTENANCE', 'VIEW_OPERATIONAL_INFORMATION']);
            assert.match(response.body.token, /^mlx-demo\./);
            for (const fragment of sensitiveFragments) assert.ok(!response.text.includes(fragment), fragment);
        });

        test('rejects wrong passwords and unknown emails with the same answer', async () => {
            const wrongPassword = await server.request('POST', '/api/v1/iam/sign-in', {body: {email: accounts.admin.email, password: 'wrong-password'}});
            const unknownEmail = await server.request('POST', '/api/v1/iam/sign-in', {body: {email: 'nobody@molinex.test', password: 'whatever-1'}});
            assert.equal(wrongPassword.status, 401);
            assert.equal(wrongPassword.body.code, 'INVALID_CREDENTIALS');
            assert.deepEqual(unknownEmail.body, wrongPassword.body);
        });

        test('rejects incomplete input with 400 and field details', async () => {
            const response = await server.request('POST', '/api/v1/iam/sign-in', {body: {email: ''}});
            assert.equal(response.status, 400);
            assert.equal(response.body.code, 'VALIDATION_ERROR');
            assert.deepEqual(response.body.details.map(detail => detail.field).sort(), ['email', 'password']);
        });

        test('inactive and locked accounts cannot authenticate', async () => {
            const inactive = await server.request('POST', '/api/v1/iam/sign-in', {body: accounts.inactive});
            assert.equal(inactive.status, 403);
            assert.equal(inactive.body.code, 'ACCOUNT_INACTIVE');
            const locked = await server.request('POST', '/api/v1/iam/sign-in', {body: accounts.locked});
            assert.equal(locked.status, 403);
            assert.equal(locked.body.code, 'ACCOUNT_LOCKED');
        });

        test('email matching ignores case and surrounding spaces', async () => {
            const response = await server.request('POST', '/api/v1/iam/sign-in', {body: {email: '  ADMIN@Molinex.TEST ', password: accounts.admin.password}});
            assert.equal(response.status, 200);
        });
    });

    describe('sign-up, profile and sign-out', () => {
        const newcomer = {email: 'new.person@molinex.test', password: 'Newcomer-2026', fullName: 'New Person'};
        let newcomerToken;

        test('sign-up creates an ACTIVE account with the default role and a Location header', async () => {
            const response = await server.request('POST', '/api/v1/iam/sign-up', {body: newcomer});
            assert.equal(response.status, 201);
            assert.equal(response.headers.get('location'), `/api/v1/iam/users/${response.body.id}`);
            assert.equal(response.body.role, 'PRODUCTION_OPERATOR');
            assert.equal(response.body.status, 'ACTIVE');
            assert.deepEqual(response.body.permissions.sort(), ['MANAGE_PRODUCTION', 'VIEW_OPERATIONAL_INFORMATION']);
            for (const fragment of sensitiveFragments) assert.ok(!response.text.includes(fragment), fragment);
            newcomerToken = (await server.request('POST', '/api/v1/iam/sign-in', {body: newcomer})).body.token;
            assert.ok(newcomerToken);
        });

        test('sign-up rejects duplicate emails (any case) with 409', async () => {
            const response = await server.request('POST', '/api/v1/iam/sign-up', {body: {...newcomer, email: newcomer.email.toUpperCase()}});
            assert.equal(response.status, 409);
            assert.equal(response.body.code, 'EMAIL_ALREADY_REGISTERED');
        });

        test('sign-up validates email, password and name', async () => {
            const response = await server.request('POST', '/api/v1/iam/sign-up', {body: {email: 'not-an-email', password: 'short', fullName: ' '}});
            assert.equal(response.status, 400);
            assert.deepEqual(response.body.details.map(detail => `${detail.field}:${detail.code}`).sort(),
                ['email:INVALID_FORMAT', 'fullName:REQUIRED', 'password:TOO_SHORT']);
        });

        test('sign-up cannot request a privileged role, status or permissions', async () => {
            for (const privilege of [{role: 'ADMINISTRATOR'}, {status: 'ACTIVE', role: 'MAINTENANCE_TECHNICIAN'}, {permissions: ['MANAGE_USERS']}]) {
                const response = await server.request('POST', '/api/v1/iam/sign-up', {
                    body: {email: `escalation-${Math.random().toString(36).slice(2)}@molinex.test`, password: 'Escalation-2026', fullName: 'Escalation', ...privilege}
                });
                assert.equal(response.status, 403);
                assert.equal(response.body.code, 'PRIVILEGE_CHANGE_FORBIDDEN');
            }
        });

        test('profile reads and updates the own profile only', async () => {
            const own = await server.request('GET', '/api/v1/iam/profile', {token: newcomerToken});
            assert.equal(own.status, 200);
            assert.equal(own.body.email, newcomer.email);

            const updated = await server.request('PUT', '/api/v1/iam/profile', {
                token: newcomerToken,
                body: {...own.body, fullName: 'New Person Updated', jobTitle: 'Packer', phoneNumber: '+51 999 888 777'}
            });
            assert.equal(updated.status, 200);
            assert.equal(updated.body.fullName, 'New Person Updated');
            assert.equal(updated.body.jobTitle, 'Packer');
            assert.equal(updated.body.role, 'PRODUCTION_OPERATOR');
        });

        test('profile cannot be used to raise privileges or change the email', async () => {
            const own = (await server.request('GET', '/api/v1/iam/profile', {token: newcomerToken})).body;
            const escalated = await server.request('PUT', '/api/v1/iam/profile', {token: newcomerToken, body: {...own, role: 'ADMINISTRATOR', permissions: ['MANAGE_USERS']}});
            assert.equal(escalated.status, 403);
            const statusChange = await server.request('PUT', '/api/v1/iam/profile', {token: newcomerToken, body: {...own, status: 'INACTIVE'}});
            assert.equal(statusChange.status, 403);
            const emailChange = await server.request('PUT', '/api/v1/iam/profile', {token: newcomerToken, body: {...own, email: 'other@molinex.test'}});
            assert.equal(emailChange.status, 400);
            assert.equal(emailChange.body.details[0].code, 'IMMUTABLE_FIELD');
            const after = (await server.request('GET', '/api/v1/iam/profile', {token: newcomerToken})).body;
            assert.equal(after.role, 'PRODUCTION_OPERATOR');
            assert.equal(after.email, newcomer.email);
        });

        test('profile validates its fields', async () => {
            const response = await server.request('PUT', '/api/v1/iam/profile', {token: newcomerToken, body: {fullName: '', phoneNumber: 'abc'}});
            assert.equal(response.status, 400);
            assert.deepEqual(response.body.details.map(detail => detail.field).sort(), ['fullName', 'phoneNumber']);
        });

        test('sign-out revokes the token', async () => {
            const { body } = await server.request('POST', '/api/v1/iam/sign-in', {body: newcomer});
            const before = await server.request('GET', '/api/v1/iam/profile', {token: body.token});
            assert.equal(before.status, 200);
            const signOut = await server.request('POST', '/api/v1/iam/sign-out', {token: body.token});
            assert.equal(signOut.status, 204);
            const after = await server.request('GET', '/api/v1/iam/profile', {token: body.token});
            assert.equal(after.status, 401);
            assert.equal(after.body.code, 'INVALID_TOKEN');
            const anonymous = await server.request('POST', '/api/v1/iam/sign-out');
            assert.equal(anonymous.status, 401);
        });

        test('malformed authorization headers are rejected', async () => {
            const response = await server.request('GET', '/api/v1/iam/profile', {headers: {Authorization: 'Basic abc'}});
            assert.equal(response.status, 401);
            assert.equal(response.body.code, 'INVALID_TOKEN');
        });
    });

    describe('user administration', () => {
        test('requires authentication and MANAGE_USERS', async () => {
            assert.equal((await server.request('GET', '/api/v1/iam/users')).status, 401);
            for (const role of ['technician', 'operator']) {
                assert.equal((await server.request('GET', '/api/v1/iam/users', {token: tokens[role]})).status, 403);
                assert.equal((await server.request('POST', '/api/v1/iam/users', {token: tokens[role], body: {}})).status, 403);
                assert.equal((await server.request('PUT', '/api/v1/iam/users/usr-003/role', {token: tokens[role], body: {role: 'ADMINISTRATOR'}})).status, 403);
            }
        });

        test('lists users without credentials', async () => {
            const response = await server.request('GET', '/api/v1/iam/users', {token: tokens.admin});
            assert.equal(response.status, 200);
            assert.ok(response.body.length >= 5);
            for (const user of response.body) {
                assert.deepEqual(Object.keys(user).sort(), ['email', 'fullName', 'id', 'jobTitle', 'permissions', 'phoneNumber', 'role', 'status']);
            }
            for (const fragment of sensitiveFragments) assert.ok(!response.text.includes(fragment), fragment);
        });

        test('creates, reads, updates and assigns roles', async () => {
            const created = await server.request('POST', '/api/v1/iam/users', {
                token: tokens.admin,
                body: {email: 'managed@molinex.test', password: 'Managed-2026', fullName: 'Managed User', role: 'MAINTENANCE_TECHNICIAN'}
            });
            assert.equal(created.status, 201);
            assert.equal(created.body.role, 'MAINTENANCE_TECHNICIAN');
            assert.equal(created.headers.get('location'), `/api/v1/iam/users/${created.body.id}`);

            const read = await server.request('GET', `/api/v1/iam/users/${created.body.id}`, {token: tokens.admin});
            assert.deepEqual(read.body, created.body);

            const updated = await server.request('PUT', `/api/v1/iam/users/${created.body.id}`, {token: tokens.admin, body: {...created.body, fullName: 'Managed User Renamed', jobTitle: 'Lead'}});
            assert.equal(updated.status, 200);
            assert.equal(updated.body.fullName, 'Managed User Renamed');

            const roleChange = await server.request('PUT', `/api/v1/iam/users/${created.body.id}/role`, {token: tokens.admin, body: {role: 'ADMINISTRATOR'}});
            assert.equal(roleChange.status, 200);
            assert.equal(roleChange.body.role, 'ADMINISTRATOR');
            assert.ok(roleChange.body.permissions.includes('MANAGE_USERS'));

            const privilegeViaUpdate = await server.request('PUT', `/api/v1/iam/users/${created.body.id}`, {token: tokens.admin, body: {...created.body, role: 'PRODUCTION_OPERATOR'}});
            assert.equal(privilegeViaUpdate.status, 400);
            assert.equal(privilegeViaUpdate.body.details[0].code, 'IMMUTABLE_FIELD');
        });

        test('role changes take effect immediately on existing tokens', async () => {
            const target = await server.request('POST', '/api/v1/iam/users', {
                token: tokens.admin,
                body: {email: 'promoted@molinex.test', password: 'Promoted-2026', fullName: 'Promoted User', role: 'PRODUCTION_OPERATOR'}
            });
            const targetToken = (await server.request('POST', '/api/v1/iam/sign-in', {body: {email: 'promoted@molinex.test', password: 'Promoted-2026'}})).body.token;
            assert.equal((await server.request('GET', '/api/v1/iam/users', {token: targetToken})).status, 403);
            await server.request('PUT', `/api/v1/iam/users/${target.body.id}/role`, {token: tokens.admin, body: {role: 'ADMINISTRATOR'}});
            assert.equal((await server.request('GET', '/api/v1/iam/users', {token: targetToken})).status, 200);
        });

        test('reports invalid input, duplicates and missing users', async () => {
            const invalid = await server.request('POST', '/api/v1/iam/users', {token: tokens.admin, body: {email: 'bad', password: 'short', fullName: '', role: 'ROOT'}});
            assert.equal(invalid.status, 400);
            assert.deepEqual(invalid.body.details.map(detail => detail.field).sort(), ['email', 'fullName', 'password', 'role']);

            const duplicate = await server.request('POST', '/api/v1/iam/users', {token: tokens.admin, body: {email: accounts.operator.email, password: 'Duplicate-2026', fullName: 'Duplicate', role: 'PRODUCTION_OPERATOR'}});
            assert.equal(duplicate.status, 409);

            const missing = await server.request('GET', '/api/v1/iam/users/usr-does-not-exist', {token: tokens.admin});
            assert.equal(missing.status, 404);
            assert.equal(missing.body.code, 'USER_NOT_FOUND');
            assert.equal((await server.request('PUT', '/api/v1/iam/users/usr-does-not-exist/role', {token: tokens.admin, body: {role: 'ADMINISTRATOR'}})).status, 404);

            const badRole = await server.request('PUT', '/api/v1/iam/users/usr-003/role', {token: tokens.admin, body: {role: 'SUPERUSER'}});
            assert.equal(badRole.status, 400);
        });

        test('the last active administrator cannot be demoted', async () => {
            const users = (await server.request('GET', '/api/v1/iam/users', {token: tokens.admin})).body;
            const activeAdmins = users.filter(user => user.role === 'ADMINISTRATOR' && user.status === 'ACTIVE');
            // Demote every administrator except the demo admin; the last one must then be protected.
            for (const admin of activeAdmins.filter(user => user.email !== accounts.admin.email)) {
                const demoted = await server.request('PUT', `/api/v1/iam/users/${admin.id}/role`, {token: tokens.admin, body: {role: 'PRODUCTION_OPERATOR'}});
                assert.equal(demoted.status, 200);
            }
            const demoAdmin = users.find(user => user.email === accounts.admin.email);
            const blocked = await server.request('PUT', `/api/v1/iam/users/${demoAdmin.id}/role`, {token: tokens.admin, body: {role: 'PRODUCTION_OPERATOR'}});
            assert.equal(blocked.status, 409);
            assert.equal(blocked.body.code, 'LAST_ADMINISTRATOR');
        });
    });

    describe('Commercial Engagement', () => {
        test('plans and the value proposition are public', async () => {
            const plans = await server.request('GET', '/api/v1/commercial/plans');
            assert.equal(plans.status, 200);
            assert.deepEqual(plans.body, sampleContent.plans);
            const proposition = await server.request('GET', '/api/v1/commercial/value-proposition');
            assert.equal(proposition.status, 200);
            assert.deepEqual(proposition.body, sampleContent.valueProposition);
        });

        test('the plan catalog and value proposition cannot be changed through the API', async () => {
            for (const method of ['POST', 'PUT', 'DELETE']) {
                const response = await server.request(method, '/api/v1/commercial/plans', {token: tokens.admin, body: {}});
                assert.equal(response.status, 405, `${method} /plans`);
            }
            const proposition = await server.request('PUT', '/api/v1/commercial/value-proposition', {token: tokens.admin, body: {headline: 'Changed', benefits: []}});
            assert.equal(proposition.status, 405);
        });

        test('an anonymous visitor submits an inquiry; the server assigns id and date', async () => {
            const response = await server.request('POST', '/api/v1/commercial/inquiries', {
                body: {
                    id: 'forged-id', submittedAt: '1999-01-01T00:00:00Z',
                    fullName: ' Visitor Test ', email: 'Visitor@Example.TEST', phone: '+51 987 654 321',
                    companyName: 'Test Mill', message: ' Please contact us. '
                }
            });
            assert.equal(response.status, 201);
            assert.match(response.body.id, /^inq-/);
            assert.notEqual(response.body.id, 'forged-id');
            assert.ok(Date.now() - Date.parse(response.body.submittedAt) < 60_000);
            assert.equal(response.body.email, 'visitor@example.test');
            assert.equal(response.body.fullName, 'Visitor Test');
            assert.equal(response.body.message, 'Please contact us.');
            assert.equal(response.headers.get('location'), `/api/v1/commercial/inquiries/${response.body.id}`);
            assert.deepEqual(Object.keys(response.body).sort(), ['companyName', 'email', 'fullName', 'id', 'message', 'phone', 'submittedAt']);
        });

        test('the phone is optional and omitted when blank', async () => {
            for (const phone of [undefined, null, '', '   ']) {
                const response = await server.request('POST', '/api/v1/commercial/inquiries', {
                    body: {fullName: 'No Phone', email: 'nophone@example.test', phone, companyName: 'Test Mill', message: 'Hello'}
                });
                assert.equal(response.status, 201);
                assert.ok(!('phone' in response.body));
            }
        });

        test('invalid inquiries are rejected with field details', async () => {
            const empty = await server.request('POST', '/api/v1/commercial/inquiries', {body: {}});
            assert.equal(empty.status, 400);
            assert.deepEqual(empty.body.details.map(detail => detail.field).sort(), ['companyName', 'email', 'fullName', 'message']);

            const invalid = await server.request('POST', '/api/v1/commercial/inquiries', {
                body: {fullName: 'A', email: 'nope', phone: 'call me', companyName: 'B', message: 'C'}
            });
            assert.equal(invalid.status, 400);
            assert.deepEqual(invalid.body.details.map(detail => `${detail.field}:${detail.code}`).sort(), ['email:INVALID_FORMAT', 'phone:INVALID_FORMAT']);
        });

        test('inquiries are write-only and stored outside the public database', async () => {
            const list = await server.request('GET', '/api/v1/commercial/inquiries', {token: tokens.admin});
            assert.equal(list.status, 405);
            assert.equal(list.headers.get('allow'), 'POST');
            const item = await server.request('GET', '/api/v1/commercial/inquiries/inq-1', {token: tokens.admin});
            assert.equal(item.status, 404);

            assert.ok(!fs.readFileSync(data.dbPath, 'utf8').includes('visitor@example.test'));
            const privateData = JSON.parse(fs.readFileSync(data.privateDataPath, 'utf8'));
            assert.ok(privateData.commercial.inquiries.some(inquiry => inquiry.email === 'visitor@example.test'));
        });
    });

    describe('protocol errors and private data', () => {
        test('malformed JSON, unknown paths and unsupported methods use the common error format', async () => {
            const malformed = await server.request('POST', '/api/v1/iam/sign-in', {rawBody: '{"email": '});
            assert.equal(malformed.status, 400);
            assert.equal(malformed.body.code, 'MALFORMED_JSON');
            const unknown = await server.request('GET', '/api/v1/iam/unknown');
            assert.equal(unknown.status, 404);
            assert.equal(unknown.body.code, 'NOT_FOUND');
            const method = await server.request('DELETE', '/api/v1/iam/sign-in');
            assert.equal(method.status, 405);
            assert.equal(method.headers.get('allow'), 'POST');
            for (const response of [malformed, unknown, method]) {
                assert.deepEqual(Object.keys(response.body).sort(), ['code', 'details', 'message', 'status']);
            }
        });

        test('an oversized body is rejected in the common format', async () => {
            const response = await server.request('POST', '/api/v1/commercial/inquiries', {
                rawBody: JSON.stringify({fullName: 'x'.repeat(11 * 1024 * 1024)})
            });
            assert.equal(response.status, 413);
            assert.equal(response.body.code, 'PAYLOAD_TOO_LARGE');
        });

        test('credentials are stored only as scrypt hashes', () => {
            const text = fs.readFileSync(data.privateDataPath, 'utf8');
            for (const account of Object.values(accounts)) assert.ok(!text.includes(account.password), account.email);
            const privateData = JSON.parse(text);
            assert.ok(privateData.iam.users.every(user => user.password.algorithm === 'scrypt' && user.password.hash.length > 40));
            assert.ok(privateData.iam.sessions.every(session => session.tokenHash.length === 64 && !('token' in session)));
            for (const token of Object.values(tokens)) assert.ok(!text.includes(token));
        });
    });
});

describe('Molinex mock API persistence', () => {
    test('users, roles, inquiries and sessions survive a restart; the demonstration database is untouched', async () => {
        const data = createTemporaryDataDirectory();
        const originalDatabase = fs.readFileSync(data.dbPath, 'utf8');
        let server = await startMockServer({dbPath: data.dbPath});
        try {
            const adminToken = (await server.request('POST', '/api/v1/iam/sign-in', {body: accounts.admin})).body.token;
            const created = await server.request('POST', '/api/v1/iam/users', {
                token: adminToken,
                body: {email: 'persisted@molinex.test', password: 'Persisted-2026', fullName: 'Persisted User', role: 'MAINTENANCE_TECHNICIAN'}
            });
            assert.equal(created.status, 201);
            const inquiry = await server.request('POST', '/api/v1/commercial/inquiries', {
                body: {fullName: 'Persisted Visitor', email: 'persisted.visitor@example.test', companyName: 'Persisted Mill', message: 'Still here?'}
            });
            assert.equal(inquiry.status, 201);

            // Default content ships without plans or benefits; the headline comes from the existing application text.
            const plans = await server.request('GET', '/api/v1/commercial/plans');
            assert.deepEqual(plans.body, []);
            const proposition = await server.request('GET', '/api/v1/commercial/value-proposition');
            assert.deepEqual(proposition.body.benefits, []);
            assert.ok(proposition.body.headline.length > 0);

            await server.stop();
            server = await startMockServer({dbPath: data.dbPath});

            const stillValid = await server.request('GET', '/api/v1/iam/profile', {token: adminToken});
            assert.equal(stillValid.status, 200);
            const users = await server.request('GET', '/api/v1/iam/users', {token: adminToken});
            const persisted = users.body.find(user => user.email === 'persisted@molinex.test');
            assert.equal(persisted.id, created.body.id);
            assert.equal(persisted.role, 'MAINTENANCE_TECHNICIAN');
            assert.equal((await server.request('POST', '/api/v1/iam/sign-in', {body: {email: 'persisted@molinex.test', password: 'Persisted-2026'}})).status, 200);

            const privateData = JSON.parse(fs.readFileSync(data.privateDataPath, 'utf8'));
            assert.equal(privateData.commercial.inquiries.length, 1);
            assert.equal(privateData.commercial.inquiries[0].id, inquiry.body.id);
            assert.equal(fs.readFileSync(data.dbPath, 'utf8'), originalDatabase, 'IAM and commercial data never touch the JSON Server database');
        } finally {
            await server.stop();
        }
    });
});

describe('Molinex mock API account states', () => {
    test('a token stops working when its account is no longer active, and the account cannot sign in again', async () => {
        const data = createTemporaryDataDirectory();
        let server = await startMockServer({dbPath: data.dbPath});
        try {
            const token = (await server.request('POST', '/api/v1/iam/sign-in', {body: accounts.operator})).body.token;
            assert.equal((await server.request('GET', '/api/v1/iam/profile', {token})).status, 200);
            await server.stop();

            // Account states cannot be changed through the API; the private data file is edited while the API is stopped.
            const privateData = JSON.parse(fs.readFileSync(data.privateDataPath, 'utf8'));
            privateData.iam.users.find(user => user.email === accounts.operator.email).status = 'LOCKED';
            fs.writeFileSync(data.privateDataPath, JSON.stringify(privateData));
            server = await startMockServer({dbPath: data.dbPath});

            const rejected = await server.request('GET', '/api/v1/machines', {token});
            assert.equal(rejected.status, 401);
            assert.equal(rejected.body.code, 'INVALID_TOKEN');
            const signIn = await server.request('POST', '/api/v1/iam/sign-in', {body: accounts.operator});
            assert.equal(signIn.status, 403);
            assert.equal(signIn.body.code, 'ACCOUNT_LOCKED');
        } finally {
            await server.stop();
        }
    });

    test('an invalid commercial content file stops the API from starting', async () => {
        const data = createTemporaryDataDirectory();
        const contentPath = path.join(data.directory, 'broken-content.json');
        fs.writeFileSync(contentPath, JSON.stringify({plans: [{id: 'p'}], valueProposition: {headline: '', benefits: []}}));
        await assert.rejects(startMockServer({dbPath: data.dbPath, commercialContentPath: contentPath}), /does not follow/);
    });
});
