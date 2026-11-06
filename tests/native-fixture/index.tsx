import '../../app/src/platform';
import React, {useState, useSyncExternalStore} from 'react';
import {registerRootComponent} from 'expo';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import App from '../../app/App';
import {fixture} from './transport.native';
import type {Stimulus} from './driver';

function FixtureApp() {
  const state = useSyncExternalStore(fixture.subscribe, fixture.getSnapshot);
  const [expanded, setExpanded] = useState(false);
  const busy = state.observations === 'held' || state.command.kind === 'armed' || state.command.kind === 'sending';
  const arm = (stimulus: Stimulus) => {fixture.arm(stimulus); setExpanded(false);};
  return <View style={styles.root}>
    <View style={styles.app}><App /></View>
    <View style={styles.panel}>
      <Pressable accessibilityRole="button" accessibilityLabel="Native fixture controls" onPress={() => setExpanded(!expanded)} style={styles.button}>
        <Text style={styles.text}>NATIVE FIXTURE BUILD · {state.command.kind} · observations {state.observations}</Text>
      </Pressable>
      {expanded && <ScrollView style={styles.expanded}>
        <Text style={styles.text}>One command only. Normal application and server remain unchanged. Observation holds release after 25 seconds.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Lose next admission reply" disabled={busy} onPress={() => arm({kind: 'lose-reply', action: 'admission'})} style={styles.button}><Text style={styles.text}>Lose next admission reply</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Lose next cancellation reply" disabled={busy} onPress={() => arm({kind: 'lose-reply', action: 'cancellation'})} style={styles.button}><Text style={styles.text}>Lose next cancellation reply</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Forge next admission authority" disabled={busy} onPress={() => arm({kind: 'forge-authority', action: 'admission'})} style={styles.button}><Text style={styles.text}>Forge next admission authority</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Release fixture observations" onPress={fixture.releaseObservations} style={styles.button}><Text style={styles.text}>Release fixture observations</Text></Pressable>
        {state.receipts.map(receipt => <Text key={receipt.sequence} selectable style={styles.receipt}>{JSON.stringify(receipt, null, 2)}</Text>)}
        <Text selectable style={styles.receipt}>{JSON.stringify({nativeCommandPostCounts: state.posts}, null, 2)}</Text>
      </ScrollView>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0b1515'}, app: {flex: 1},
  panel: {borderTopWidth: 2, borderTopColor: '#f3d4a1', padding: 8, paddingBottom: 25},
  expanded: {maxHeight: 260}, button: {padding: 12, minHeight: 48, backgroundColor: '#26372c', marginVertical: 3},
  text: {color: '#f3d4a1', fontSize: 13}, receipt: {color: '#e2eee7', fontSize: 12, paddingVertical: 8},
});
registerRootComponent(FixtureApp);
