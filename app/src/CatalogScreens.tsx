import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {z} from 'zod/v4';
import {Agent, Catalog, ProjectId, engineLabels, githubRepository, type CatalogCommand, type Engine} from './catalog';
import {authorizationHeaders} from './access';
import {transport} from './transport';
import {Action, Body, Card, Field, Heading, type Session} from './ui';

type SessionProps = {session: Session};
const errors: Record<string, string> = {
  invalid_catalog_command: 'Check the form and try again.',
  beans_unavailable: 'The gateway could not read or update its Beans hub.',
  beans_hub_required: 'The gateway needs a configured Beans hub to manage projects.',
  agent_changed: 'This agent changed on another device. Cancel your edit and refresh the list.',
  use_managed_project_command: 'Use the managed Projects screen on this machine to edit repository membership.',
  unknown_project: 'That project is no longer available. Refresh the list.',
  crew_unavailable: 'The gateway could not open the crew roster.',
  engine_unavailable: 'That engine is not available on this gateway. Choose another engine.',
};

function useCatalog({endpoint, access}: Session) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async (command?: CatalogCommand) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 40_000);
    setBusy(true);
    setError('');
    try {
      const response = await transport(endpoint + '/api/catalog', {
        method: command ? 'POST' : 'GET',
        headers: {...authorizationHeaders(access), 'Content-Type': 'application/json'},
        body: command ? JSON.stringify(command) : undefined, signal: controller.signal, redirect: 'error',
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({code: z.string()}).safeParse(payload);
        if (response.status === 401 || response.status === 403) throw Error('The gateway requires its owner credential to manage projects and crew.');
        throw Error((failure.success && errors[failure.data.code]) || 'The gateway could not complete this request.');
      }
      if (request.current !== controller) return false;
      setCatalog(Catalog.parse(payload));
      return true;
    } catch (cause) {
      if (request.current === controller) {
        setError(cause instanceof Error && cause.name === 'Error' ? cause.message : 'Could not reach the catalog. Check your connection and retry.');
      }
      return false;
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setBusy(false);
    }
  }, [endpoint, access]);
  useEffect(() => {
    setCatalog(null);
    void load();
    return () => {request.current?.abort(); request.current = null;};
  }, [load]);
  return {catalog, error, busy, load};
}

const row = {flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center'} as const;

function Feedback({error, busy, retry}: {error: string; busy: boolean; retry: () => void}) {
  if (error) return <Card><Body>{error}</Body><Action secondary label="Refresh list" onPress={retry} disabled={busy}/></Card>;
  if (busy) return <Body muted>Loading…</Body>;
  return null;
}

export function ProjectsScreen({session}: SessionProps) {
  const {catalog, error, busy, load} = useCatalog(session);
  const [creating, setCreating] = useState(false);
  const [id, setId] = useState('');
  const [linking, setLinking] = useState<string | null>(null);
  const [repository, setRepository] = useState('');
  const projectId = id.trim();
  return <>
    <Feedback error={error} busy={busy} retry={() => void load()}/>
    {catalog && <>
      {!catalog.projectsAvailable ? <Card>
        <Body>The Beans project list is unavailable. Check the hub configuration on this machine.</Body>
        <Action secondary label="Refresh projects" disabled={busy} onPress={() => void load()}/>
      </Card> :
        creating ? <Card>
          <Heading>New project</Heading>
          <Field label="Project name" placeholder="mobile-app" autoCapitalize="none" autoCorrect={false}
            maxLength={160} value={id} onChangeText={setId}/>
          <Body muted>Use lowercase letters, numbers and hyphens.</Body>
          <View style={row}>
            <Action label="Create project" disabled={busy || !ProjectId.safeParse(projectId).success} onPress={async () => {
              if (await load({kind: 'createProject', id: projectId})) {
                setCreating(false); setId(''); setLinking(projectId); setRepository('');
              }
            }}/>
            <Action secondary label="Cancel" disabled={busy} onPress={() => setCreating(false)}/>
          </View>
        </Card> :
        <View style={row}>
          <Action label="New project" disabled={busy} onPress={() => {setId(''); setLinking(null); setCreating(true);}}/>
          <Action secondary label="Refresh projects" disabled={busy} onPress={() => void load()}/>
        </View>}
      {catalog.projectsAvailable && !catalog.projects.length && <Card>
        <Heading>No projects yet</Heading><Body muted>Create a Beans project to group GitHub repositories.</Body>
      </Card>}
      {catalog.projects.map(project => <Card key={project.id}>
        <Heading>{project.id}</Heading>
        {project.repositories.length ? project.repositories.map(repo => <Body key={repo}>{repo}</Body>) :
          <Body muted>No GitHub repositories linked.</Body>}
        {linking === project.id ? <>
          <Field label="GitHub repository" placeholder="owner/repository" autoCapitalize="none" autoCorrect={false}
            value={repository} onChangeText={setRepository}/>
          <View style={row}>
            <Action label="Link repository" disabled={busy || !githubRepository(repository)} onPress={async () => {
              if (await load({kind: 'linkRepository', id: project.id, repository})) {setLinking(null); setRepository('');}
            }}/>
            <Action secondary label="Cancel" disabled={busy} onPress={() => setLinking(null)}/>
          </View>
        </> : <View style={row}><Action secondary label="Add repository" disabled={busy} onPress={() => {
          setCreating(false); setLinking(project.id); setRepository('');
        }}/></View>}
      </Card>)}
    </>}
  </>;
}

type AgentEditor = {previous: Agent | null; draft: Agent};

export function CrewScreen({session}: SessionProps) {
  const {catalog, busy, error, load} = useCatalog(session);
  const [editor, setEditor] = useState<AgentEditor | null>(null);
  const [removing, setRemoving] = useState<Agent | null>(null);
  function edit(previous: Agent | null) {
    const draft = previous ?? {id: randomUUID(), name: '', instructions: '', projectIds: []};
    setEditor({previous, draft});
    setRemoving(null);
  }
  const projectNames = new Map(catalog?.projects.map(project => [project.id, project.name ?? project.id]));
  function change(patch: Partial<Agent>) {
    setEditor(current => current && {...current, draft: {...current.draft, ...patch}});
  }
  function choose(engine?: Engine) {
    setEditor(current => {
      if (!current) return current;
      const {engine: _, ...draft} = current.draft;
      return {...current, draft: engine ? {...draft, engine} : draft};
    });
  }
  const engines = [...new Set([...(catalog?.engines ?? []), ...[editor?.previous?.engine, editor?.draft.engine].filter(engine => engine !== undefined)])];
  return <>
    <Feedback error={error} busy={busy} retry={() => void load()}/>
    {catalog && (editor ? <Card>
      <Heading>{editor.previous ? 'Edit agent' : 'New agent'}</Heading>
      <Field label="Agent name" placeholder="e.g. Finch" maxLength={100} value={editor.draft.name}
        onChangeText={name => change({name})}/>
      <Field label="Instructions" placeholder="What should this agent help with?" multiline maxLength={2000} style={{minHeight: 88, textAlignVertical: 'top'}}
        value={editor.draft.instructions} onChangeText={instructions => change({instructions})}/>
      <Body>Assigned projects</Body>
      {!catalog.projectsAvailable ? <Body muted>The Beans hub is unavailable. Existing project assignments are shown below.</Body> :
        !catalog.projects.length && <Body muted>Create a project to assign it here.</Body>}
      <View style={row}>
        {[...new Set([...catalog.projects.map(project => project.id), ...editor.draft.projectIds])].map(id => {
          const selected = editor.draft.projectIds.includes(id);
          return <Action key={id} secondary selected={selected} label={projectNames.get(id) ?? id}
            onPress={() => change({projectIds: selected ? editor.draft.projectIds.filter(item => item !== id) : [...editor.draft.projectIds, id]})}/>;
        })}
      </View>
      {engines.length > 0 && <>
        <Body>Engine</Body>
        <View style={row}>
          <Action secondary selected={!editor.draft.engine} label="Workspace (built-in)" onPress={() => choose()}/>
          {engines.map(engine => <Action key={engine} secondary selected={editor.draft.engine === engine} label={engineLabels[engine]}
            onPress={() => choose(engine)}/>)}
        </View>
        <Body muted>Existing chats keep the engine they started with.</Body>
      </>}
      <View style={row}>
        <Action label="Save agent" disabled={busy || !editor.draft.name.trim()} onPress={async () => {
          if (await load({kind: 'saveAgent', previous: editor.previous, agent: editor.draft})) setEditor(null);
        }}/>
        <Action secondary label="Cancel" disabled={busy} onPress={() => setEditor(null)}/>
      </View>
    </Card> : <>
      <View style={row}>
        <Action label="New agent" disabled={busy} onPress={() => edit(null)}/>
        <Action secondary label="Refresh agents" disabled={busy} onPress={() => void load()}/>
      </View>
      {!catalog.agents.length && <Card>
        <Heading>No crew agents yet</Heading><Body muted>Add an agent and choose the projects it works on.</Body>
      </Card>}
      {catalog.agents.map(agent => <Card key={agent.id}>
        <Heading>{agent.name}</Heading>
        {agent.instructions ? <Body>{agent.instructions}</Body> : null}
        <Body muted>{agent.projectIds.length ? 'Projects · ' + agent.projectIds.map(id => projectNames.get(id) ?? id).join(', ') : 'No projects assigned'}</Body>
        {agent.engine && <Body muted>{'Engine · ' + engineLabels[agent.engine]}</Body>}
        {removing?.id === agent.id ? <>
          <Body>Delete {agent.name} from the crew?</Body>
          <View style={row}>
            <Action label="Confirm deletion" disabled={busy} onPress={async () => {
              if (await load({kind: 'deleteAgent', previous: removing})) setRemoving(null);
            }}/>
            <Action secondary label="Keep agent" disabled={busy} onPress={() => setRemoving(null)}/>
          </View>
        </> : <View style={row}>
          <Action secondary label="Edit agent" disabled={busy} onPress={() => edit(agent)}/>
          <Action secondary label="Delete agent" disabled={busy} onPress={() => setRemoving(agent)}/>
        </View>}
      </Card>)}
    </>)}
  </>;
}
