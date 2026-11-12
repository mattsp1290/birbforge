import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {SecretName, SecretNames, type SecretCommand} from './secrets';
import {transport} from './transport';
import {authorizationHeaders} from './access';
import {Action, Body, Card, Field, Heading, useUI, type Session} from './ui';

type Editor = {kind: 'add' | 'replace'; name: string; value: string} | {kind: 'remove'; name: string};

export function MachineSecrets({session}: {session: Session}) {
  const {colors} = useUI();
  const {endpoint, access} = session;
  const [names, setNames] = useState<string[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef<AbortController | null>(null);

  const request = useCallback(async (command?: SecretCommand) => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setBusy(true);
    setError('');
    try {
      const response = await transport(endpoint + '/api/secrets', {
        method: command ? 'POST' : 'GET',
        headers: {...authorizationHeaders(access), 'Content-Type': 'application/json'},
        signal: controller.signal, redirect: 'error', body: command && JSON.stringify(command),
      });
      if (!response.ok) throw new Error();
      const updated = SecretNames.parse(await response.json());
      if (inFlight.current === controller) {
        setNames(updated.names);
        if (command) setEditor(null);
      }
    } catch {
      if (inFlight.current === controller) setError(command
        ? 'Could not confirm the change. Reload secrets to check the saved names.'
        : 'Could not load secrets from this machine.');
    } finally {
      clearTimeout(timeout);
      if (inFlight.current === controller) {inFlight.current = null; setBusy(false);}
    }
  }, [endpoint, access]);
  useEffect(() => {
    void request();
    return () => {inFlight.current?.abort(); inFlight.current = null;};
  }, [request]);

  function edit(next: Editor | null) {setError(''); setEditor(next);}
  const invalidName = editor?.kind === 'add' && !!editor.name && !SecretName.safeParse(editor.name).success;
  const duplicate = editor?.kind === 'add' && names?.includes(editor.name);
  return <Card>
    <Heading>Machine secrets</Heading>
    <Body muted>Store credentials on this server. Live Crew chat uses the secret named OPENCODE_GO_API_KEY.</Body>
    {names === null && !error && <Body muted>Loading secrets…</Body>}
    {names?.length === 0 && <Body muted>No secrets saved.</Body>}
    {names?.map(name => <View key={name} style={[styles.entry, {borderColor: colors.line}]}>
      <Body>{name}</Body>
      <View style={styles.row}>
        <Action secondary label={'Replace ' + name} disabled={busy || !!editor} onPress={() => edit({kind: 'replace', name, value: ''})} />
        <Action secondary label={'Remove ' + name} disabled={busy || !!editor} onPress={() => edit({kind: 'remove', name})} />
      </View>
    </View>)}
    {editor?.kind === 'remove' ? <>
      <Body>Remove {editor.name} from this machine?</Body>
      <View style={styles.row}>
        <Action label="Confirm removal" disabled={busy} onPress={() => void request({kind: 'remove', name: editor.name})} />
        <Action secondary label="Keep secret" disabled={busy} onPress={() => edit(null)} />
      </View>
    </> : editor ? <>
      {editor.kind === 'add' ? <Field label="Secret name" maxLength={100} value={editor.name} editable={!busy} onChangeText={name => setEditor({...editor, name})} />
        : <Body>Replace {editor.name}</Body>}
      {invalidName && <Body muted>Start with a letter. Use letters, digits, underscores or hyphens.</Body>}
      {duplicate && <Body muted>This name already exists. Use its Replace button to change the value.</Body>}
      <Field label="Secret value" secureTextEntry autoComplete="off" importantForAutofill="no" autoCorrect={false}
        maxLength={8192} value={editor.value} editable={!busy} onChangeText={value => setEditor({...editor, value})} />
      <View style={styles.row}>
        <Action label={editor.kind === 'add' ? 'Save secret' : 'Replace value'}
          disabled={busy || !editor.name || !!invalidName || !!duplicate || !editor.value}
          onPress={() => void request({kind: 'set', name: editor.name, value: editor.value})} />
        <Action secondary label="Cancel" disabled={busy} onPress={() => edit(null)} />
      </View>
    </> : <Action secondary label="Add secret" disabled={busy || !names} onPress={() => edit({kind: 'add', name: '', value: ''})} />}
    {error ? <>
      <Text accessibilityRole="alert" style={{color: colors.danger}}>{error}</Text>
      <Action secondary label="Reload secrets" disabled={busy} onPress={() => {setEditor(null); void request();}} />
    </> : null}
  </Card>;
}

const styles = StyleSheet.create({
  entry: {gap: 6, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
});
