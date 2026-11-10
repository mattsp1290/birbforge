import AsyncStorage from '@react-native-async-storage/async-storage';
import {PendingProjectAction, pendingProjectKey} from './project-pending';
import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {ProjectClient} from './projects';
import {ProjectCommand as ProjectCommandSchema} from './project-contract';
import type {Project, ProjectCommand} from './project-contract';
import {ActionError} from './controller';

type Picked = {id: string; full_name: string};
function Button({label, onPress, disabled = false}: {label: string; onPress: () => void; disabled?: boolean}) {
  const [focused, setFocused] = useState(false);
  return <Pressable onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed}) => [styles.button, disabled && {opacity: 0.45}, pressed && {opacity: 0.75}, focused && {outlineColor: '#ffffff', outlineWidth: 3}]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Picker({client, selected, select, busy}: {client: ProjectClient; selected: Picked[]; select: (value: Picked[]) => void; busy: boolean}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Picked[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setFailure('');
    const timer = setTimeout(() => {void client.repositories(query, page, refresh > 0 && page === 1).then(result => {
      if (!current) return;
      const next = result.repositories.map(repo => ({id: String(repo.id), full_name: repo.full_name}));
      setRows(previous => page === 1 ? next : [...previous, ...next.filter(row => !previous.some(old => old.id === row.id))]);
      setMore(result.has_more);
    }).catch(() => {if (current) {setFailure('GitHub repositories unavailable. Check the owner connection and retry.'); setRows([]); setMore(false);}})
      .finally(() => {if (current) setLoading(false);});}, 250);
    return () => {current = false; clearTimeout(timer);};
  }, [client, query, page, refresh]);
  return <View style={styles.card}>
    <Text style={styles.heading}>Select GitHub repositories</Text>
    <TextInput accessibilityLabel="Search accessible repositories" placeholder="Search accessible repositories" placeholderTextColor="#aabcb5" style={styles.input} value={query} onChangeText={value => {setQuery(value); setPage(1);}} />
    <Button label="Refresh GitHub repositories" disabled={busy || loading} onPress={() => {setPage(1); setRefresh(value => value + 1);}} />
    {loading && <Text accessibilityLiveRegion="polite" style={styles.text}>Loading repositories...</Text>}
    {!!failure && <Text accessibilityLiveRegion="polite" style={styles.notice}>{failure}</Text>}
    {!loading && !failure && !rows.length && <Text style={styles.text}>No accessible repositories match this search.</Text>}
    {!loading && !failure && rows.map(repo => {
      const checked = selected.some(item => item.id === repo.id);
      return <Button key={repo.id} label={`${checked ? 'Selected' : 'Select'} ${repo.full_name}`} disabled={busy} onPress={() => select(checked ? selected.filter(item => item.id !== repo.id) : [...selected, repo])} />;
    })}
    {more && <Button label="Load more repositories" disabled={loading || busy} onPress={() => setPage(value => value + 1)} />}
    {!!selected.length && <Text style={styles.text}>Selected in order · {selected.map(repo => repo.full_name).join(', ')}</Text>}
  </View>;
}
export function ProjectHome({client, initialProjectId, openChat, leave}: {client: ProjectClient; initialProjectId: string | null; openChat: (id: string, projectId: string) => Promise<void>; leave: () => void}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Picked[]>([]);
  const [name, setName] = useState('');
  const [chats, setChats] = useState<{id: string; project_revision: string}[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ProjectCommand | null>(null);
  const [rejected, setRejected] = useState(false);
  const [pendingChat, setPendingChat] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [restored, setRestored] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const pendingKey = pendingProjectKey(client.endpoint);
  async function refresh() {
    setProjects(await client.list());
    if (project) {setProject(await client.get(project.id)); setChats(await client.chats(project.id));}
  }
  async function act(operation: () => Promise<void>) {
    setBusy(true); setNotice('');
    try {await operation();}
    catch (error) {setNotice(error instanceof ActionError ? error.code.replaceAll('_', ' ') : 'Service unavailable. Retain the current operation and retry.');}
    finally {setBusy(false);}
  }
  useEffect(() => {void act(async () => {
    setRestored(false);
    const saved = await AsyncStorage.getItem(pendingKey);
    const action = saved ? PendingProjectAction.parse(JSON.parse(saved)) : null;
    let restoreProject = initialProjectId;
    if (action?.kind === 'mutation') {setPending(action.command); setRejected(false);}
    if (action?.kind === 'chat') {setPendingChat(action.conversation_id); restoreProject = action.project_id;}
    setProjects(await client.list());
    if (restoreProject) {const current = await client.get(restoreProject); setProject(current); setName(current.name); setChats(await client.chats(restoreProject));}
    setRestored(true);
  });}, [client, restoreAttempt]);

  async function mutate(raw: ProjectCommand) {
    const checked = ProjectCommandSchema.safeParse(raw);
    if (!checked.success) throw new ActionError(400, 'invalid_project_name_or_membership');
    const command = checked.data;
    await AsyncStorage.setItem(pendingKey, JSON.stringify({kind: 'mutation', command}));
    setPending(command); setRejected(false);
    try {
      const result = await client.mutate(command);
      await AsyncStorage.removeItem(pendingKey);
      setPending(null); setProject(result.project); setName(result.project.name); setSelected([]); setCreating(false); setConfirmArchive(false);
      setNotice(result.pushed ? 'Project saved.' : 'Saved in the local Beans hub. Publication is not confirmed.');
      setProjects(await client.list()); setChats(await client.chats(result.project.id));
    } catch (error) {if (error instanceof ActionError && error.status < 500) setRejected(true); throw error;}
  }
  const edit = (change: ProjectCommand['change']) => {
    if (project) void act(() => mutate({project_id: project.id, operation_id: randomUUID(), expected_revision: project.revision, change}));
  };
  const locked = !restored || busy || !!pending || !!pendingChat;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={styles.title}>{project ? project.name : 'Your projects'}</Text>
    <Button label={project || creating ? 'Back to projects' : 'Back to conversations'} disabled={locked} onPress={() => {if (project || creating) {setProject(null); setCreating(false); setSelected([]); setName('');} else leave();}} />
    <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>
    {!restored && !busy && <Button label="Restore pending project actions" onPress={() => setRestoreAttempt(value => value + 1)} />}
    {pending && <View style={styles.card}><Text selectable style={styles.text}>Edit operation {pending.operation_id}</Text>
      <Text style={styles.notice}>{rejected ? 'Edit rejected. Refresh before preparing another edit.' : 'Acknowledgement pending. Retry this unchanged edit.'}</Text>
      {rejected ? <Button label="Discard rejected edit and refresh" disabled={busy} onPress={() => void act(async () => {await AsyncStorage.removeItem(pendingKey); setPending(null); await refresh();})} />
        : <Button label="Retry same project edit" disabled={busy} onPress={() => void act(() => mutate(pending))} />}
    </View>}
    {!project && !creating && <>
      <Button label="Import repositories into a new project" disabled={locked} onPress={() => {setCreating(true); setSelected([]); setName('');}} />
      <Button label="Refresh projects" disabled={busy} onPress={() => void act(refresh)} />
      {!projects.length && !busy && <Text style={styles.text}>No active projects. Import repositories to begin.</Text>}
      {projects.map(row => <Button key={row.id} label={`Open ${row.name}`} disabled={locked} onPress={() => void act(async () => {const value = await client.get(row.id); setProject(value); setName(value.name); setChats(await client.chats(row.id));})} />)}
    </>}
    {creating && <>
      <Picker client={client} selected={selected} select={setSelected} busy={locked} />
      <Text style={styles.text}>Project name defaults to the first repository you select.</Text>
      <TextInput accessibilityLabel="New project name" placeholder={selected[0]?.full_name.split('/')[1] ?? 'Select the first repository'} placeholderTextColor="#aabcb5" style={styles.input} editable={!locked} value={name} onChangeText={setName} />
      <Button label="Create project" disabled={locked || !selected.length} onPress={() => void act(() => mutate({project_id: `project-${randomUUID()}`, operation_id: randomUUID(), expected_revision: null,
        change: {type: 'create', name: name.trim() || null, repository_ids: selected.map(repo => repo.id)}}))} />
    </>}
    {project && <>
      <Text selectable style={styles.text}>Project {project.id} · revision {project.revision.slice(0, 12)}{project.archived ? ' · Removed from active use' : ''}</Text>
      <TextInput accessibilityLabel="Project name" style={styles.input} value={name} onChangeText={setName} editable={!locked && !project.archived} />
      <Button label="Save project name" disabled={locked || project.archived || !name.trim() || name === project.name} onPress={() => edit({type: 'rename', name})} />
      <Button label="Refresh project" disabled={busy} onPress={() => void act(refresh)} />
      <View style={styles.card}><Text style={styles.heading}>Repositories</Text>{project.repositories.map(repo => <View key={repo.id} style={styles.card}>
        <Text selectable style={styles.text}>{repo.full_name} · GitHub ID {repo.id}</Text>
        <Button label={`Remove ${repo.full_name}`} disabled={locked || project.archived} onPress={() => edit({type: 'remove_repository', repository_id: repo.id})} />
      </View>)}<Text style={styles.text}>Every active project needs at least one repository.</Text></View>
      {!project.archived && <><Picker client={client} selected={selected} select={setSelected} busy={locked} />
        {selected.map(repo => <Button key={repo.id} label={`Add ${repo.full_name}`} disabled={locked} onPress={() => edit({type: 'add_repository', repository_id: repo.id})} />)}</>}
      <View style={styles.card}><Text style={styles.heading}>Project chats</Text>
        <Button label={pendingChat ? 'Retry same new chat' : 'New project chat'} disabled={!restored || busy || !!pending || project.archived} onPress={() => void act(async () => {
          const id = pendingChat ?? randomUUID();
          await AsyncStorage.setItem(pendingKey, JSON.stringify({kind: 'chat', project_id: project.id, conversation_id: id}));
          setPendingChat(id);
          try {await client.createChat(project.id, id); await openChat(id, project.id); await AsyncStorage.removeItem(pendingKey); setPendingChat(null);}
          catch (error) {if (error instanceof ActionError && error.status < 500) {await AsyncStorage.removeItem(pendingKey); setPendingChat(null);} throw error;}
        })} />
        {chats.map(chat => <Button key={chat.id} label={`Open chat ${chat.id.slice(0, 8)}${chat.project_revision === project.revision ? '' : ' · historical context'}`} disabled={locked} onPress={() => void act(() => openChat(chat.id, project.id))} />)}
        {!chats.length && <Text style={styles.text}>No chats yet.</Text>}
      </View>
      {!project.archived && <View style={styles.card}><Text style={styles.text}>Removing a project archives it from active use. Chats, authored records, repository checkouts and GitHub repositories are preserved.</Text>
        <Button label={confirmArchive ? 'Confirm remove project from active use' : 'Remove project from active use'} disabled={locked} onPress={() => confirmArchive ? edit({type: 'archive'}) : setConfirmArchive(true)} />
      </View>}
    </>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: {padding: 24, paddingTop: 60, gap: 18, width: '100%', maxWidth: 850, alignSelf: 'center', paddingBottom: 60},
  title: {color: '#f1f6ed', fontSize: 32, fontWeight: '700'}, heading: {color: '#f1f6ed', fontSize: 22, fontWeight: '600'},
  text: {color: '#dce9df', fontSize: 16, lineHeight: 25}, notice: {color: '#f3d4a1', fontSize: 16, lineHeight: 25},
  card: {backgroundColor: '#142222', padding: 18, borderRadius: 12, gap: 12, borderColor: '#30453f', borderWidth: 1},
  input: {color: '#f1f6ed', borderColor: '#78998a', borderWidth: 1, borderRadius: 8, padding: 14, fontSize: 17, minHeight: 52, backgroundColor: '#0b1515'},
  button: {minHeight: 48, padding: 14, backgroundColor: '#b4debe', borderRadius: 9, alignItems: 'center'}, buttonText: {color: '#10231b', fontSize: 16, fontWeight: '600'},
});
