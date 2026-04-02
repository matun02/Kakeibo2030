const DRIVE_DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export default class GoogleDriveService {
  constructor({ clientId, apiKey, fileName, onStatusChange }) {
    this.clientId = clientId;
    this.apiKey = apiKey;
    this.fileName = fileName;
    this.onStatusChange = onStatusChange || (() => {});

    this.gapiInited = false;
    this.gisInited = false;
    this.tokenClient = null;
    this.accessToken = null;

    this.pendingSnapshot = null;
    this.syncTimer = null;
  }

  async initialize() {
    await Promise.all([this.#initializeGapi(), this.#initializeGis()]);
    this.#updateStatus('offline');
  }

  isSignedIn() {
    return Boolean(this.accessToken);
  }

  async signIn() {
    await this.initialize();
    this.#updateStatus('syncing');

    const tokenResponse = await new Promise((resolve, reject) => {
      this.tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      };
      this.tokenClient.requestAccessToken({ prompt: this.accessToken ? '' : 'consent' });
    });

    this.accessToken = tokenResponse.access_token;
    this.#updateStatus('synced');
    return tokenResponse;
  }

  signOut() {
    if (!this.accessToken) return;
    window.google.accounts.oauth2.revoke(this.accessToken);
    this.accessToken = null;
    this.pendingSnapshot = null;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.#updateStatus('offline');
  }

  async performInitialSync(localSnapshot) {
    this.#assertSignedIn();
    this.#updateStatus('syncing');

    const file = await this.#findAppDataFile();
    if (file) {
      const cloudSnapshot = await this.#downloadSnapshot(file.id);
      this.#updateStatus('synced');
      return { source: 'cloud', snapshot: cloudSnapshot, fileId: file.id };
    }

    await this.#uploadSnapshot(localSnapshot);
    this.#updateStatus('synced');
    return { source: 'local', snapshot: localSnapshot };
  }

  queueSync(snapshot) {
    if (!this.isSignedIn()) {
      this.#updateStatus('offline');
      return;
    }

    this.pendingSnapshot = snapshot;
    if (this.syncTimer) return;

    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.flushSync().catch(() => {
        this.#updateStatus('error');
      });
    }, 600);
  }

  async flushSync() {
    this.#assertSignedIn();
    if (!this.pendingSnapshot) return;

    const snapshot = this.pendingSnapshot;
    this.pendingSnapshot = null;

    this.#updateStatus('syncing');
    const file = await this.#findAppDataFile();
    await this.#uploadSnapshot(snapshot, file?.id);
    this.#updateStatus('synced');
  }

  async #initializeGapi() {
    if (this.gapiInited) return;

    await new Promise((resolve, reject) => {
      if (!window.gapi?.load) {
        reject(new Error('GAPI script is not available.'));
        return;
      }
      window.gapi.load('client', async () => {
        try {
          await window.gapi.client.init({
            apiKey: this.apiKey,
            discoveryDocs: [DRIVE_DISCOVERY_DOC],
          });
          this.gapiInited = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async #initializeGis() {
    if (this.gisInited) return;

    if (!window.google?.accounts?.oauth2) {
      throw new Error('Google Identity Services script is not available.');
    }

    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_SCOPE,
      callback: () => {},
    });

    this.gisInited = true;
  }

  #assertSignedIn() {
    if (!this.accessToken) {
      throw new Error('Not signed in to Google.');
    }
  }

  async #findAppDataFile() {
    const response = await window.gapi.client.drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${this.fileName}' and trashed=false`,
      fields: 'files(id,name,modifiedTime)',
      pageSize: 1,
    });

    return response.result.files?.[0] || null;
  }

  async #downloadSnapshot(fileId) {
    const response = await window.gapi.client.drive.files.get({ fileId, alt: 'media' });
    return response.result;
  }

  async #uploadSnapshot(snapshot, fileId = null) {
    const metadata = fileId
      ? { name: this.fileName }
      : { name: this.fileName, parents: ['appDataFolder'], mimeType: 'application/json' };

    const boundary = 'kakeibo2030_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(snapshot) +
      closeDelimiter;

    const endpoint = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    const method = fileId ? 'PATCH' : 'POST';

    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!response.ok) {
      throw new Error(`Drive upload failed: ${response.status}`);
    }
  }

  #updateStatus(status) {
    this.onStatusChange(status);
  }
}
