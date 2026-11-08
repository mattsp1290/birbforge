export type ContractVersion = 'birbverify.v1';
export type RequestId = string;
export type GoalId = string;
export type PullRequest = string;
export type CorrelationId = string;
export type IdempotencyKey = string;
export type Repository = string;
export type Commit = string;
export type PrHead = string;
export type Base = string;
export type Kind = 'head' | 'integration';
export type ArtifactSha256 = string | null;
export type Revision = string;
/**
 * @minItems 1
 * @maxItems 8
 */
export type Checks =
  | [Check]
  | [Check, Check]
  | [Check, Check, Check]
  | [Check, Check, Check, Check]
  | [Check, Check, Check, Check, Check]
  | [Check, Check, Check, Check, Check, Check]
  | [Check, Check, Check, Check, Check, Check, Check]
  | [Check, Check, Check, Check, Check, Check, Check, Check];
export type Id = string;
export type Assertion = string;
export type ProcedurePath = 'check.py';
export type ProcedureRevision = string;
export type ProcedureSha256 = string;
/**
 * @minItems 1
 */
export type RequiredArtifacts = ['observation' | 'command', ...('observation' | 'command')[]];
export type Cleanup = 'fixture-reset-v1';
export type PlanSha256 = string;
export type Principal = string;
export type Workflow = string;
export type PolicyRevision = string;
export type Environment = string;
export type PermittedOperations = ('fixture.apply' | 'fixture.reset')[];
export type Capabilities = string[];
export type Fixture = 'isolated-counter-v1';
export type TimeoutSeconds = number;
export type MaxAttempts = number;
export type Deadline = string;
export type Classification = 'private';
export type Retention = 'fixture-local-until-owner-deletes-v1';
export type TelemetryCorrelation = string;
export type Components = string[];
export type RevisionMethod = 'git-archive-and-target-receipt-v1';

export interface Request {
  contract_version: ContractVersion;
  request_id: RequestId;
  goal_id: GoalId;
  pull_request: PullRequest;
  correlation_id: CorrelationId;
  idempotency_key: IdempotencyKey;
  candidate: Candidate;
  plan: Plan;
  plan_sha256: PlanSha256;
  authority: Authority;
  resources: Resources;
  evidence: EvidencePolicy;
  components: Components;
  revision_method: RevisionMethod;
}
export interface Candidate {
  repository: Repository;
  commit: Commit;
  pr_head: PrHead;
  base: Base;
  kind: Kind;
  artifact_sha256?: ArtifactSha256;
}
export interface Plan {
  revision: Revision;
  checks: Checks;
  cleanup: Cleanup;
}
export interface Check {
  id: Id;
  assertion: Assertion;
  procedure_path: ProcedurePath;
  procedure_revision: ProcedureRevision;
  procedure_sha256: ProcedureSha256;
  required_artifacts: RequiredArtifacts;
}
export interface Authority {
  principal: Principal;
  workflow: Workflow;
  policy_revision: PolicyRevision;
  environment: Environment;
  permitted_operations: PermittedOperations;
}
export interface Resources {
  capabilities: Capabilities;
  fixture: Fixture;
  timeout_seconds: TimeoutSeconds;
  max_attempts: MaxAttempts;
  deadline: Deadline;
}
export interface EvidencePolicy {
  classification: Classification;
  retention: Retention;
  telemetry_correlation: TelemetryCorrelation;
}
