import { Client } from './client.js';
import { SomewhereError } from './errors.js';
import { AiResource } from './resources/ai.js';
import { AuthResource } from './resources/auth.js';
import { BillingResource } from './resources/billing.js';
import { CronResource } from './resources/cron.js';
import { DbResource } from './resources/db.js';
import {
  createDeployNamespace,
  createPromoteNamespace,
  type DeployNamespace,
  type PromoteNamespace,
} from './resources/deploy.js';
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
import type { SomewhereOptions } from './types.js';

export { SomewhereError } from './errors.js';
export type { SomewhereErrorInit } from './errors.js';
export type * from './types.js';
export type {
  ProjectCreateInput,
  ProjectRenameInput,
} from './resources/projects.js';
export type { DeployInput, DeployStatus } from './resources/deploy.js';
export type { StoragePutOptions, StorageListOptions } from './resources/storage.js';
export type { FsWriteOptions } from './resources/fs.js';
export type { AuthUsersQuery, AuthUpdateMeInput } from './resources/auth.js';
export type {
  AiCompleteInput,
  AiEmbedInput,
  AiImageInput,
  AiTtsInput,
  AiTranscribeInput,
} from './resources/ai.js';
export type { JobCreateInput, JobListQuery } from './resources/jobs.js';
export type { CronCreateInput, CronUpdateInput } from './resources/cron.js';
export type { QueuePushInput } from './resources/queue.js';
export type { LogWriteInput, LogReadQuery, LogEntry, LogLevel } from './resources/logs.js';
export type { EnvVar } from './resources/env.js';
export type { DomainRecord } from './resources/domains.js';
export type { PreviewViewer } from './resources/preview.js';
export type { FeedbackSubmitInput, FeedbackRecord } from './resources/feedback.js';
export type { EmailSendInput } from './resources/email.js';
export type { UsageReport, UsageSummary } from './resources/usage.js';

export class Somewhere {
  readonly projects: ProjectsResource;
  readonly deploy: DeployNamespace;
  readonly promote: PromoteNamespace;
  readonly db: DbResource;
  readonly storage: StorageResource;
  readonly fs: FsResource;
  readonly auth: AuthResource;
  readonly email: EmailResource;
  readonly ai: AiResource;
  readonly jobs: JobsResource;
  readonly cron: CronResource;
  readonly queue: QueueResource;
  readonly logs: LogsResource;
  readonly env: EnvResource;
  readonly domains: DomainsResource;
  readonly preview: PreviewResource;
  readonly feedback: FeedbackResource;
  readonly billing: BillingResource;
  readonly usage: UsageResource;

  private readonly client: Client;

  constructor(opts: SomewhereOptions) {
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

// Re-export the typed error payload so consumers can narrow on it.
export type { SomewhereOptions };

// Keep the error exported by value too for `instanceof` checks in CJS.
export { SomewhereError as SomewhereSdkError };
