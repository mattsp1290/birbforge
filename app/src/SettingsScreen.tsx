import React, {useEffect, useState} from 'react';
import {Linking, Platform, StyleSheet, Text, View} from 'react-native';
import {Action, Body, Card, Field, Heading, useUI} from './ui';
import {defaultEndpoint, serverOrigin, type Machine, type MachineSettings, type Theme} from './settings';
import {discoverAccess, type AccessCapability} from './access';
import {transport} from './transport';
import {MachineSecrets} from './MachineSecrets';

type Editor = {kind: 'new'} | {kind: 'edit'; machine: Machine};
const themes: {value: Theme; label: string}[] = [
  {value: 'system', label: 'System'}, {value: 'light', label: 'Light'}, {value: 'dark', label: 'Dark'},
];

function MachineEditor({editor, settings, close}: {editor: Editor; settings: MachineSettings; close: () => void}) {
  const machine = editor.kind === 'edit' ? editor.machine : undefined;
  const [name, setName] = useState(machine?.name ?? 'Forge');
  const [endpoint, setEndpoint] = useState(machine?.endpoint ?? defaultEndpoint());
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const {colors} = useUI();
  let browserOrigin: string | null = null;
  if (Platform.OS === 'web') {
    try {
      const origin = serverOrigin(endpoint);
      if (origin !== globalThis.location.origin) browserOrigin = origin;
    } catch {}
  }
  const [discovered, setDiscovered] = useState<{endpoint: string; capability: AccessCapability} | null>(null);
  const [probe, setProbe] = useState(0);
  const [discoveryError, setDiscoveryError] = useState('');
  const capability = discovered?.endpoint === endpoint ? discovered.capability : null;
  useEffect(() => {
    let current = true;
    const abort = new AbortController();
    setDiscovered(null);
    setDiscoveryError('');
    let origin: string;
    try {origin = serverOrigin(endpoint);} catch {return;}
    if (browserOrigin) return;
    const timeout = setTimeout(() => abort.abort(), 12000);
    const start = setTimeout(() => {
      void discoverAccess(origin, transport, abort.signal).then(result => {
        if (current) setDiscovered({endpoint, capability: result});
      }).catch(() => {
        if (current) setDiscoveryError('Could not check access. Check your endpoint and private network connection.');
      }).finally(() => clearTimeout(timeout));
    }, 200);
    return () => {current = false; clearTimeout(start); clearTimeout(timeout); abort.abort();};
  }, [endpoint, browserOrigin, probe]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {await action(); setCredential(''); close();}
    catch (cause) {setError(cause instanceof Error ? cause.message : 'Could not update this machine.');}
    finally {setBusy(false);}
  }
  function save(connect: boolean) {
    const access = capability?.kind === 'private-single-owner' ? capability : capability && credential.trim() ? {kind: 'bearer' as const, token: credential.trim()} : undefined;
    if (connect && !access) return;
    void perform(() => settings.saveMachine({id: machine?.id, name, endpoint}, connect ? access : undefined));
  }
  const canSave = !!name.trim() && !!endpoint.trim() && !busy;
  return <Card>
    <Heading>{machine ? 'Edit machine' : 'Add a machine'}</Heading>
    <Field label="Machine name" maxLength={100} value={name} editable={!busy} onChangeText={setName} />
    <Field label="Server URL" placeholder="https://your-server.example" autoCapitalize="none" autoCorrect={false}
      keyboardType="url" value={endpoint} editable={!busy} onChangeText={next => {setEndpoint(next); setCredential('');}} />
    <Body muted>Connect to NetBird to reach your private Forge server.</Body>
    {browserOrigin ? <>
      <Body muted>Open this machine at its own address to sign in.</Body>
      <Action secondary label="Open machine in browser" disabled={busy}
        onPress={() => {if (browserOrigin) void Linking.openURL(browserOrigin).catch(() => setError('Could not open this server URL.'));}} />
    </> : capability?.kind === 'private-single-owner' ? <Body muted>Connected through your private network.</Body>
    : capability?.kind === 'bearer' ? <>
      <Field label="Owner credential" accessibilityLabel="Owner credential" secureTextEntry autoCapitalize="none"
        autoComplete="off" autoCorrect={false} value={credential} onChangeText={setCredential} editable={!busy} />
      <Body muted>The credential stays in memory until you disconnect, switch machines, or close the app.</Body>
    </> : discoveryError ? <>
      <Body muted>{discoveryError}</Body>
      <Action secondary label="Check endpoint" onPress={() => setProbe(value => value + 1)} />
    </> : null}
    {error ? <Text accessibilityRole="alert" style={{color: colors.danger}}>{error}</Text> : null}
    <View style={styles.row}>
      {!browserOrigin && <Action label={busy ? 'Working…' : 'Connect machine'} disabled={!canSave || !capability || (capability.kind === 'bearer' && !credential.trim())} onPress={() => save(true)} />}
      <Action secondary label="Save machine" disabled={!canSave} onPress={() => save(false)} />
      <Action secondary label="Cancel" disabled={busy} onPress={close} />
    </View>
    {machine && (confirmRemove ? <>
      <Body>Remove {machine.name} from this device?</Body>
      <View style={styles.row}>
        <Action label="Remove from device" disabled={busy} onPress={() => void perform(() => settings.forgetMachine(machine.id))} />
        <Action secondary label="Keep machine" disabled={busy} onPress={() => setConfirmRemove(false)} />
      </View>
    </> : <Action secondary label="Remove machine" disabled={busy} onPress={() => setConfirmRemove(true)} />)}
  </Card>;
}

export function SettingsScreen({settings}: {settings: MachineSettings}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [prefError, setPrefError] = useState('');
  const [savingPref, setSavingPref] = useState(false);
  const {colors} = useUI();
  const [initialEditorDismissed, setInitialEditorDismissed] = useState(false);
  const openEditor = editor ?? (settings.ready && !settings.profiles.length && !initialEditorDismissed ? {kind: 'new'} as const : null);
  async function savePreference(action: () => Promise<void>) {
    setSavingPref(true); setPrefError('');
    try {await action();}
    catch {setPrefError('Could not save the appearance change on this device.');}
    finally {setSavingPref(false);}
  }
  if (!settings.ready) return <Body muted>Loading settings…</Body>;
  return <>
    {!!settings.loadError && <Text accessibilityRole="alert" style={{color: colors.danger}}>{settings.loadError}</Text>}
    <Card>
      <Heading>Machines</Heading>
      {!settings.profiles.length && <Body muted>No machines saved on this device.</Body>}
      {settings.profiles.map(machine => {
        const connected = settings.active?.id === machine.id;
        return <View key={machine.id} style={[styles.machine, {borderColor: colors.line}]}>
          <View style={styles.details}>
            <Body>{machine.name}</Body>
            <Body muted>{machine.endpoint}</Body>
            {connected && <Text style={{color: colors.accent}}>Connected</Text>}
          </View>
          <View style={styles.row}>
            <Action secondary label={connected ? 'Edit connection' : 'Manage machine'} onPress={() => setEditor({kind: 'edit', machine})} />
            {connected && <Action secondary label="Disconnect machine" onPress={settings.disconnect} />}
          </View>
        </View>;
      })}
      {!openEditor && <Action secondary label="Add machine" onPress={() => setEditor({kind: 'new'})} />}
    </Card>
    {openEditor && <MachineEditor key={openEditor.kind === 'new' ? 'new' : openEditor.machine.id}
      editor={openEditor} settings={settings} close={() => {setEditor(null); setInitialEditorDismissed(true);}} />}
    {settings.active && <MachineSecrets key={settings.active.sessionId} session={settings.active} />}
    <Card>
      <Heading>Appearance</Heading>
      <Body>Theme</Body>
      <View style={styles.row}>
        {themes.map(({label, value}) => <Action key={value} label={label} selected={settings.theme === value}
          secondary={settings.theme !== value} disabled={savingPref} onPress={() => void savePreference(() => settings.changeTheme(value))} />)}
      </View>
      <Body>Text size</Body>
      <View style={styles.row}>
        <Action label="Standard text" selected={!settings.largeText} secondary={settings.largeText}
          disabled={savingPref} onPress={() => void savePreference(() => settings.changeLargeText(false))} />
        <Action label="Large text" selected={settings.largeText} secondary={!settings.largeText}
          disabled={savingPref} onPress={() => void savePreference(() => settings.changeLargeText(true))} />
      </View>
      {!!prefError && <Text accessibilityRole="alert" style={{color: colors.danger}}>{prefError}</Text>}
    </Card>
  </>;
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center'},
  details: {gap: 3},
  machine: {gap: 8, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth},
});
