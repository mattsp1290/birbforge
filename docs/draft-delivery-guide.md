# Follow an approved goal to a draft PR

Forge's **BIRBFORGE / PRIVATE PILOT** lets you approve one installed goal
and follow its delivery on your phone or Mac browser. Preparing the goal record
does not approve execution. Publication must remain a draft PR.

## Open and inspect the goal

Use your authorized **Private endpoint** and **Owner credential**. Choose
**Find my conversations**, select the existing conversation, then choose
**Continue conversation**. Alternatively, enter its **Conversation identity**.
Use **New conversation** only when you need the initial conversation, not to
restart a delivery. Credentials remain in memory, not browser local storage;
re-enter yours when returning after sign-out or reload.

Read the goal title and full text, **Repository**, **Allowed changes**, and
**Base** commit. For this documentation goal, the sole allowed changed path is
`docs/draft-delivery-guide.md`. Check that the installed offer matches your
intended scope before authorizing it.

The offer is immutable: approval binds its digest, repository, base commit,
allowed paths, acceptance policy, owner, and conversation. The panel does not
display every policy or digest field; resolve any uncertainty about the
installed policy with the operator before approving. There is no inline goal
editor. A changed goal requires a new explicitly reviewed installation, not a
second submission of this one.

At **awaiting approval**, choose **Approve goal and start** to authorize one
coding job and an independent Claude review, or **Reject goal** to decline.
Neither choice authorizes merge or deployment. If the panel says **Continue
the owning conversation**, return to the displayed identity; another
conversation cannot take over approval.

## Read the shared delivery status

**Conversation** / **Goal conversation** and **Inbox (1)** / **Your decision
inbox** show the same delivery snapshot. The inbox count becomes **Inbox (0)**
after the approval decision; zero does not mean the work is finished.

Read the delivery card's stage and **connected** or **offline** indicator,
not just the connection status near the conversation identity:

| Stage | Meaning |
| --- | --- |
| **awaiting approval** | Execution has not been authorized. |
| **authoring** | The approved coding and acceptance work is underway. |
| **reviewing** | Independent Claude review is underway for the displayed candidate. |
| **publishing** | Review approved that candidate; draft publication is underway. |
| **draft ready** | The approved coding and review path completed, and a draft receipt is recorded. |
| **changes requested** | Read the independent review summary; this candidate did not pass the publication gate. |
| **blocked**, **uncertain** | Read the reason and seek operator investigation. Neither is success. |
| **rejected**, **cancelled** | The offer was declined or cancellation was confirmed. |

## Reconnect without resubmitting

Choose **Reconnect**, or reopen the same conversation identity with the same
owner credential on your other device. Reconnection observes durable state;
it does not submit the goal or approve it again. **Disconnect**, closing the
browser, or losing connectivity does not cancel the job.

If you see **Acknowledgement unknown. Retry the unchanged action or reconnect
to reconcile.**, reconnect first to inspect the recorded decision. If still
pending, **Retry unchanged delivery action** reuses the original command rather
than creating a new approval or cancellation. **Action recorded.** confirms
the command receipt, not completion of delivery. After **Action rejected.
Reconnect to inspect the current decision.**, inspect current state rather
than trying to bypass it.

## Cancellation, blocked work, and uncertainty

During authoring, reviewing, or publishing, use **Request cancellation**.
**Cancellation · requested** is not proof that the worker stopped. Wait for
confirmed cancellation; a timeout, missing reply, or disconnected observer
does not establish termination. Cancellation can race publication: a draft
may already exist, and a recorded draft receipt remains visible.

For **blocked**, **uncertain**, or **changes requested**, retain the conversation
identity, displayed reason, and any candidate/review details. Ask the delivery
operator to investigate the recorded execution, review, and publication
receipts, including whether a draft already exists. Do not submit another
goal, infer that work stopped, or treat uncertainty as permission to publish.
There is no owner-facing resume or override control for these outcomes.

## Check the exact reviewed candidate

Read the full commit under **Candidate**, then **Independent review · approved**
and its summary. Choose **Open draft PR #N** and compare the PR's head commit
with that candidate. The workflow requires Claude's review receipt to name
the exact candidate commit and the publication receipt to match its repository
and commit. A later PR commit is not covered by that approval.

**Draft-ready is not staging or native candidate verification, approval to
merge, or production deployment.** The card explicitly says **Staging and
native candidate verification have not run.** Keep the PR in draft; any later
verification, merge, or deployment needs its own applicable evidence and
authorization.

References: [delivery contract and operation](persistent-delivery.md),
[delivery UI](../app/src/DeliveryPanel.tsx),
[conversation UI](../app/App.tsx), and
[receipt binding](../delivery/workflow.py).
