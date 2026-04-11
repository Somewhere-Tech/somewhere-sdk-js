export function createDeployNamespace(client) {
    const fn = ((input) => {
        const projectId = client.resolveProjectId(input.projectId);
        return client.call('POST', '/deploy', {
            body: {
                project_id: projectId,
                files: input.files,
                functions: input.functions,
            },
        });
    });
    fn.status = (projectId) => {
        const pid = client.resolveProjectId(projectId);
        return client.call('GET', '/deploy/status', {
            query: { project_id: pid },
        });
    };
    return fn;
}
export function createPromoteNamespace(client) {
    const fn = ((projectId) => {
        const pid = client.resolveProjectId(projectId);
        return client.call('POST', '/promote', { body: { project_id: pid } });
    });
    fn.rollback = (projectId) => {
        const pid = client.resolveProjectId(projectId);
        return client.call('POST', '/promote/rollback', { body: { project_id: pid } });
    };
    return fn;
}
