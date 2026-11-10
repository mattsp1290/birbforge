import AsyncStorage from '@react-native-async-storage/async-storage';
import type {PendingPromptStore} from './controller';

export function pendingChatStore(endpoint: string, id: string): PendingPromptStore {
  const key = `birbforge.pending-prompt.v1.${new URL(endpoint).origin}.${id}`;
  return {
    async load() {const value = await AsyncStorage.getItem(key); return value ? JSON.parse(value) : null;},
    async save(prompt) {await AsyncStorage.setItem(key, JSON.stringify(prompt));},
    async clear() {await AsyncStorage.removeItem(key);},
  };
}
