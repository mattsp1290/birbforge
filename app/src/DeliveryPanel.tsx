import React, {useSyncExternalStore} from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import type {DeliveryClient} from './delivery';
import {reviewerName} from './delivery-contract';

export function DeliveryPanel({client, conversationId}: {client: DeliveryClient; conversationId: string}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const snapshot = state.snapshot;
  const disabled = !state.connected || state.sending || !!state.pending;
  const button = (label: string, action: () => void, locked = disabled) => <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{disabled: locked}} disabled={locked} onPress={action} style={[styles.button, locked && styles.disabled]}><Text style={styles.body}>{label}</Text></Pressable>;
  if (!snapshot) return <Text style={styles.body}>Connecting to your approved goal…</Text>;
  const stage = snapshot.stage;
  const elsewhere = snapshot.conversation_id !== null && snapshot.conversation_id !== conversationId;
  return <View testID="delivery-panel" style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>{snapshot.offer.title}</Text>
    <Text selectable style={styles.body}>{snapshot.offer.goal_text}</Text>
    <Text style={styles.muted}>Repository · {snapshot.offer.repository_id}</Text>
    <Text style={styles.muted}>Allowed changes · {snapshot.offer.allowed_paths.join(', ')}</Text>
    <Text selectable style={styles.muted}>Base · {snapshot.offer.base_commit}</Text>
    <Text testID="delivery-stage" accessibilityLiveRegion="polite" style={styles.status}>{stage.kind.replaceAll('_', ' ')} · {state.connected ? 'connected' : 'offline'}</Text>
    <Text style={styles.body}>Approval starts one coding job and an independent review. Only an approved candidate can become a draft PR. This grants no merge or deployment authority.</Text>
    {elsewhere ? <Text selectable style={styles.body}>Continue the owning conversation · {snapshot.conversation_id}</Text> : <>
      {stage.kind === 'awaiting_approval' && <View style={styles.row}>
        {button('Approve goal and start', () => {void client.act('approve', randomUUID());})}
        {button('Reject goal', () => {void client.act('reject', randomUUID());})}
      </View>}
      {stage.kind === 'changes_requested' && snapshot.cancellation === 'none' && <>
        <Text style={styles.body}>Check saved evidence for a known classification error. If confirmed, run another independent review of this same candidate. This does not approve or publish it.</Text>
        {stage.classification_check === 'checking'
          ? <Text accessibilityLiveRegion="polite" style={styles.status}>Checking saved review evidence.</Text>
          : stage.classification_check !== 'not_eligible' && button('Check review classification', () => {void client.act('retry_review', randomUUID());})}
        {stage.classification_check === 'not_eligible' && <Text style={styles.body}>The saved review is not eligible for classification recovery. Its outcome is unchanged.</Text>}
        {stage.classification_check === 'evidence_unconfirmed' && <Text style={styles.body}>Saved evidence could not confirm this classification. Its outcome is unchanged.</Text>}
      </>}
      {stage.kind === 'uncertain' && stage.reason === 'review_inconclusive' && snapshot.cancellation === 'none' && button('Retry independent review', () => {void client.act('retry_review', randomUUID());})}
      {['authoring', 'reviewing', 'publishing'].includes(stage.kind) && snapshot.cancellation === 'none' && button('Request cancellation', () => {void client.act('cancel', randomUUID());})}
    </>}
    {snapshot.cancellation !== 'none' && <Text testID="delivery-cancellation" style={styles.status}>Cancellation · {snapshot.cancellation}. A request does not confirm the worker stopped.</Text>}
    {'candidate' in stage && <Text selectable style={styles.muted}>Candidate · {stage.candidate.head_commit}</Text>}
    {'review' in stage && <><Text style={styles.body}>Independent review by {reviewerName[stage.review.reviewer]} · {stage.review.disposition.replaceAll('_', ' ')}</Text><Text selectable style={styles.body}>{stage.review.summary}</Text></>}
    <Text style={styles.muted}>Staging and native candidate verification have not run.</Text>
    {'reason' in stage && <Text style={styles.body}>{stage.reason.replaceAll('_', ' ')}</Text>}
    {stage.kind === 'draft_ready' && button(`Open draft PR #${stage.draft.number}`, () => {void Linking.openURL(stage.draft.url);}, false)}
    {state.pending && button('Retry unchanged delivery action', () => {void client.retry();}, state.sending)}
    {!!state.notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{state.notice}</Text>}
  </View>;
}
const styles = StyleSheet.create({card: {backgroundColor: '#172222', borderColor: '#34524d', borderWidth: 1, borderRadius: 16, padding: 20, gap: 14},
  title: {color: '#eff9f4', fontSize: 23, fontWeight: '700'}, body: {color: '#e4eee9', fontSize: 17, lineHeight: 25},
  muted: {color: '#a8beb5', fontSize: 14}, status: {color: '#9ce5bd', fontSize: 16}, row: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  button: {padding: 14, borderWidth: 1, borderColor: '#6cb99a', borderRadius: 9, minHeight: 48}, disabled: {opacity: 0.45}});
