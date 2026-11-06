import {getRandomValues, randomUUID} from 'expo-crypto';
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {value: {getRandomValues, randomUUID}, configurable: true});
} else if (!globalThis.crypto.getRandomValues) {
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {value: getRandomValues});
}
