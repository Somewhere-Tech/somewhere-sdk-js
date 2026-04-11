import { Client } from './client.js';
import { SomewhereError } from './errors.js';
import { AiResource } from './resources/ai.js';
import { AuthResource } from './resources/auth.js';
import { BillingResource } from './resources/billing.js';
import { CronResource } from './resources/cron.js';
import { DbResource } from './resources/db.js';
import { createDeployNamespace, createPromoteNamespace, } from './resources/deploy.js';
import { DomainsResource } from './resources/domains.js';
import { EmailResource } from './resources/email.js';
import { EnvResource } from './resources/env.js';
import { FeedbackResource } from './resources/feedback.js';
import { FsResource } from './resources/fs.js';
import { JobsResource } from './resources/jobs.js';
import { LogsResource } from './resources/logs.js';
import { PreviewResource } from './resources/preview.js';
import { ProjectsResource } from './resources/projects.js';
import { QueueResource } from './resources/queue.js';
import { StorageResource } from './resources/storage.js';
import { UsageResource } from './resources/usage.js';
export { SomewhereError } from './errors.js';
export class Somewhere {
    constructor(opts) {
        this.client = new Client(opts);
        this.projects = new ProjectsResource(this.client);
        this.deploy = createDeployNamespace(this.client);
        this.promote = createPromoteNamespace(this.client);
        this.db = new DbResource(this.client);
        this.storage = new StorageResource(this.client);
        this.fs = new FsResource(this.client);
        this.auth = new AuthResource(this.client);
        this.email = new EmailResource(this.client);
        this.ai = new AiResource(this.client);
        this.jobs = new JobsResource(this.client);
        this.cron = new CronResource(this.client);
        this.queue = new QueueResource(this.client);
        this.logs = new LogsResource(this.client);
        this.env = new EnvResource(this.client);
        this.domains = new DomainsResource(this.client);
        this.preview = new PreviewResource(this.client);
        this.feedback = new FeedbackResource(this.client);
        this.billing = new BillingResource(this.client);
        this.usage = new UsageResource(this.client);
    }
}
export default Somewhere;
// Keep the error exported by value too for `instanceof` checks in CJS.
export { SomewhereError as SomewhereSdkError };
