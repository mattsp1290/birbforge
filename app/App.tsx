import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {AccessibilityInfo, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {ConversationClient} from './src/controller';
import {transport} from './src/transport';
import type {Choice} from './src/contract';
import type {VerificationClient} from './src/verification';
import type {VerificationRequest} from './src/verification-contract';

function Button({label, onPress, disabled = false, selected = false}: {label: string; onPress: () => void; disabled?: boolean; selected?: boolean}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled, selected}}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    disabled={disabled} onPress={onPress} style={({pressed}) => [styles.button, disabled && styles.disabled, pressed && styles.pressed, focused && styles.focused]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
function VerificationRow({row, client, large}: {row: VerificationRequest; client: VerificationClient; large: boolean}) {
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
    <Text selectable style={styles.identity}>Attempt {row.attempt_id ?? 'Not acquired'}</Text>
    <Text style={styles.muted}>Cancellation · {row.cancellation.replaceAll('_', ' ')} · revision {row.revision}</Text>
    <Text style={styles.muted}>Candidate {row.candidate_commit.slice(0, 12)} · plan {row.plan_sha256.slice(0, 12)} · {row.manifest ? 'Recorded manifest' : 'No recorded manifest'}</Text>
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
        <Text style={styles.muted}>Worker {snapshot.environment.stopped ? 'stopped' : 'stop not confirmed'} · cleanup {snapshot.environment.cleanup_complete ? 'complete' : 'not confirmed'}</Text>
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
function Workspace({client, leave}: {client: ConversationClient; leave: () => void}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [surface, setSurface] = useState<'conversation' | 'inbox'>('conversation');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [large, setLarge] = useState(false);
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
  const request = snapshot?.human;
  const terminal = snapshot?.phase === 'cancelled' || snapshot?.phase === 'failed';
  const decide = (choice: Choice) => {
    if (request) void act(() => client.resolve({request_id: request.id, version: request.version, choice}));
  };
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>BIRBFORGE / LOCAL PROOF</Text>
    <Text accessibilityRole="header" style={styles.title}>One goal. Wherever you are.</Text>
    <Text style={styles.muted}>A synthetic coding decision. No merge or production authority.</Text>
    <View style={styles.card}>
      <Text style={styles.label}>Conversation identity</Text>
      <Text testID="conversation-id" selectable style={styles.identity}>{client.id}</Text>
      <Text style={styles.muted}>Open this identity on your other device with the same owner credential.</Text>
      <Text testID="connection" style={styles.status}>{state.connection} · {snapshot?.phase ?? 'loading'} · revision {snapshot?.revision ?? 0}</Text>
      <View style={styles.row}>
        <Button label="Reconnect" onPress={() => void client.connect()} />
        <Button label="Disconnect" onPress={() => client.disconnect()} />
        <Button label={large ? 'Standard text' : 'Large text'} selected={large} onPress={() => setLarge(!large)} />
        <Button label="Sign out" onPress={() => {client.disconnect(); leave();}} />
      </View>
    </View>
    <View style={styles.row}>
      <Button label="Conversation" selected={surface === 'conversation'} onPress={() => setSurface('conversation')} />
      <Button label={`Inbox (${request ? 1 : 0})`} selected={surface === 'inbox'} onPress={() => setSurface('inbox')} />
    </View>
    <Text accessibilityRole="header" style={styles.heading}>{surface === 'conversation' ? 'Goal conversation' : 'Your decision inbox'}</Text>
    {surface === 'conversation' && <>
      {snapshot?.inputs.map(input => <View key={input.request_id} style={styles.card}>
        <Text style={styles.label}>YOUR GOAL · {input.outcome}</Text>
        <Text style={styles.muted}>Goal accepted by the coworker.</Text>
      </View>)}
      {state.messages.map(message => <View key={message.id} style={styles.message}>
        <Text style={styles.label}>{message.role}</Text>
        <Text selectable style={[styles.body, large && styles.large]}>{message.role === 'tool' ? 'Fixture step completed.' : 'content' in message && typeof message.content === 'string' ? message.content : 'Coworker activity'}</Text>
        {'toolCalls' in message && message.toolCalls?.map(tool => <Text key={tool.id} style={styles.muted}>{tool.function.name === 'choose_next_step' ? 'Waiting for your next step' : 'Recording a synthetic work item'}</Text>)}
      </View>)}
      {!snapshot?.inputs.length && <Text style={styles.muted}>Begin a goal below. The coworker will ask for one next step.</Text>}
    </>}
    {request ? <View testID="decision-card" style={styles.decision}>
      <Text style={styles.eyebrow}>YOUR INPUT IS NEEDED</Text>
      <Text accessibilityRole="header" style={[styles.heading, large && styles.large]}>What should the coworker do next?</Text>
      <Text style={[styles.body, large && styles.large]}>Choose a synthetic next step for this coding fixture.</Text>
      <Text selectable style={styles.muted}>Request {request.id} · version {request.version}</Text>
      <View style={styles.row}>
        <Button label="Inspect fixture" disabled={busy || terminal} onPress={() => decide('inspect')} />
        <Button label="Test fixture" disabled={busy || terminal} onPress={() => decide('test')} />
      </View>
    </View> : <View style={styles.card}><Text style={styles.body}>{snapshot?.decisions.length ? `Decision recorded · ${snapshot.decisions.at(-1)?.resolution}` : 'No pending input.'}</Text></View>}
    <VerificationPanel client={client.verification} large={large} />
    <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>
    {surface === 'conversation' && <View style={styles.card}>
      <Text style={styles.label}>A goal for your coworker</Text>
      <TextInput accessibilityLabel="Goal" placeholder="Describe the synthetic coding task" placeholderTextColor="#99a6a3"
        value={state.pendingPrompt?.text ?? goal} onChangeText={setGoal} multiline editable={!state.pendingPrompt && !busy && !terminal}
        style={[styles.input, styles.body, large && styles.large]} />
      <Button label={state.pendingPrompt ? 'Retry same goal' : 'Send goal'} disabled={busy || terminal || !snapshot || (!state.pendingPrompt && (!goal.trim() || snapshot.inputs.length >= 4 || snapshot.phase !== 'idle'))}
        onPress={() => void act(async () => {
          await client.submit(state.pendingPrompt ?? {request_id: randomUUID(), text: goal}); setGoal('');
        })} />
      <Text style={styles.muted}>{snapshot?.inputs.length ?? 0} of 4 inputs used. Reconnect never sends a goal.</Text>
    </View>}
    <Text style={styles.muted}>Fixture context · {snapshot?.context.project ?? 'loading'} · {snapshot?.context.notes.map(note => note.key).join(', ')}</Text>
    {!terminal && <Button label={confirmCancel ? 'Confirm cancel conversation' : 'Cancel conversation'} disabled={busy}
      onPress={() => confirmCancel ? void act(() => client.cancel()) : setConfirmCancel(true)} />}
  </ScrollView>;
}
export default function App() {
  const [endpoint, setEndpoint] = useState(Platform.OS === 'web' ? globalThis.location?.origin ?? 'http://127.0.0.1:8787' : 'http://127.0.0.1:8787');
  const [token, setToken] = useState('');
  const [id, setId] = useState('');
  const [client, setClient] = useState<ConversationClient | null>(null);
  const [pendingCreateId, setPendingCreateId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function open(create: boolean) {
    setBusy(true); setNotice('');
    let next: ConversationClient | null = null;
    try {
      const base = new URL(endpoint);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid endpoint');
      const conversationId = create ? pendingCreateId ?? randomUUID() : id.trim();
      if (create) {setPendingCreateId(conversationId); setId(conversationId);}
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(conversationId)) throw new Error('Invalid identity');
      next = new ConversationClient(base.origin, token.trim(), conversationId, transport);
      if (create) await next.create();
      else { await next.refresh(); await next.connect(); }
      setClient(next); setToken(''); setPendingCreateId(null);
    } catch { next?.disconnect(); setNotice('Could not open this conversation. Check the endpoint, credential, and identity.'); }
    finally { setBusy(false); }
  }
  return <View style={styles.root}>{client ? <Workspace client={client} leave={() => setClient(null)} /> :
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>BIRBFORGE</Text>
      <Text accessibilityRole="header" style={styles.title}>Pick up the conversation.</Text>
      <Text style={styles.body}>Your goal and pending decisions stay together across devices.</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Private development endpoint</Text>
        <TextInput accessibilityLabel="Endpoint" autoCapitalize="none" autoCorrect={false} value={endpoint} onChangeText={setEndpoint} style={styles.input} />
        <Text style={styles.label}>Owner test credential</Text>
        <TextInput accessibilityLabel="Owner test credential" secureTextEntry autoCapitalize="none" autoCorrect={false} value={token} onChangeText={setToken} style={styles.input} />
        <Button label={pendingCreateId ? "Retry new conversation" : "New conversation"} disabled={busy || !token.trim()} onPress={() => void open(true)} />
        <Text style={styles.label}>Or continue a conversation identity</Text>
        <TextInput accessibilityLabel="Conversation identity" autoCapitalize="none" autoCorrect={false} value={id} onChangeText={setId} style={styles.input} />
        <Button label="Continue conversation" disabled={busy || !token.trim() || !id.trim()} onPress={() => void open(false)} />
      </View>
      <Text style={styles.notice}>{notice}</Text>
      <Text style={styles.muted}>Disposable local proof. Credentials remain in memory until sign-out. Use only existing authorized private access.</Text>
    </ScrollView>}</View>;
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0b1515'},
  page: {padding: 24, paddingTop: Platform.OS === 'ios' ? 60 : 32, gap: 20, maxWidth: 850, width: '100%', alignSelf: 'center', paddingBottom: 60},
  eyebrow: {color: '#a4dfc4', fontSize: 12, fontWeight: '700', letterSpacing: 2},
  title: {color: '#f1f6ed', fontSize: 38, lineHeight: 46, fontWeight: '700'},
  heading: {color: '#f1f6ed', fontSize: 23, fontWeight: '600'},
  body: {color: '#e2eee7', fontSize: 17, lineHeight: 27},
  large: {fontSize: 26, lineHeight: 38},
  muted: {color: '#b4c7c0', fontSize: 14, lineHeight: 22},
  label: {color: '#a4dfc4', fontSize: 13, fontWeight: '600'},
  identity: {color: '#f1f6ed', fontSize: 15, lineHeight: 24},
  card: {backgroundColor: '#142222', padding: 20, borderRadius: 16, gap: 12, borderColor: '#30453f', borderWidth: 1},
  verification: {gap: 16},
  details: {gap: 10},
  message: {borderLeftColor: '#5a8a76', borderLeftWidth: 2, paddingLeft: 18, gap: 8},
  decision: {backgroundColor: '#1b3029', borderColor: '#83b99e', borderWidth: 1, padding: 22, borderRadius: 16, gap: 16},
  status: {color: '#c7dfaa', fontSize: 14},
  notice: {color: '#f3d4a1', fontSize: 16, lineHeight: 25},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  button: {minHeight: 48, paddingHorizontal: 18, paddingVertical: 13, backgroundColor: '#b4debe', borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  buttonText: {color: '#10231b', fontSize: 16, fontWeight: '600'},
  focused: {outlineColor: '#ffffff', outlineWidth: 3, outlineStyle: 'solid'},
  disabled: {opacity: 0.45}, pressed: {opacity: 0.75},
  input: {color: '#f1f6ed', borderColor: '#78998a', borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 17, minHeight: 52, backgroundColor: '#0b1515'},
});
