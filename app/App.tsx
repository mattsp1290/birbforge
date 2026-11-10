import React, {useMemo, useRef, useState, useEffect} from 'react';
import {KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useColorScheme, useWindowDimensions} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {ProjectHome} from './src/ProjectHome';
import {ProjectClient} from './src/projects';
import {ConversationClient} from './src/controller';
import {pendingChatStore} from './src/chat-pending';
import {transport} from './src/transport';
import {GoalConversation} from './src/GoalWorkflows';
import {ProjectsScreen, CrewScreen} from './src/CatalogScreens';
import {ChatScreen} from './src/ChatScreen';
import {FactoryScreen} from './src/FactoryScreen';
import {SettingsScreen} from './src/SettingsScreen';
import {useMachineSettings, type MachineSettings, type ActiveMachine} from './src/settings';
import {Action, Body, Card, Heading, UIProvider, useUI} from './src/ui';

const destinations = [
  {name: 'Chat', icon: 'chat-outline', description: 'Conversations with your Birbcrew.'},
  {name: 'Projects', icon: 'folder-multiple-outline', description: 'The repositories that belong together.'},
  {name: 'Crew', icon: 'account-group-outline', description: 'Your Birbcrew agents and their project assignments.'},
  {name: 'Factory', icon: 'factory', description: 'Machine health and work in progress.'},
  {name: 'Settings', icon: 'tune-variant', description: 'Machine connections and preferences for this device.'},
] as const;
type Destination = typeof destinations[number]['name'];

function Brand() {
  const {colors} = useUI();
  return <View style={styles.brand}>
    <View style={styles.logo}><MaterialCommunityIcons name="bird" color="#293a2a" size={25} /></View>
    <Text style={[styles.wordmark, {color: colors.text}]}>Birbforge</Text>
  </View>;
}

function Navigation({screen, select, wide}: {screen: Destination; select: (screen: Destination) => void; wide: boolean}) {
  const {colors, largeText} = useUI();
  return <View accessibilityRole="tablist" style={wide ? styles.menu : [styles.bar, {backgroundColor: colors.panel, borderColor: colors.line}]}>
    {destinations.map(({name, icon}) => {
      const active = screen === name;
      return <Pressable key={name} accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{selected: active}}
        onPress={() => select(name)} style={({pressed}) => [wide ? styles.tab : styles.smallTab,
          {backgroundColor: active ? colors.tint : 'transparent', opacity: pressed ? 0.72 : 1}]}>
        <MaterialCommunityIcons name={icon} size={wide ? 22 : 21} color={active ? colors.accent : colors.muted} />
        <Text numberOfLines={1} style={{color: active ? colors.accent : colors.muted, fontWeight: active ? '700' : '500',
          fontSize: wide ? largeText ? 19 : 16 : largeText ? 13 : 12}}>{name}</Text>
      </Pressable>;
    })}
  </View>;
}
function ManagedProjects({machine, leave}: {machine: ActiveMachine; leave: () => void}) {
  const projects = useMemo(() => new ProjectClient(machine.endpoint, machine.access), [machine.endpoint, machine.access]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationClient | null>(null);
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  if (conversation) return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <GoalConversation client={conversation} leave={() => setConversation(null)} />
  </ScrollView>;
  return <View style={styles.flex}><ProjectHome client={projects} initialProjectId={projectId} leave={leave}
    openChat={async (id, project) => {
      const next = new ConversationClient(machine.endpoint, machine.access, id, transport, pendingChatStore(machine.endpoint, id));
      try {
        await next.refresh();
        await next.connect();
        if (!alive.current) {next.disconnect(); return;}
        setConversation(next);
        setProjectId(project);
      } catch (error) {next.disconnect(); throw error;}
    }} /></View>;
}

function Shell({settings}: {settings: MachineSettings}) {
  const {colors, largeText} = useUI();
  const {width} = useWindowDimensions();
  const wide = width >= 850;
  const [screen, setScreen] = useState<Destination>('Factory');
  const [openedChat, setOpenedChat] = useState(false);
  const current = destinations.find(item => item.name === screen)!;
  const select = (target: Destination) => {setScreen(target); if (target === 'Chat') setOpenedChat(true);};
  const machine = settings.active;
  const nav = <Navigation wide={wide} screen={screen} select={select} />;
  const machineLink = <Pressable onPress={() => select('Settings')} accessibilityRole="button" accessibilityLabel="Manage machine connection"
    style={[styles.endpoint, {backgroundColor: colors.tint}]}>
    <MaterialCommunityIcons name="server-network" size={18} color={colors.accent} />
    <Text numberOfLines={1} style={{color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1}}>{machine?.name ?? 'No machine'}</Text>
  </Pressable>;
  const title = <View style={{gap: 5}}>
    <Text accessibilityRole="header" style={{fontSize: largeText ? 42 : wide ? 36 : 30, lineHeight: largeText ? 50 : wide ? 44 : 37, fontWeight: '700', letterSpacing: -1.4, color: colors.text}}>{screen}</Text>
    <Body muted>{current.description}</Body>
  </View>;
  return <View style={[styles.layout, {flexDirection: wide ? 'row' : 'column', backgroundColor: colors.bg}]}>
    {wide ? <View style={[styles.sidebar, {borderColor: colors.line, backgroundColor: colors.panel}]}>
      <Brand />{nav}<View style={{marginTop: 'auto'}}>{machineLink}</View>
    </View> : <View style={[styles.mobileHeader, {borderColor: colors.line, backgroundColor: colors.panel}]}><Brand />{machineLink}</View>}
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View key={machine?.sessionId ?? 'disconnected'} style={styles.flex}>
        <View style={[styles.flex, screen !== 'Factory' && styles.hidden]}>
          <ScrollView contentContainerStyle={[styles.page, wide && styles.widePage]} keyboardShouldPersistTaps="handled">
            {screen === 'Factory' && title}
            <FactoryScreen machine={machine} visible={screen === 'Factory'} settings={() => select('Settings')} />
          </ScrollView>
        </View>
        {machine && openedChat && <View style={[styles.chat, !wide && styles.phoneChat, screen !== 'Chat' && styles.hidden]}>
          {screen === 'Chat' && title}
          <ChatScreen session={machine} visible={screen === 'Chat'} />
        </View>}
        {screen === 'Projects' && machine?.managedProjects && <ManagedProjects machine={machine} leave={() => select('Factory')} />}
        {screen !== 'Factory' && !(screen === 'Chat' && machine) && !(screen === 'Projects' && machine?.managedProjects) && <ScrollView key={screen}
          contentContainerStyle={[styles.page, wide && styles.widePage]} keyboardShouldPersistTaps="handled">
          {title}
          {screen === 'Settings' ? <SettingsScreen settings={settings} /> : !machine ?
            <Card><Heading>Connect a machine</Heading><Body muted>Open Settings to connect to the Birbforge server for this workspace.</Body>
              <Action label="Open settings" onPress={() => select('Settings')} /></Card>
            : screen === 'Projects' ? <ProjectsScreen session={machine} /> : <CrewScreen session={machine} />}
        </ScrollView>}
      </View>
    </KeyboardAvoidingView>
    {!wide && nav}
  </View>;
}
export default function App() {
  const settings = useMachineSettings();
  const scheme = useColorScheme();
  const darkMode = settings.theme === 'dark' || settings.theme === 'system' && scheme === 'dark';
  return <UIProvider darkMode={darkMode} largeText={settings.largeText}>
    <SafeAreaProvider><SafeAreaView style={{flex: 1, backgroundColor: darkMode ? '#151d19' : '#f6f5f0'}}>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />
      <Shell settings={settings} />
    </SafeAreaView></SafeAreaProvider>
  </UIProvider>;
}
const styles = StyleSheet.create({
  layout: {flex: 1, minHeight: 0}, flex: {flex: 1, minHeight: 0, minWidth: 0}, hidden: {display: 'none'},
  brand: {flexDirection: 'row', alignItems: 'center', gap: 9},
  logo: {width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#eac988'},
  wordmark: {fontSize: 23, fontWeight: '700', letterSpacing: -1.1},
  sidebar: {width: 217, borderRightWidth: 1, paddingHorizontal: 17, paddingTop: 29, paddingBottom: 25, gap: 42},
  mobileHeader: {paddingHorizontal: 16, minHeight: 58, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  endpoint: {flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 42, maxWidth: 185, paddingHorizontal: 12, borderRadius: 10},
  menu: {gap: 5}, tab: {borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 47, paddingHorizontal: 14},
  bar: {flexDirection: 'row', padding: 5, gap: 2, borderTopWidth: 1},
  smallTab: {flex: 1, minHeight: 53, justifyContent: 'center', alignItems: 'center', gap: 3, borderRadius: 7},
  page: {paddingHorizontal: 16, paddingTop: 22, paddingBottom: 36, gap: 16, width: '100%', maxWidth: 1000, alignSelf: 'center'},
  widePage: {padding: 36, paddingTop: 36, gap: 20},
  chat: {flex: 1, minHeight: 0, width: '100%', padding: 26, gap: 14, maxWidth: 1400, alignSelf: 'center'},
  phoneChat: {padding: 12, gap: 7},
});
