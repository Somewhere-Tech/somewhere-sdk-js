export class AuthResource {
    constructor(client) {
        this.client = client;
    }
    signup(email, password, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', '/auth/signup', {
            body: { project_id: pid, email, password },
        });
    }
    login(email, password, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', '/auth/login', {
            body: { project_id: pid, email, password },
        });
    }
    logout(sessionToken, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', '/auth/logout', {
            body: { project_id: pid, session_token: sessionToken },
        });
    }
    /**
     * `jwt` is ignored at the transport level — the SDK sends whatever auth
     * the client was constructed with. Pass it only if you want to call `me`
     * from a developer-key client against a specific end-user JWT via a
     * short-lived override client.
     */
    me(_jwt) {
        return this.client.call('GET', '/auth/me');
    }
    forgot(email, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', '/auth/forgot', {
            body: { project_id: pid, email },
        });
    }
    reset(token, newPassword, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('POST', '/auth/reset', {
            body: { project_id: pid, token, new_password: newPassword },
        });
    }
    users(query = {}, projectId) {
        const pid = this.requireProjectId(projectId);
        return this.client.call('GET', '/auth/users', {
            query: {
                project_id: pid,
                search: query.search,
                limit: query.limit,
                cursor: query.cursor,
                ids: query.ids?.join(','),
            },
        });
    }
    verifyEmail(code) {
        return this.client.call('POST', '/auth/verify-email', { body: { code } });
    }
    requestVerification() {
        return this.client.call('POST', '/auth/request-email-verification');
    }
    deleteAccount() {
        return this.client.call('DELETE', '/auth/users/me');
    }
    updateMe(input) {
        return this.client.call('PATCH', '/auth/users/me', {
            body: { display_name: input.displayName, metadata: input.metadata },
        });
    }
    requireProjectId(explicit) {
        const pid = this.client.resolveProjectId(explicit);
        if (!pid) {
            throw new Error('auth.* calls require a projectId (via argument or constructor).');
        }
        return pid;
    }
}
