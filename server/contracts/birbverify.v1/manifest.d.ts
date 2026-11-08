export type ContractVersion = 'birbverify.v1';
export type RequestId = string;
export type RequestSha256 = string;
export type AttemptId = string;
export type AttemptNumber = number;
export type RetryReason = 'initial' | 'infrastructure_recovery';
export type PriorAttemptId = string | null;
export type CorrelationId = string;
export type TelemetryCorrelation = string;
export type Repository = string;
export type Commit = string;
export type PrHead = string;
export type Base = string;
export type Kind = 'head' | 'integration';
export type ArtifactSha256 = string | null;
export type PlanSha256 = string;
export type PolicyRevision = string;
export type Environment = string;
export type WorkerId = string;
export type WorkerCapabilities = string[];
export type Tools = string[];
export type StartedAt = string;
export type FinishedAt = string;
export type ObservedBefore = string | null;
export type ObservedAfter = string | null;
export type CheckId = string;
export type Outcome = 'passed' | 'failed' | 'not_run' | 'inconclusive';
export type Observation = string;
export type DurationMs = number;
export type Id = string;
export type Kind1 = 'observation' | 'command';
export type Size = number;
export type Sha256 = string;
export type CapturedAt = string;
export type Classification = 'private';
export type Retention = 'fixture-local-until-owner-deletes-v1';
export type Artifacts = Artifact[];
export type Checks = CheckRecord[];
export type OperationId = string;
export type OperationReconciled = boolean;
export type Outcome1 = 'passed' | 'failed' | 'inconclusive' | 'cancelled' | 'superseded';
export type Cleanup = 'complete' | 'failed' | 'unknown';
export type Cancellation = 'none' | 'requested' | 'acknowledged';
export type Termination = 'confirmed' | 'unknown';
export type EnvironmentRelease = 'released' | 'retained' | 'quarantined';
export type Reason =
  | 'checks_completed'
  | 'required_evidence_missing'
  | 'infrastructure_error'
  | 'worker_lost'
  | 'cancellation_acknowledged'
  | 'termination_unknown';

export interface Manifest {
  contract_version: ContractVersion;
  request_id: RequestId;
  request_sha256: RequestSha256;
  attempt_id: AttemptId;
  attempt_number: AttemptNumber;
  retry_reason: RetryReason;
  prior_attempt_id: PriorAttemptId;
  correlation_id: CorrelationId;
  telemetry_correlation: TelemetryCorrelation;
  candidate: Candidate;
  plan_sha256: PlanSha256;
  policy_revision: PolicyRevision;
  environment: Environment;
  worker_id: WorkerId;
  worker_capabilities: WorkerCapabilities;
  tools: Tools;
  started_at: StartedAt;
  finished_at: FinishedAt;
  observed_before: ObservedBefore;
  observed_after: ObservedAfter;
  checks: Checks;
  operation_id: OperationId;
  operation_reconciled: OperationReconciled;
  outcome: Outcome1;
  cleanup: Cleanup;
  cancellation: Cancellation;
  termination: Termination;
  environment_release: EnvironmentRelease;
  reason: Reason;
}
export interface Candidate {
  repository: Repository;
  commit: Commit;
  pr_head: PrHead;
  base: Base;
  kind: Kind;
  artifact_sha256?: ArtifactSha256;
}
export interface CheckRecord {
  check_id: CheckId;
  outcome: Outcome;
  observation: Observation;
  duration_ms: DurationMs;
  artifacts: Artifacts;
}
export interface Artifact {
  id: Id;
  kind: Kind1;
  size: Size;
  sha256: Sha256;
  captured_at: CapturedAt;
  classification: Classification;
  retention: Retention;
}
