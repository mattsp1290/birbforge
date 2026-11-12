import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {Chat, ChatIndex, awaitingReply, chiefId, chiefName, ended, type MemberStatus} from './chat';
import {engineLabels} from './catalog';
import {transport} from './transport';
import {authorizationHeaders} from './access';
import {Action, Body, Heading, useUI, type Session} from './ui';

const errors: Record<string, string> = {
  provider_secret_required: 'Add OPENCODE_GO_API_KEY under Machine secrets in Settings, then retry this message.',
  agent_removed: 'This agent was removed. Its chat history is still available.',
  catalog_unavailable: 'The crew roster is unavailable. Try again when the gateway can read it.',
  birbcrew_runner_unconfigured: 'The gateway needs a Crew Python runner to answer live chats.',
  birbcrew_reply_unavailable: 'Crew could not finish the reply. Check the gateway provider configuration and retry.',
  reply_pending: 'A reply is already pending. Reopen the chat to see its latest messages.',
  engine_unavailable: 'This agent’s engine is not available on this gateway. Choose another engine for the agent in Crew.',
  members_unconfigured: 'This chat runs on a Crew member, and this gateway no longer has Crew members configured.',
  member_chat_closed: 'This conversation has ended. Start a new chat to continue.',
  invalid_message: 'Crew cannot accept this message text. Edit it and try again.',
};
const outcomes: Record<MemberStatus, string> = {
  pending: 'Waiting for a reply…',
  waiting: 'This agent is waiting for a decision that Forge cannot answer yet.',
  completed: '',
  failed: 'Crew could not run this message. Start a new chat to continue.',
  cancelled: 'This message was cancelled before it ran. Start a new chat to continue.',
  uncertain: 'Crew could not confirm whether this reply finished, so it will not be retried. Start a new chat to continue.',
  rejected: 'Crew rejected this message. Start a new chat to continue.',
  limit: 'This chat reached Crew’s message limit. Start a new chat to continue.',
};
class ChatRequestError extends Error {
  constructor(readonly status: number, code: string) {
    super(errors[code] ?? ([401, 403].includes(status) ? 'Reconnect in Settings with the owner credential.' : 'The gateway could not open this chat. Please retry.'));
  }
}

async function request(session: Session, route: string, body?: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 100_000);
  try {
    const response = await transport(session.endpoint + '/api/chats' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {...authorizationHeaders(session.access), 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new ChatRequestError(response.status, result?.code ?? '');
    return result;
  } finally { clearTimeout(timeout); }
}

function ThreadView({session, threadId, mode, onBack, removed, updated, visible}: {
  session: Session; threadId: string; visible: boolean; mode: ChatIndex['mode']; onBack?: () => void; removed: boolean; updated: () => void;
}) {
  const {colors, largeText} = useUI();
  const [chat, setChat] = useState<Chat | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{id: string; text: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const alive = useRef(true);
  const sending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {alive.current = false;};
  }, []);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    request(session, '/' + threadId).then(result => {
      if (!current) return;
      const snapshot = Chat.parse(result);
      setChat(previous => {
        if (previous && (previous.turns.length > snapshot.turns.length || previous.turns.some((turn, i) => turn.answer !== null && snapshot.turns[i]?.answer === null))) return previous;
        return snapshot;
      });
      setPending(previous => previous && snapshot.turns.some(turn => turn.id === previous.id && turn.answer !== null) ? null : previous);
      setError('');
    }).catch(reason => {if (current) setError(reason instanceof Error ? reason.message : 'Could not load messages.');});
    return () => {current = false;};
  }, [session.endpoint, session.access, threadId, reload, visible]);

  const waiting = chat?.turns.some(awaitingReply);
  useEffect(() => {
    if (!visible || !waiting || busy || error) return;
    const timer = setInterval(() => setReload(n => n + 1), 5000);
    return () => clearInterval(timer);
  }, [visible, waiting, busy, error]);
  const retry = chat?.turns.find(turn => turn.answer === null && !turn.status) ?? pending;
  const replying = chat?.turns.some(turn => turn.status && awaitingReply(turn));
  const closed = chat?.turns.some(ended);
  async function send(text: string) {
    if (sending.current || removed || !text.trim()) return;
    sending.current = true;
    const message = retry ?? {id: randomUUID(), text: text.trim()};
    setBusy(true); setPending(message); setError(''); setDraft('');
    try {
      const result = Chat.parse(await request(session, '/' + threadId + '/messages', {id: message.id, text: message.text}));
      if (alive.current) {setChat(result); setPending(null); updated();}
    } catch (reason) {
      if (alive.current) {
        if (reason instanceof ChatRequestError && reason.status < 500) {
          setPending(null); setDraft(message.text); updated();
        }
        setError(reason instanceof ChatRequestError ? reason.message : 'The reply could not be received. Retry this message to recover it.');
      }
    } finally {sending.current = false; if (alive.current) setBusy(false);}
  }
  const name = chat?.agentName ?? (threadId === chiefId ? chiefName : 'Crew');
  const local = mode === 'local' && !chat?.engine;
  const displayed = chat?.turns ?? [];
  const turns = pending && !displayed.some(turn => turn.id === pending.id) ? [...displayed, {...pending, answer: null}] : displayed;
  return <View style={styles.thread}>
    <View style={[styles.threadHeader, {borderBottomColor: colors.line}]}>
      {onBack && <Action secondary label="Chats" onPress={onBack} />}
      <View style={styles.fill}><Heading>{name}</Heading>
        <Body muted>{chat?.engine ? 'Crew member · ' + engineLabels[chat.engine] : mode === 'local' ? 'Local inspection · Live model off' : 'Crew chat'}</Body></View>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={styles.history} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({animated: false})}>
      {!chat && !error && <Body muted>Loading messages…</Body>}
      {chat && turns.length === 0 && <View style={styles.empty}>
        <Heading>{threadId === chiefId ? 'What’s happening in the factory?' : 'Start a conversation'}</Heading>
        <Body muted>{local ? (threadId === chiefId ? 'Inspect the runtime, crew, and projects on this machine.' : 'Inspect this agent’s role and assigned projects.') : `Send a message to ${name}.`}</Body>
        {local && !removed && <Action label={threadId === chiefId ? 'Inspect factory' : 'Inspect assignments'} secondary onPress={() => void send(threadId === chiefId ? 'Show the current factory status.' : 'Show my assigned projects.')} />}
      </View>}
      {turns.map(turn => <View key={turn.id} style={styles.turn}>
        <View style={[styles.bubble, styles.user, {backgroundColor: colors.tint}]}><Body>{turn.text}</Body></View>
        {turn.answer ? <View style={styles.answer}><Body muted>{name}</Body><Body>{turn.answer}</Body></View> :
          <Body muted>{turn.status ? outcomes[turn.status] : busy ? 'Waiting for a reply…' : 'Reply pending.'}</Body>}
      </View>)}
    </ScrollView>
    {error ? <View accessibilityLiveRegion="polite" style={styles.notice}><Body>{error}</Body>
      {!busy && <Action secondary label="Refresh messages" onPress={() => setReload(n => n + 1)} />}</View> : null}
    {removed ? <View style={styles.composer}><Body muted>This agent was removed. You can still read this conversation.</Body></View> :
      closed ? <View style={styles.composer}><Body muted>This conversation has ended. Start a new chat to continue.</Body></View> :
      <View style={[styles.composer, {borderColor: colors.line, backgroundColor: colors.panel}]}>
        <TextInput accessibilityLabel="Message" placeholder={`Message ${name}`} placeholderTextColor={colors.muted}
          style={[styles.input, {color: colors.text, fontSize: largeText ? 21 : 16}]} multiline maxLength={4000}
          value={retry?.text ?? draft} onChangeText={setDraft} editable={Boolean(chat) && !busy && !retry} />
        <Action label={busy ? 'Sending…' : retry ? 'Retry message' : replying ? 'Waiting for reply' : 'Send message'}
          disabled={busy || replying || !chat || !(retry?.text ?? draft.trim())} onPress={() => void send(retry?.text ?? draft)} />
      </View>}
  </View>;
}

export function ChatScreen({session, visible = true}: {session: Session; visible?: boolean}) {
  const {colors, largeText} = useUI();
  const wide = useWindowDimensions().width >= 840;
  const [index, setIndex] = useState<ChatIndex | null>(null);
  const [selected, setSelected] = useState(chiefId);
  const [reading, setReading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const opening = useRef<{id: string; agentId: string} | null>(null);
  const update = useCallback(() => setRefresh(n => n + 1), []);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    request(session, '').then(result => {
      if (current) {setIndex(ChatIndex.parse(result)); setError('');}
    }).catch(reason => {if (current) setError(reason instanceof Error ? reason.message : 'Could not load chats.');});
    return () => {current = false;};
  }, [session.endpoint, session.access, refresh, visible]);

  function select(id: string) {setSelected(id); setReading(true); setChoosing(false);}
  async function start(agentId: string) {
    if (creating) return;
    const input = opening.current?.agentId === agentId ? opening.current : {id: randomUUID(), agentId};
    opening.current = input;
    setCreating(true); setError('');
    try {
      const chat = Chat.parse(await request(session, '', input));
      setIndex(previous => previous && {...previous, threads: [...previous.threads.filter(item => item.id !== chat.id), chat]});
      opening.current = null; select(chat.id); update();
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Could not start the conversation.');}
    finally {setCreating(false);}
  }
  const selectedAgent = index?.threads.find(item => item.id === selected)?.agentId;
  return <View style={[styles.layout, {flexDirection: wide ? 'row' : 'column'}]}>
    {(wide || !reading || !index) && <View style={wide ? [styles.sidebar, {borderRightColor: colors.line}] : styles.fill}>
      {index && <Pressable accessibilityRole="button" accessibilityLabel={chiefName + ' · Pinned'}
        accessibilityState={{selected: selected === chiefId && (reading || wide)}} onPress={() => select(chiefId)}
        style={[styles.item, {marginHorizontal: 12, marginTop: 10, backgroundColor: colors.tint, borderColor: colors.line}]}>
        <Text style={{color: colors.text, fontSize: largeText ? 20 : 16, fontWeight: '700'}}>{chiefName}</Text>
        <Body muted>Pinned</Body>
      </Pressable>}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
      <Action label={choosing ? 'Close agent list' : 'New chat'} onPress={() => {setChoosing(!choosing); if (!choosing) update();}} disabled={!index || creating} />
      {choosing && <View style={[styles.picker, {backgroundColor: colors.panel, borderColor: colors.line}]}>
        <Body>Choose an agent</Body>
        {index?.agents.map(agent => <Action secondary key={agent.id} label={agent.engine ? `${agent.name} · ${engineLabels[agent.engine]}` : agent.name}
          disabled={creating} onPress={() => void start(agent.id)} />)}
        {index && !index.agents.length && <Body muted>{index.catalogAvailable ? 'Create an agent in Crew to start a chat.' : 'The crew roster is unavailable.'}</Body>}
      </View>}
      {error ? <View accessibilityLiveRegion="polite"><Body>{error}</Body><Action label="Refresh chats" secondary onPress={update} /></View> : null}
      {!index && !error && <Body muted>Loading chats…</Body>}
      {index?.threads.filter(thread => thread.id !== chiefId).map(thread => {
        const active = selected === thread.id && (reading || wide);
        return <Pressable key={thread.id} accessibilityRole="button" accessibilityState={{selected: active}}
          onPress={() => select(thread.id)} style={({pressed}) => [styles.item, {backgroundColor: active ? colors.tint : pressed ? colors.panel : 'transparent', borderColor: 'transparent'}]}>
          <Text numberOfLines={2} style={{color: colors.text, fontWeight: '600', fontSize: largeText ? 20 : 16}}>{thread.title}</Text>
          <Body muted>{thread.engine ? `${thread.agentName} · ${engineLabels[thread.engine]}` : thread.agentName}</Body>
        </Pressable>;
      })}
    </ScrollView></View>}
    {(wide || reading) && index && <ThreadView key={selected} threadId={selected} session={session} mode={index.mode} visible={visible} updated={update}
      removed={Boolean(index.catalogAvailable && selectedAgent && selectedAgent !== chiefId && !index.agents.some(agent => agent.id === selectedAgent))}
      onBack={wide ? undefined : () => {setReading(false); update();}} />}
  </View>;
}

const styles = StyleSheet.create({
  layout: {flex: 1, minHeight: 0}, fill: {flex: 1, minWidth: 0},
  sidebar: {width: 230, flexGrow: 0, borderRightWidth: 1},
  list: {padding: 16, gap: 9}, item: {gap: 3, padding: 12, borderWidth: 1, borderRadius: 10},
  picker: {gap: 8, padding: 12, borderWidth: 1, borderRadius: 10},
  thread: {flex: 1, minWidth: 0, minHeight: 0}, threadHeader: {alignItems: 'center', flexDirection: 'row', paddingHorizontal: 18, paddingVertical: 10, gap: 12, borderBottomWidth: 1},
  history: {padding: 18, gap: 24, flexGrow: 1}, empty: {gap: 12, alignItems: 'flex-start', marginVertical: 'auto', maxWidth: 500, alignSelf: 'center'},
  bubble: {paddingHorizontal: 15, paddingVertical: 10, borderRadius: 14}, user: {alignSelf: 'flex-end', maxWidth: '88%'},
  turn: {gap: 18}, answer: {gap: 5}, composer: {margin: 12, padding: 10, borderWidth: 1, borderRadius: 14, gap: 8, alignItems: 'flex-end'},
  input: {alignSelf: 'stretch', padding: 8, minHeight: 44, maxHeight: 110, textAlignVertical: 'top'},
  notice: {paddingHorizontal: 16, gap: 4, alignItems: 'flex-start'},
});
