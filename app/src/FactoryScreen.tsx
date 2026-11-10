import React, {useCallback, useEffect, useState} from 'react';
import {AppState, StyleSheet, Text, View} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {authorizationHeaders} from './access';
import {FactoryStatus} from './factory';
import {GoalWorkflows} from './GoalWorkflows';
import type {ActiveMachine} from './settings';
import {transport} from './transport';
import {Action, Body, Card, Heading, useUI} from './ui';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function Service({icon, name, value, ok}: {icon: IconName; name: string; value: string; ok: boolean}) {
  const {colors, largeText} = useUI();
  return <View style={[styles.service, {borderTopColor: colors.line}]}>
    <MaterialCommunityIcons name={icon} size={23} color={colors.muted} />
    <Text style={{flex: 1, color: colors.text, fontSize: largeText ? 19 : 15, fontWeight: '500'}}>{name}</Text>
    <Text style={{color: ok ? colors.accent : colors.muted, fontSize: largeText ? 17 : 14}}>{value}</Text>
  </View>;
}
export function FactoryScreen({machine, visible, settings}: {machine: ActiveMachine | null; visible: boolean; settings: () => void}) {
  const {colors} = useUI();
  const [status, setStatus] = useState<FactoryStatus | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const retry = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setForeground(next === 'active'));
    return () => sub.remove();
  }, []);
  const endpoint = machine?.endpoint, access = machine?.access;
  useEffect(() => {
    if (!endpoint || !access || !visible || !foreground) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      setRefreshing(true);
      const abort = new AbortController();
      const cancel = () => abort.abort();
      controller.signal.addEventListener('abort', cancel);
      const timeout = setTimeout(cancel, 12_000);
      try {
        const response = await transport(endpoint + '/api/factory', {headers: access && authorizationHeaders(access), signal: abort.signal, redirect: 'error'});
        if (!response.ok) throw new Error();
        const next = FactoryStatus.parse(await response.json());
        if (!controller.signal.aborted) {setStatus(next); setError('');}
      } catch {
        if (!controller.signal.aborted) {setError('Could not refresh factory status. Check the machine connection or try again.'); setStatus(null);}
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', cancel);
        if (!controller.signal.aborted) {
          setRefreshing(false);
          timer = setTimeout(() => {void check();}, 15_000);
        }
      }
    }
    void check();
    return () => {controller.abort(); clearTimeout(timer);};
  }, [endpoint, access, foreground, visible, refresh]);
  const unknown = machine ? 'Unknown' : 'Disconnected';
  return <>
    <View style={styles.machine}>
      <View style={styles.machineTop}>
        <View style={styles.badge}><MaterialCommunityIcons name="factory" color="#f1cf88" size={33} /></View>
        <Text style={styles.machineLabel}>ACTIVE MACHINE</Text>
      </View>
      <Text style={styles.machineName}>{machine?.name ?? 'Connect your factory'}</Text>
      <Text style={styles.machineDetail}>{machine?.endpoint ?? 'Add a machine to see its runtime and verification queue.'}</Text>
      <View style={{alignSelf: 'flex-start', marginTop: 6}}>
        <Action label={machine ? 'Machine settings' : 'Connect a machine'} secondary onPress={settings} />
      </View>
    </View>
    <Card>
      <View style={styles.cardTitle}>
        <Heading>Service status</Heading>
        {machine && <Action secondary label={refreshing ? 'Checking…' : 'Refresh status'} disabled={refreshing} onPress={retry} />}
      </View>
      <Service icon="server-outline" name="Birbforge gateway" value={status ? 'Online' : unknown} ok={!!status} />
      <Service icon="bird" name="Birbcrew runtime" value={status ? status.runtime === 'ready' ? 'Ready' : 'Unavailable' : unknown} ok={status?.runtime === 'ready'} />
      <Service icon="tray-full" name="Verification service" value={status ? {installed: 'Ready', unconfigured: 'Not installed', unavailable: 'Unavailable'}[status.verification] : unknown} ok={status?.verification === 'installed'} />
      {error ? <Body style={{color: colors.danger}}>{error}</Body> : status && <Body muted>Last checked {new Date(status.checkedAt).toLocaleTimeString()}</Body>}
    </Card>
    {status?.queue && <Card>
      <Heading>Queue activity</Heading>
      <Body>Environment · {status.queue.environment}</Body>
      <View style={styles.counts}>{(['queued', 'running', 'finished'] as const).map(key => <View key={key}>
        <Text style={{color: colors.text, fontWeight: '600', fontSize: 27}}>{status.queue?.[key]}</Text>
        <Body muted>{key}</Body>
      </View>)}</View>
      {!!status.queue.uncertain && <Body>Needs reconciliation · {status.queue.uncertain}</Body>}
    </Card>}
    {machine && <GoalWorkflows session={machine} queueId={status?.queue?.conversationId ?? undefined} />}
  </>;
}
const styles = StyleSheet.create({
  machine: {padding: 24, borderRadius: 16, backgroundColor: '#26483c', gap: 8},
  machineTop: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6},
  badge: {width: 49, height: 49, backgroundColor: '#355849', borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  machineLabel: {color: '#dddfc9', fontSize: 12, fontWeight: '700', letterSpacing: 1.5},
  machineName: {color: '#fcfbf4', fontSize: 29, fontWeight: '600', letterSpacing: -0.8},
  machineDetail: {color: '#d4e1d4', fontSize: 15, lineHeight: 23},
  cardTitle: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8},
  service: {borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingTop: 10},
  counts: {flexDirection: 'row', flexWrap: 'wrap', gap: 28},
});
