import {useEffect, useRef, useState} from 'react';
import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {randomUUID} from 'expo-crypto';
import {z} from 'zod/v4';
import {authorizationHeaders, discoverAccess, type ClientAccess} from './access';
import {transport} from './transport';

const profilePrefix = 'birbforge.machine.';
const themeKey = 'birbforge.appearance.theme';
const textKey = 'birbforge.appearance.largeText';
const Theme = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof Theme>;

export function serverOrigin(value: string) {
  try {
    const url = new URL(value.trim());
    const loopback = url.hostname === '127.0.0.1';
    if ((url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch {}
  throw new Error('Enter an HTTPS server URL without a path. For local HTTP, use 127.0.0.1 and the gateway port.');
}

export function defaultEndpoint() {
  const configured = process.env.EXPO_PUBLIC_BIRBFORGE_URL ?? process.env.EXPO_PUBLIC_BIRBFORGE_ENDPOINT;
  if (configured) {
    try {return serverOrigin(configured);} catch {}
  }
  if (Platform.OS === 'web' && globalThis.location?.origin) {
    try {return serverOrigin(globalThis.location.origin);} catch {}
  }
  return '';
}

const Machine = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  endpoint: z.string().refine(value => {
    try {return serverOrigin(value) === value;} catch {return false;}
  }),
}).strict();
export type Machine = z.infer<typeof Machine>;
export type ActiveMachine = Machine & {access: ClientAccess; managedProjects: boolean; sessionId: string};
type MachineDraft = Omit<Machine, 'id'> & {id?: string};

async function verifySession(endpoint: string, access: ClientAccess) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await transport(endpoint + '/api/session', {
      method: 'GET', headers: authorizationHeaders(access),
      redirect: 'error', signal: controller.signal,
    });
    if (response.ok) {
      const session = z.object({authenticated: z.literal(true), managedProjects: z.boolean()}).safeParse(await response.json());
      if (session.success) return session.data;
    }
  } catch {
    throw new Error('Could not reach this gateway. Check the server URL and your private network connection.');
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401) throw new Error('The gateway rejected this owner credential.');
  if (response.status === 403) throw new Error('Use the owner credential for this machine.');
  throw new Error('This server did not confirm a Birbforge connection.');
}

export function useMachineSettings() {
  const [profiles, setProfiles] = useState<Machine[]>([]);
  const [active, setActive] = useState<ActiveMachine | null>(null);
  const [theme, setTheme] = useState<Theme>('system');
  const [largeText, setLargeText] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const connectionAttempt = useRef(0);
  useEffect(() => {
    let current = true;
    const load = async () => {
      const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(profilePrefix));
      const values = await AsyncStorage.multiGet([...keys, themeKey, textKey]);
      if (!current) return;
      const machines: Machine[] = [];
      for (const [key, value] of values) {
        if (value === null) continue;
        if (key === themeKey) {
          const parsed = Theme.safeParse(value);
          if (parsed.success) setTheme(parsed.data);
        } else if (key === textKey) setLargeText(value === 'true');
        else {
          try {
            const machine = Machine.parse(JSON.parse(value));
            if (key === profilePrefix + machine.id) machines.push(machine);
          } catch {setLoadError('A saved machine could not be read. Add its connection details again.');}
        }
      }
      setProfiles(machines);
      setReady(true);
      const endpoint = defaultEndpoint();
      if (!endpoint || (Platform.OS === 'web' && endpoint !== globalThis.location.origin)) return;
      const attempt = connectionAttempt.current;
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 12000);
      try {
        const access = await discoverAccess(endpoint, transport, abort.signal);
        if (!current || attempt !== connectionAttempt.current || access.kind !== 'private-single-owner') return;
        const session = await verifySession(endpoint, access);
        if (!current || attempt !== connectionAttempt.current) return;
        const machine = machines.find(item => item.endpoint === endpoint) ?? {id: randomUUID(), name: 'Birbforge', endpoint};
        setProfiles(items => [...items.filter(item => item.id !== machine.id), machine]);
        setActive({...machine, access, managedProjects: session.managedProjects, sessionId: randomUUID()});
      } catch {
        // Explicit connection in Settings reports discovery and authorization errors.
      } finally {clearTimeout(timeout);}
    };
    void load().catch(() => {
      if (current) setLoadError('Could not read the settings saved on this device.');
    }).finally(() => {if (current) setReady(true);});
    return () => {current = false;};
  }, []);

  async function saveMachine(draft: MachineDraft, access?: ClientAccess) {
    const endpoint = serverOrigin(draft.endpoint);
    const name = draft.name.trim();
    if (!name || name.length > 100) throw new Error('Enter a machine name of up to 100 characters.');
    const existing = profiles.find(machine => machine.endpoint === endpoint);
    if (existing && draft.id && existing.id !== draft.id) throw new Error('Another machine already uses this server URL.');
    const profile = {id: draft.id ?? existing?.id ?? randomUUID(), name, endpoint};
    let session: {managedProjects: boolean} | undefined;
    const attempt = ++connectionAttempt.current;
    if (access) {
      if (Platform.OS === 'web' && globalThis.location.origin !== endpoint) {
        throw new Error('Open the machine in your browser to connect from its own server URL.');
      }
      session = await verifySession(endpoint, access);
    }
    if (attempt !== connectionAttempt.current) return;
    try {await AsyncStorage.setItem(profilePrefix + profile.id, JSON.stringify(profile));}
    catch {throw new Error('Could not save this machine on your device.');}
    if (attempt !== connectionAttempt.current) return;
    setProfiles(current => [...current.filter(item => item.id !== profile.id), profile]);
    if (access && session) setActive({...profile, access, managedProjects: session.managedProjects, sessionId: randomUUID()});
    else setActive(current => {
      if (current?.id !== profile.id) return current;
      return current.endpoint === endpoint ? {...current, name} : null;
    });
  }

  function disconnect() {
    connectionAttempt.current++;
    setActive(null);
  }
  async function forgetMachine(id: string) {
    connectionAttempt.current++;
    setActive(current => current?.id === id ? null : current);
    try {await AsyncStorage.removeItem(profilePrefix + id);}
    catch {throw new Error('Could not remove the saved machine from this device.');}
    setProfiles(current => current.filter(profile => profile.id !== id));
  }
  async function changeTheme(value: Theme) {
    await AsyncStorage.setItem(themeKey, value);
    setTheme(value);
  }
  async function changeLargeText(value: boolean) {
    await AsyncStorage.setItem(textKey, String(value));
    setLargeText(value);
  }
  return {ready, loadError, profiles, active, theme, largeText, saveMachine, forgetMachine, disconnect, changeTheme, changeLargeText};
}

export type MachineSettings = ReturnType<typeof useMachineSettings>;
