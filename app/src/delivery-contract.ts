import {z} from 'zod/v4';

const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const Commit = z.string().regex(/^[0-9a-f]{40}$/);
const GoalOffer = z.object({
  offer_id: z.string(), title: z.string(), goal_text: z.string(), repository_id: z.string(),
  base_commit: Commit, policy_revision: Digest, allowed_paths: z.array(z.string()), acceptance_id: z.string(),
  goal_ref: z.object({project: z.string(), record_id: z.string(), revision: z.string(), content_sha256: Digest}).strict(),
}).strict();
const Candidate = z.object({repository_id: z.string(), base_commit: Commit, head_commit: Commit,
  branch: z.string(), changed_paths: z.array(z.string()), acceptance: z.object({acceptance_id: z.string(),
    outcome: z.literal('passed'), evidence_digest: Digest, evidence_ref: z.string()}).strict()}).strict();
const Review = z.object({candidate_commit: Commit, review_attempt: z.number().int().nonnegative().default(0), reviewer: z.literal('claude-cli'),
  disposition: z.enum(['approved', 'changes_requested', 'inconclusive']), findings_digest: Digest, evidence_ref: z.string(), summary: z.string().min(1).max(2000).default("Review details unavailable.")}).strict();
const Draft = z.object({status: z.literal('draft_ready'), repository_id: z.string(), head_commit: Commit,
  base_branch: z.string(), provider: z.literal('github'), number: z.number().int().positive(),
  url: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[0-9]+$/), draft: z.literal(true)}).strict();
export const DeliveryCommand = z.object({command_id: z.string().uuid(), expected_revision: z.number().int().nonnegative(),
  offer_sha256: Digest, action: z.enum(['approve', 'reject', 'cancel', 'retry_review'])}).strict();
export const DeliverySnapshot = z.object({revision: z.number().int().nonnegative(), offer: GoalOffer, offer_sha256: Digest,
  conversation_id: z.string().uuid().nullable(), delivery_id: z.string().uuid().nullable(),
  cancellation: z.enum(['none', 'requested', 'acknowledged']), command_ids: z.array(z.string().uuid()),
  stage: z.discriminatedUnion('kind', [
    z.object({kind: z.literal('awaiting_approval')}).strict(),
    z.object({kind: z.literal('rejected')}).strict(),
    z.object({kind: z.literal('authoring')}).strict(),
    z.object({kind: z.literal('reviewing'), candidate: Candidate}).strict(),
    z.object({kind: z.literal('publishing'), candidate: Candidate, review: Review}).strict(),
    z.object({kind: z.literal('changes_requested'), candidate: Candidate, review: Review}).strict(),
    z.object({kind: z.literal('draft_ready'), candidate: Candidate, review: Review, draft: Draft}).strict(),
    z.object({kind: z.literal('blocked'), reason: z.string()}).strict(),
    z.object({kind: z.literal('uncertain'), reason: z.string()}).strict(),
    z.object({kind: z.literal('cancelled'), reason: z.string()}).strict(),
  ]),
}).strict();
export type DeliveryCommand = z.infer<typeof DeliveryCommand>;
export type DeliverySnapshot = z.infer<typeof DeliverySnapshot>;
