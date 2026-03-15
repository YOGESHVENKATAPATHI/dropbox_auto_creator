import axios from 'axios';
import { API_BASE } from './constants';

export async function saveCredentials(payload) {
  const response = await axios.post(`${API_BASE}/save-credentials`, payload, {
    timeout: 20000,
    headers: { 'Content-Type': 'application/json' }
  });
  return response.data;
}

export async function pingBackend() {
  const response = await axios.get(`${API_BASE}/`, { timeout: 10000 });
  return response.data;
}
