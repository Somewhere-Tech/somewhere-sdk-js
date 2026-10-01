import type {AnalyticsConsentPolicy,ProjectUpdateInput,ProjectUpdateResult,ProjectsClient,Result} from '../dist/types/index.js';
declare const client:ProjectsClient;
const policy:AnalyticsConsentPolicy={mode:'required',policy_version:'v1'};
const input:ProjectUpdateInput={analytics_consent:policy};
const output:Promise<Result<ProjectUpdateResult>>=client.update(input);
void output;
// @ts-expect-error Unknown policy modes are not the published input contract.
const invalid:AnalyticsConsentPolicy={mode:'automatic',policy_version:'v1'};
void invalid;
// @ts-expect-error Null policy is not an update command.
client.update({analytics_consent:null});
