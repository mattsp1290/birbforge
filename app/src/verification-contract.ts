import {z} from 'zod/v4';

const Commit = z.string().regex(/^[0-9a-f]{40}$/);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const VerificationAdmission = z.object({
  request_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
  candidate_commit: Commit,
  approved_plan_sha256: Sha256,
}).strict();
export const VerificationCancellation = z.object({
  request_id: z.string().uuid(),
  command_id: z.string().uuid(),
  expected_revision: z.number().int().nonnegative(),
}).strict();
export const VerificationRequest = z.object({
  request_id: z.string().uuid(), idempotency_key: z.string().uuid(), conversation_id: z.string().uuid(),
  principal: z.string(), request_sha256: Sha256, candidate_commit: Commit, plan_sha256: Sha256,
  revision: z.number().int().nonnegative(),
  phase: z.enum(['queued', 'dispatching', 'running', 'uncertain', 'terminal', 'cancelled_before_dispatch', 'not_acquired', 'expired']),
  cancellation: z.enum(['none', 'requested', 'acknowledged', 'too_late']),
  cancellation_command_ids: z.array(z.string().uuid()),
  attempt_id: z.string().nullable(),
  outcome: z.enum(['passed', 'failed', 'inconclusive', 'cancelled', 'superseded']).nullable(),
  manifest: z.record(z.string(), z.unknown()).nullable(),
  eligibility: z.object({eligible: z.boolean(), reason: z.enum(['not_passed', 'candidate_changed', 'approval_changed', 'policy_changed', 'eligible', 'evidence_unavailable_or_invalid'])}),
});
export const VerificationSnapshot = z.object({
  installed: z.object({
    candidate_commit: Commit, approved_plan_sha256: Sha256, policy_revision: Commit,
    environment: z.literal('fixture-local'),
  }),
  revision: z.number().int().nonnegative(),
  observation_id: z.string().uuid(),
  requests: z.array(VerificationRequest),
  environment: z.object({
    state: z.enum(['free', 'active', 'revoked', 'quarantined', 'unavailable']),
    attempt_id: z.string().nullable(), stopped: z.boolean(), cleanup_complete: z.boolean(),
  }),
  recoveries: z.array(z.object({
    recovery_id: z.string(), request_id: z.string().uuid(), attempt_id: z.string(),
    manifest_sha256: Sha256, completed_at: z.string(),
    worker_stopped: z.literal(true), container_absent: z.literal(true),
  })),
});
export type VerificationAdmission = z.infer<typeof VerificationAdmission>;
export type VerificationCancellation = z.infer<typeof VerificationCancellation>;
export type VerificationRequest = z.infer<typeof VerificationRequest>;
export type VerificationSnapshot = z.infer<typeof VerificationSnapshot>;
