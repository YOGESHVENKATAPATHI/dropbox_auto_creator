import AsyncStorage from '@react-native-async-storage/async-storage';
import { FLOW, STORAGE_KEYS } from './constants';

export const defaultFlowData = {
  flowState: FLOW.IDLE,
  email: '',
  getEmailDeleteDone: false,
  oauthRetryCount: 0,
  logoutRetryCount: 0,
  appName: null,
  appKey: null,
  appSecret: null,
  latestTokenPayload: null,
  isRunning: false
};

function parseOrDefault(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

export async function loadFlowData() {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.FLOW_DATA);
  return {
    ...defaultFlowData,
    ...parseOrDefault(raw, {})
  };
}

export async function saveFlowData(data) {
  await AsyncStorage.setItem(STORAGE_KEYS.FLOW_DATA, JSON.stringify(data));
}

export async function patchFlowData(patch) {
  const current = await loadFlowData();
  const updated = { ...current, ...patch };
  await saveFlowData(updated);
  return updated;
}

export async function resetFlowData() {
  await saveFlowData(defaultFlowData);
  await AsyncStorage.setItem(STORAGE_KEYS.PENDING_CREDENTIALS, JSON.stringify([]));
  return defaultFlowData;
}

export async function loadPendingCredentials() {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_CREDENTIALS);
  const parsed = parseOrDefault(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function setPendingCredentials(items) {
  await AsyncStorage.setItem(STORAGE_KEYS.PENDING_CREDENTIALS, JSON.stringify(items));
}

export async function enqueuePendingCredential(item) {
  const current = await loadPendingCredentials();
  const updated = [...current, item];
  await setPendingCredentials(updated);
  return updated;
}
