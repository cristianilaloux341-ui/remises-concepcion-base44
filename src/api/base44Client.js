import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId: "6a1fcdd119031a7db72f3840",
  token,
  functionsVersion: "v1",
  serverUrl: "https://base44.app",
  appBaseUrl: "https://base44.app",
  requiresAuth: false,
});