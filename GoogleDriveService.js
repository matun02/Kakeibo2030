const DEFAULT_TOKEN_STORAGE_KEY = 'kakeibo_google_token';

export default class GoogleDriveService {
  constructor({ clientId, scope, fileName, onStatusChange, tokenStorageKey = DEFAULT_TOKEN_STORAGE_KEY }) {
    this.clientId = clientId;
    this.scope = scope;
    this.fileName = fileName;
    this.onStatusChange = onStatusChange || (() => {});
    this.tokenStorageKey = tokenStorageKey;

    this.gapiInited = false;
    this.gisInited = false;
    this.tokenClient = null;
    this.accessToken = null;
    this.expiresAt = 0;

    this.initializePromise = null;
  }

  async initializeDrive() {
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = (async () => {
      await this.#waitForGoogleScripts();
      await Promise.all([this.#initializeGapi(), this.#initializeGis()]);
      this.#restoreTokenFromStorage();
      this.#updateStatus(this.isSignedIn() ? 'connected' : 'offline');
    })();

    return this.initializePromise;
  }

  isSignedIn() {
    return Boolean(this.accessToken) && Date.now() < this.expiresAt;
  }

  async ensureAuthorized() {
    await this.initializeDrive();

    if (this.isSignedIn()) {
      this.#updateStatus('connected');
      return true;
    }

    try {
      await this.requestAccessToken({ interactive: false });
      this.#updateStatus('connected');
      return true;
    } catch {
      this.#updateStatus('offline');
      return false;
    }
  }

  async signIn() {
    await this.initializeDrive();
    this.#updateStatus('connecting');
    await this.requestAccessToken({ interactive: true });
    this.#updateStatus('connected');
  }

  signOut() {
    if (this.accessToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(this.accessToken, () => {});
    }

    this.#clearToken();
    this.#updateStatus('offline');
  }

  async requestAccessToken({ interactive }) {
    const tokenResponse = await new Promise((resolve, reject) => {
      this.tokenClient.callback = (response) => {
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      };

      this.tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    });

    this.#setToken(tokenResponse.access_token, Number(tokenResponse.expires_in || 0));
    return tokenResponse;
  }

  async loadData() {
    this.#assertSignedIn();
    this.#updateStatus('syncing');

    const file = await this.#findDataFile();
    if (!file) {
      this.#updateStatus('synced');
      return null;
    }

    const response = await window.gapi.client.drive.files.get({
      fileId: file.id,
      alt: 'media',
    });

    this.#updateStatus('synced');
    return response.result;
  }

  async saveData(data) {
    this.#assertSignedIn();
    this.#updateStatus('syncing');

    const file = await this.#findDataFile();
    await this.#uploadData(data, file?.id);

    this.#updateStatus('synced');
  }

  async #waitForGoogleScripts(timeoutMs = 12000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      if (window.gapi?.load && window.google?.accounts?.oauth2) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error('Google API scripts failed to load in time.');
  }

  async #initializeGapi() {
    if (this.gapiInited) return;

    await new Promise((resolve, reject) => {
      window.gapi.load('client', async () => {
        try {
          await window.gapi.client.load('drive', 'v3');
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

    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: this.scope,
      callback: () => {},
    });

    this.gisInited = true;
  }

  #restoreTokenFromStorage() {
    try {
      const raw = localStorage.getItem(this.tokenStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.access_token || !parsed?.expires_at) return;
      if (Date.now() >= Number(parsed.expires_at)) {
        this.#clearToken();
        return;
      }

      this.accessToken = parsed.access_token;
      this.expiresAt = Number(parsed.expires_at);
      window.gapi.client.setToken({ access_token: this.accessToken });
    } catch {
      this.#clearToken();
    }
  }

  #setToken(accessToken, expiresInSec) {
    const expiresAt = Date.now() + expiresInSec * 1000;
    this.accessToken = accessToken;
    this.expiresAt = expiresAt;
    window.gapi.client.setToken({ access_token: accessToken });

    localStorage.setItem(
      this.tokenStorageKey,
      JSON.stringify({
        access_token: accessToken,
        expires_at: expiresAt,
      })
    );
  }

  #clearToken() {
    this.accessToken = null;
    this.expiresAt = 0;
    localStorage.removeItem(this.tokenStorageKey);
    if (window.gapi?.client?.setToken) {
      window.gapi.client.setToken(null);
    }
  }

  #assertSignedIn() {
    if (!this.isSignedIn()) {
      throw new Error('Not signed in to Google.');
    }
  }

  async #findDataFile() {
    const response = await window.gapi.client.drive.files.list({
      q: `name='${this.fileName}' and trashed=false`,
      fields: 'files(id,name,modifiedTime)',
      pageSize: 1,
      spaces: 'drive',
    });

    return response.result.files?.[0] || null;
  }

  async #uploadData(data, fileId = null) {
    const metadata = fileId ? { name: this.fileName } : { name: this.fileName, mimeType: 'application/json' };

    const boundary = 'kakeibo2030_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(data) +
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
