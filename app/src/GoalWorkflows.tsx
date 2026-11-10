import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {AccessibilityInfo, AppState, Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {recentConversations} from './access';
import {ConversationClient} from './controller';
import {DeliveryPanel} from './DeliveryPanel';
import {Action, Body, Card, Field, Heading, useUI, type Session} from './ui';
import {ProjectClient} from './projects';
import {pendingChatStore} from './chat-pending';
import {transport} from './transport';
import type {Choice} from './contract';
import type {VerificationClient} from './verification';
import type {VerificationRequest} from './verification-contract';

function Button({label, onPress, disabled = false, selected = false}: {label: string; onPress: () => void; disabled?: boolean; selected?: boolean}) {
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled, selected}}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    disabled={disabled} onPress={onPress} style={({pressed}) => [styles.button, disabled && styles.disabled, pressed && styles.pressed, focused && styles.focused]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
function VerificationRow({row, client, large}: {row: VerificationRequest; client: VerificationClient; large: boolean}) {
  const styles = useStyles();
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [details, setDetails] = useState(false);
  const cancellable = ['queued', 'dispatching', 'running'].includes(row.phase) && row.cancellation === 'none';
  const observed = state.availability === 'available' && state.connection === 'connected';
  return <View testID="verification-request" style={styles.card}>
    <Text style={styles.label}>VERIFICATION REQUEST · {row.phase.replaceAll('_', ' ')}</Text>
    <Text testID="verification-outcome" style={[styles.body, large && styles.large]}>Outcome · {row.outcome ?? 'Not recorded'}</Text>
    <Text testID="verification-eligibility" style={observed && row.eligibility.eligible ? styles.status : styles.notice}>{observed
      ? `${row.eligibility.eligible ? 'Evidence complete · eligible' : 'Not eligible'} · ${row.eligibility.reason.replaceAll('_', ' ')}`
      : 'Historical evidence · refresh to check eligibility'}</Text>
    <Text style={styles.muted}>Eligibility concerns verification evidence. It grants no merge approval.</Text>
    <Text selectable style={styles.identity}>Request {row.request_id}</Text>
    <Text selectable style={styles.identity}>Attempt {row.attempt_id ?? (row.closure && row.closure.kind !== 'absent' && row.closure.acquisition.kind === 'never_acquired' ? 'Never acquired · target confirmed' : 'Not recorded')}</Text>
    <Text style={styles.muted}>Cancellation · {row.cancellation.replaceAll('_', ' ')} · revision {row.revision}</Text>
    <Text style={styles.muted}>Candidate {row.candidate_commit.slice(0, 12)} · plan {row.plan_sha256.slice(0, 12)} · {row.manifest ? 'Recorded manifest' : 'No recorded manifest'}</Text>
    {row.closure && row.closure.kind !== 'absent' && <View testID="verification-closure" style={styles.details}>
      <Text style={styles.label}>{row.closure.kind === 'released' ? 'REQUEST CLOSED' : 'REQUEST CLOSURE PENDING'}</Text>
      <Text style={styles.muted}>{row.closure.acquisition.kind === 'never_acquired' ? 'Target confirmed no execution acquired.'
        : row.closure.kind === 'released' ? 'Execution stop and cleanup recorded.' : 'Waiting for target-confirmed stop and cleanup.'}</Text>
      {row.closure.kind === 'released' ? <>
        <Text testID="closure-proof" style={styles.notice}>Retained closure proof · {observed ? row.closure.proof : 'refresh required'}</Text>
        <Text style={styles.muted}>{row.closure.history.manifest_status === 'present' ? 'Original verification history preserved.' : 'No verification manifest was recorded. Closure grants no eligibility.'}</Text>
      </> : <Text style={styles.notice}>{row.closure.blocking_reason?.replaceAll('_', ' ') ?? row.closure.phase.replaceAll('_', ' ')}</Text>}
      <Text selectable style={styles.identity}>Closure {row.closure.closure_id} · execution epoch {row.closure.execution_epoch}</Text>
      <Text style={styles.muted}>Historical closure does not describe current environment ownership.</Text>
    </View>}
    <View style={styles.row}>
      <Button label={details ? 'Hide verification identities' : 'Show verification identities'} selected={details} onPress={() => setDetails(!details)} />
      {cancellable && <Button label="Cancel verification request" disabled={state.sending || !!state.pending || state.availability !== 'available'} onPress={() => {
        void client.cancel({requestId: row.request_id, commandId: randomUUID()}).catch(() => {});
      }} />}
    </View>
    {details && <View style={styles.details}>
      <Text selectable style={styles.identity}>Candidate commit {row.candidate_commit}</Text>
      <Text selectable style={styles.identity}>Approved plan SHA-256 {row.plan_sha256}</Text>
      <Text selectable style={styles.identity}>Request SHA-256 {row.request_sha256}</Text>
      <Text selectable style={styles.identity}>Idempotency key {row.idempotency_key}</Text>
      {row.cancellation_command_ids.map(id => <Text selectable key={id} style={styles.identity}>Accepted cancellation {id}</Text>)}
    </View>}
  </View>;
}
function VerificationPanel({client, large}: {client: VerificationClient; large: boolean}) {
  const styles = useStyles();
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [details, setDetails] = useState(false);
  if (state.availability === 'disabled' && !state.pending) return null;
  const snapshot = state.snapshot;
  return <View testID="verification-panel" style={styles.verification}>
    <Text accessibilityRole="header" style={styles.heading}>Fixture verification</Text>
    <Text style={styles.muted}>Verify the installed candidate against its approved plan. Requests and outcomes stay together in both views.</Text>
    <View style={styles.card}>
      <Text testID="verification-connection" style={styles.status}>{state.availability} · {state.connection} · revision {snapshot?.revision ?? 0}</Text>
      {snapshot && <>
        <Text testID="verification-environment" style={[styles.body, large && styles.large]}>Environment · {snapshot.environment.state}</Text>
        {snapshot.target_revision === undefined ? <Text style={styles.muted}>Worker {snapshot.environment.stopped ? 'stopped' : 'stop not confirmed'} · cleanup {snapshot.environment.cleanup_complete ? 'complete' : 'not confirmed'}</Text>
          : <Text style={styles.muted}>Target revision {snapshot.target_revision}. Stop and cleanup evidence belongs to each request.</Text>}
        <Text selectable style={styles.identity}>Environment attempt {snapshot.environment.attempt_id ?? 'None'}</Text>
        <Text style={styles.muted}>Environment availability is separate from the request outcome.</Text>
        <Text style={styles.label}>INSTALLED SOURCE</Text>
        <Text style={styles.muted}>Candidate {snapshot.installed.candidate_commit.slice(0, 12)} · plan {snapshot.installed.approved_plan_sha256.slice(0, 12)}</Text>
        <Button label={details ? 'Hide installed source identities' : 'Show installed source identities'} selected={details} onPress={() => setDetails(!details)} />
        {details && <View style={styles.details}>
          <Text selectable style={styles.identity}>Candidate commit {snapshot.installed.candidate_commit}</Text>
          <Text selectable style={styles.identity}>Approved plan SHA-256 {snapshot.installed.approved_plan_sha256}</Text>
          <Text selectable style={styles.identity}>Policy revision {snapshot.installed.policy_revision}</Text>
        </View>}
      </>}
      <View style={styles.row}>
        <Button label="Refresh verification" disabled={state.sending} onPress={() => {void client.refresh().catch(() => {});}} />
        <Button label="Request verification" disabled={state.sending || !!state.pending || state.availability !== 'available' || !snapshot} onPress={() => {
          void client.admit({requestId: randomUUID(), idempotencyKey: randomUUID()}).catch(() => {});
        }} />
      </View>
      {state.pending && <View style={styles.details}>
        <Text style={styles.notice}>{state.pending.kind === 'admission' ? 'Verification request' : 'Verification cancellation'} acknowledgement pending.</Text>
        <Text selectable style={styles.identity}>Request {state.pending.body.request_id}</Text>
        <Button label="Refresh and retry same verification action" disabled={state.sending} onPress={() => {void client.retry().catch(() => {});}} />
      </View>}
      {!!state.notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>}
      {snapshot?.requests.some(row => row.phase === 'uncertain') && <Text accessibilityLiveRegion="polite" style={styles.notice}>Queue paused while execution is uncertain. Host investigation is required. A free environment alone does not resume dispatch.</Text>}
    </View>
    {snapshot?.requests.length === 0 && <Text style={styles.muted}>No verification requests yet.</Text>}
    {snapshot?.requests.map(row => <VerificationRow key={row.request_id} row={row} client={client} large={large} />)}
    {!!snapshot?.recoveries.length && <View style={styles.card}>
      <Text style={styles.label}>ENVIRONMENT RECOVERY HISTORY</Text>
      {snapshot.recoveries.map(recovery => <View key={recovery.recovery_id} style={styles.details}>
        <Text style={styles.body}>Recovery completed · {recovery.completed_at}</Text>
        <Text style={styles.muted}>Worker stopped and attempt container absent. Earlier outcomes remain recorded.</Text>
        <Text selectable style={styles.identity}>Request {recovery.request_id}</Text>
        <Text selectable style={styles.identity}>Attempt {recovery.attempt_id}</Text>
        <Text selectable style={styles.identity}>Recovery {recovery.recovery_id}</Text>
        <Text selectable style={styles.identity}>Manifest SHA-256 {recovery.manifest_sha256}</Text>
      </View>)}
    </View>}
  </View>;
}
export function GoalConversation({client, leave}: {client: ConversationClient; leave: () => void}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const delivery = useSyncExternalStore(client.delivery.subscribe, client.delivery.getSnapshot);
  const [surface, setSurface] = useState<'conversation' | 'inbox'>('conversation');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const {largeText: large} = useUI();
  const styles = useStyles();
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', phase => {
      if (phase === 'active') void client.connect();
      else client.disconnect();
    });
    return () => {subscription.remove(); client.disconnect();};
  }, [client]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const offline = () => client.disconnect();
    const online = () => {void client.connect();};
    globalThis.addEventListener('offline', offline);
    globalThis.addEventListener('online', online);
    return () => {
      globalThis.removeEventListener('offline', offline);
      globalThis.removeEventListener('online', online);
    };
  }, [client]);
  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); }
    catch {}
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (Platform.OS === 'ios' && state.notice) AccessibilityInfo.announceForAccessibility(state.notice);
  }, [state.notice]);
  const snapshot = state.conversation;
  const pilot = snapshot?.mode === 'approved-goal';
  const projectChat = snapshot?.kind === 'project';
  const [projectStatus, setProjectStatus] = useState('');
  useEffect(() => {
    let active = true;
    const context = snapshot?.project_context;
    const check = () => {
      if (context) void new ProjectClient(client.url, client.access).get(context.project_id).then(current => {
        if (active) setProjectStatus(current.archived ? 'This project was removed from active use. History is preserved.' : current.revision !== context.project_revision ? 'This project has changed. This chat keeps its historical context. Start a new project chat to use current membership.' : 'This chat uses the current project revision.');
      }).catch(() => {if (active) setProjectStatus('Current project status unavailable. Historical context is preserved.');});
    };
    check();
    const timer = context ? setInterval(check, 15_000) : null;
    return () => {active = false; if (timer) clearInterval(timer);};
  }, [client, snapshot?.project_context?.project_revision]);
  const request = snapshot?.human;
  const terminal = snapshot?.phase === 'cancelled' || snapshot?.phase === 'failed';
  const decide = (choice: Choice) => {
    if (request) void act(() => client.resolve({request_id: request.id, version: request.version, choice}));
  };
  return <View style={{gap: 14}}>
    <Text style={styles.eyebrow}>{projectChat ? 'BIRBFORGE / PROJECT CHAT' : pilot ? 'BIRBFORGE / PRIVATE PILOT' : 'BIRBFORGE / LOCAL PROOF'}</Text>
    {projectChat && <Text accessibilityRole="header" style={styles.title}>{snapshot.project_context?.project_name}</Text>}
    <Text style={styles.muted}>{projectChat ? 'Discuss your project using versioned repository sources and scoped notes.' : pilot ? 'Approve one goal. Follow its reviewed draft PR across devices.' : 'A synthetic coding decision. No merge or production authority.'}</Text>
    <View style={styles.card}>
      <Text style={styles.label}>Conversation identity</Text>
      <Text testID="conversation-id" selectable style={styles.identity}>{client.id}</Text>
      <Text style={styles.muted}>{client.access.kind === 'private-single-owner' ? 'Open this identity on your other device through your private network.' : 'Open this identity on your other device with the same owner credential.'}</Text>
      <Text testID="connection" style={styles.status}>{state.connection} · {snapshot?.phase ?? 'loading'} · revision {snapshot?.revision ?? 0}</Text>
      <View style={styles.row}>
        <Button label="Reconnect" onPress={() => void client.connect()} />
        <Button label="Disconnect" onPress={() => client.disconnect()} />
        <Button label={projectChat ? 'Back to project' : client.access.kind === 'private-single-owner' ? 'Back to conversations' : 'Close goal'} onPress={() => {client.disconnect(); leave();}} />
      </View>
    </View>
    {projectChat && <View style={styles.card}>
      <Text style={styles.notice}>{projectStatus}</Text>
      <Text selectable style={styles.identity}>Project {snapshot.project_context?.project_id} · revision {snapshot.project_context?.project_revision}</Text>
      {snapshot.project_context?.repositories.map(repo => <Text key={repo.repository_id} selectable style={styles.muted}>{repo.full_name} · {repo.commit}</Text>)}
      {snapshot.project_context?.sources.map(source => <Text key={`${source.repository_id}/${source.path}`} selectable style={styles.muted}>Source {source.repository_id}/{source.path} · {source.sha256.slice(0, 12)}</Text>)}
      {snapshot.project_context?.unavailable_sources.map(source => <Text key={`gap/${source.repository_id}/${source.path}`} style={styles.muted}>Unavailable source {source.repository_id}/{source.path} · {source.reason.replaceAll('_', ' ')}</Text>)}
      <Text style={styles.muted}>Only the displayed frozen files and notes are available in this chat. Create a new chat to adopt changed membership. Implementation requires a separately prepared scope and explicit approval.</Text>
    </View>}
    {!projectChat && <View style={styles.row}>
      <Button label="Conversation" selected={surface === 'conversation'} onPress={() => setSurface('conversation')} />
      <Button label={`Inbox (${pilot ? delivery.snapshot?.stage.kind === 'awaiting_approval' ? 1 : 0 : request ? 1 : 0})`} selected={surface === 'inbox'} onPress={() => setSurface('inbox')} />
    </View>}
    <Text accessibilityRole="header" style={styles.heading}>{projectChat ? 'Project conversation' : surface === 'conversation' ? 'Goal conversation' : 'Your decision inbox'}</Text>
    {!pilot && surface === 'conversation' && <>
      {!projectChat && snapshot?.inputs.map(input => <View key={input.request_id} style={styles.card}>
        <Text style={styles.label}>YOUR GOAL · {input.outcome}</Text>
        <Text style={styles.muted}>{input.text}</Text>
      </View>)}
      {state.messages.map(message => <View key={message.id} style={styles.message}>
        <Text style={styles.label}>{message.role}</Text>
        <Text selectable style={[styles.body, large && styles.large]}>{message.role === 'tool' ? 'Fixture step completed.' : 'content' in message && typeof message.content === 'string' ? message.content : 'Coworker activity'}</Text>
        {'toolCalls' in message && message.toolCalls?.map(tool => <Text key={tool.id} style={styles.muted}>{tool.function.name === 'choose_next_step' ? 'Waiting for your next step' : 'Recording a synthetic work item'}</Text>)}
      </View>)}
      {!snapshot?.inputs.length && <Text style={styles.muted}>{projectChat ? 'Ask a project question below.' : 'Begin a goal below. The coworker will ask for one next step.'}</Text>}
    </>}
    {!pilot && !projectChat && (request ? <View testID="decision-card" style={styles.decision}>
      <Text style={styles.eyebrow}>YOUR INPUT IS NEEDED</Text>
      <Text accessibilityRole="header" style={[styles.heading, large && styles.large]}>What should the coworker do next?</Text>
      <Text style={[styles.body, large && styles.large]}>Choose a synthetic next step for this coding fixture.</Text>
      <Text selectable style={styles.muted}>Request {request.id} · version {request.version}</Text>
      <View style={styles.row}>
        <Button label="Inspect fixture" disabled={busy || terminal} onPress={() => decide('inspect')} />
        <Button label="Test fixture" disabled={busy || terminal} onPress={() => decide('test')} />
      </View>
    </View> : <View style={styles.card}><Text style={styles.body}>{snapshot?.decisions.length ? `Decision recorded · ${snapshot.decisions.at(-1)?.resolution}` : 'No pending input.'}</Text></View>)}
    {pilot ? <DeliveryPanel client={client.delivery} conversationId={client.id} /> : projectChat ? null : <VerificationPanel client={client.verification} large={large} />}
    <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>
    {!!snapshot?.failure && <Text accessibilityLiveRegion="polite" style={styles.notice}>{snapshot.failure.replaceAll('_', ' ')}</Text>}
    {!pilot && surface === 'conversation' && <View style={styles.card}>
      <Text style={styles.label}>{projectChat ? 'Message your project assistant' : 'A goal for your coworker'}</Text>
      <TextInput accessibilityLabel={projectChat ? 'Project message' : 'Goal'} placeholder={projectChat ? 'Ask about the project or discuss a change' : 'Describe the synthetic coding task'} placeholderTextColor="#99a6a3"
        value={state.pendingPrompt?.text ?? goal} onChangeText={setGoal} multiline editable={!state.pendingPrompt && !busy && !terminal}
        style={[styles.input, styles.body, large && styles.large]} />
      <Button label={projectChat ? state.pendingPrompt ? 'Retry same message' : 'Send message' : state.pendingPrompt ? 'Retry same goal' : 'Send goal'} disabled={busy || terminal || !snapshot || (!state.pendingPrompt && (!goal.trim() || (!projectChat && snapshot.inputs.length >= 4) || snapshot.phase !== 'idle'))}
        onPress={() => void act(async () => {
          await client.submit(state.pendingPrompt ?? {request_id: randomUUID(), text: goal}); setGoal('');
        })} />
      <Text style={styles.muted}>{projectChat ? `${snapshot?.inputs.length ?? 0} messages sent. Reconnect observes finalized history without resending.` : `${snapshot?.inputs.length ?? 0} of 4 inputs used. Reconnect never sends a goal.`}</Text>
    </View>}
    {!pilot && <Text style={styles.muted}>{projectChat ? 'Project notes' : 'Fixture context'} · {snapshot?.context.project ?? 'loading'} · {snapshot?.context.notes.map(note => note.key).join(', ')}</Text>}
    {!pilot && !terminal && <Button label={confirmCancel ? 'Confirm cancel conversation' : 'Cancel conversation'} disabled={busy}
      onPress={() => confirmCancel ? void act(() => client.cancel()) : setConfirmCancel(true)} />}
  </View>;
}

const row = {flexDirection: 'row', flexWrap: 'wrap', gap: 8} as const;
export function GoalWorkflows({session, queueId}: {session: Session; queueId?: string}) {
  const [id, setId] = useState('');
  const [pending, setPending] = useState('');
  const [client, setClient] = useState<ConversationClient | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const live = React.useRef(true);
  useEffect(() => {live.current = true; return () => {live.current = false;};}, []);
  const [conversations, setConversations] = useState<{id: string; revision: number}[]>([]);
  const [notice, setNotice] = useState('');
  const {endpoint, access} = session;
  async function listConversations() {
    if (!access) return;
    setBusy(true); setNotice('');
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      setConversations(await recentConversations(endpoint, access, transport, abort.signal));
    } catch {setNotice('Could not list conversations. Check your connection and access.');}
    finally {clearTimeout(timeout); setBusy(false);}
  }
  useEffect(() => {
    if (access.kind === 'private-single-owner' && !client) void listConversations();
  }, [endpoint, access, client]);
  async function open(create: boolean, selectedId?: string) {
    setBusy(true); setError('');
    const cid = create ? pending || randomUUID() : selectedId ?? id.trim();
    if (create) {setPending(cid); setId(cid);}
    const next = new ConversationClient(session.endpoint, session.access, cid, transport, pendingChatStore(session.endpoint, cid));
    try {
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(cid)) throw new Error();
      if (create) await next.create();
      else {await next.refresh(); await next.connect();}
      if (!live.current) {next.disconnect(); return;}
      setClient(next); setPending('');
    } catch {next.disconnect(); setError('Could not open this goal. Check the conversation identity and runtime status.');}
    finally {setBusy(false);}
  }
  if (client) return <GoalConversation client={client} leave={() => setClient(null)} />;
  return <Card>
    <Heading>Goal workflows</Heading>
    <Body muted>Start a goal or reopen its conversation and decision inbox.</Body>
    <View style={row}>
      <Action secondary label={pending ? 'Retry new conversation' : 'New conversation'} disabled={busy} onPress={() => void open(true)} />
      {queueId && <Action secondary label="Open verification queue" disabled={busy} onPress={() => void open(false, queueId)} />}
    </View>
    <Action secondary label="Find my conversations" disabled={busy} onPress={() => void listConversations()} />
    {conversations.map(conversation => <Action key={conversation.id} secondary label={`Open conversation ${conversation.id.slice(0, 8)}`}
      disabled={busy} onPress={() => void open(false, conversation.id)} />)}
    {notice && <Body>{notice}</Body>}
    <Field label="Conversation identity" value={id} onChangeText={setId} />
    <Action secondary label="Continue conversation" disabled={!id.trim() || busy} onPress={() => void open(false)} />
    {error && <Body>{error}</Body>}
  </Card>;
}

function useStyles() {
  const {colors} = useUI();
  return useMemo(() => StyleSheet.create({
    eyebrow: {color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 2},
    title: {color: colors.text, fontSize: 38, lineHeight: 46, fontWeight: '700'},
    heading: {color: colors.text, fontSize: 23, fontWeight: '600'},
    body: {color: colors.text, fontSize: 17, lineHeight: 27},
    large: {fontSize: 26, lineHeight: 38},
    muted: {color: colors.muted, fontSize: 14, lineHeight: 22},
    label: {color: colors.accent, fontSize: 13, fontWeight: '600'},
    identity: {color: colors.text, fontSize: 15, lineHeight: 24},
    card: {backgroundColor: colors.panel, padding: 20, borderRadius: 16, gap: 12, borderColor: colors.line, borderWidth: 1},
    verification: {gap: 16},
    details: {gap: 10},
    message: {borderLeftColor: '#5a8a76', borderLeftWidth: 2, paddingLeft: 18, gap: 8},
    decision: {backgroundColor: colors.tint, borderColor: colors.accent, borderWidth: 1, padding: 22, borderRadius: 16, gap: 16},
    status: {color: colors.accent, fontSize: 14},
    notice: {color: colors.text, fontSize: 16, lineHeight: 25},
    row: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
    button: {minHeight: 48, paddingHorizontal: 18, paddingVertical: 13, backgroundColor: colors.accent, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
    buttonText: {color: colors.onAccent, fontSize: 16, fontWeight: '600'},
    focused: {outlineColor: colors.text, outlineWidth: 3, outlineStyle: 'solid'},
    disabled: {opacity: 0.45}, pressed: {opacity: 0.75},
    input: {color: colors.text, borderColor: '#78998a', borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 17, minHeight: 52, backgroundColor: colors.bg},
  }), [colors]);
}
