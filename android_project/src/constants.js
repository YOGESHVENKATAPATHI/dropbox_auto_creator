export const API_BASE = 'https://dropbox-auto-creator.vercel.app';

export const URLS = {
  TEMP_MAIL: 'https://temp-mail.io/',
  DROPBOX_REGISTER: 'https://www.dropbox.com/register',
  DROPBOX_HOME: 'https://www.dropbox.com/home',
  DROPBOX_DEV_APPS: 'https://www.dropbox.com/developers/apps',
  BRIDGE: 'https://dropboxrefesh.vercel.app/',
  BRIDGE_CALLBACK: 'https://dropboxrefesh.vercel.app/api/auth/callback'
};

export const FLOW = {
  IDLE: 'idle',
  GET_EMAIL: 'get_email',
  FILL_DROPBOX: 'fill_dropbox',
  WAIT_VERIFICATION: 'wait_verification',
  CREATE_DROPBOX_APP: 'create_dropbox_app',
  CONFIGURE_DROPBOX_APP: 'configure_dropbox_app',
  OAUTH_BRIDGE: 'oauth_bridge',
  OAUTH_AUTHORIZE: 'oauth_authorize',
  OAUTH_FAILED: 'oauth_failed',
  LOGOUT_DROPBOX: 'logout_dropbox',
  DELETE_EMAIL: 'delete_email',
  DONE: 'done'
};

export const STORAGE_KEYS = {
  FLOW_DATA: '@dropbox_automation/flow_data',
  PENDING_CREDENTIALS: '@dropbox_automation/pending_credentials',
  RUNNING: '@dropbox_automation/running'
};

export const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.179 Mobile Safari/537.36';
