'use strict';

// ---------- Microsoft sign-in for OneDrive ----------
// Authorization code + PKCE with a full-page redirect (no pop-ups, no hidden frames).

const ONEDRIVE = {
  clientId: 'af9c0332-0f12-4bdf-a07c-1ecc9385ebeb',
  authorizeUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  scopes: 'Files.ReadWrite offline_access openid profile',
  connectionKey: 'fastingTimer.onedrive',
  pendingSignInKey: 'fastingTimer.onedriveSignIn',
};

// Tests replace this to capture the sign-in URL instead of leaving the page.
const onedriveHooks = {
  navigate: (url) => location.assign(url),
};

function onedriveConfigured() {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ONEDRIVE.clientId);
}

// Same address whether the app was opened as .../fasting-timer/ or .../fasting-timer/index.html.
function onedriveRedirectUri() {
  return new URL('./', location.href).href;
}

function base64Url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(byteCount) {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteCount)));
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function decodeJwtClaims(jwt) {
  try {
    const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(payload)
        .split('')
        .map((char) => '%' + char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    return JSON.parse(json);
  } catch (err) {
    return {};
  }
}

function readOnedriveJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (err) {
    return null;
  }
}

function getOnedriveConnection() {
  const connection = readOnedriveJSON(ONEDRIVE.connectionKey);
  return connection && connection.refreshToken ? connection : null;
}

function disconnectOneDrive() {
  localStorage.removeItem(ONEDRIVE.connectionKey);
  localStorage.removeItem(ONEDRIVE.pendingSignInKey);
}

async function buildSignInUrl(state, verifier) {
  const params = new URLSearchParams({
    client_id: ONEDRIVE.clientId,
    response_type: 'code',
    redirect_uri: onedriveRedirectUri(),
    response_mode: 'query',
    scope: ONEDRIVE.scopes,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  return `${ONEDRIVE.authorizeUrl}?${params}`;
}

// Leaves the page for Microsoft's sign-in; Microsoft sends the browser back to the app afterwards.
async function connectOneDrive() {
  const state = randomToken(16);
  const verifier = randomToken(48);
  const url = await buildSignInUrl(state, verifier);
  localStorage.setItem(ONEDRIVE.pendingSignInKey, JSON.stringify({ state, verifier, startedAt: Date.now() }));
  onedriveHooks.navigate(url);
}

// Microsoft's error text is "message\r\nTrace ID: ...", so keep only the first line.
const firstLine = (text) => String(text).split(/\r?\n/)[0];

function cleanAddressBar() {
  history.replaceState(null, '', location.pathname);
}

// Call once when the app loads. Returns {handled: false} if this page load is not a sign-in return,
// otherwise {handled: true} plus either {connected: true} or {error: 'message'}.
async function handleAuthRedirect() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return { handled: false };

  const pending = readOnedriveJSON(ONEDRIVE.pendingSignInKey);
  localStorage.removeItem(ONEDRIVE.pendingSignInKey);
  const returnedState = params.get('state');
  const error = params.get('error');
  const description = params.get('error_description');
  const code = params.get('code');
  cleanAddressBar();

  if (error) {
    return { handled: true, error: description ? firstLine(description) : error };
  }
  if (!pending || !returnedState || pending.state !== returnedState) {
    return { handled: true, error: 'The sign-in could not be verified. Please try again.' };
  }

  try {
    const response = await fetch(ONEDRIVE.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ONEDRIVE.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: onedriveRedirectUri(),
        code_verifier: pending.verifier,
        scope: ONEDRIVE.scopes,
      }),
    });
    const tokens = await response.json();
    if (!response.ok || !tokens.refresh_token) {
      return { handled: true, error: tokens.error_description ? firstLine(tokens.error_description) : 'Microsoft did not complete the sign-in.' };
    }
    const claims = decodeJwtClaims(tokens.id_token || '');
    localStorage.setItem(
      ONEDRIVE.connectionKey,
      JSON.stringify({
        accessToken: tokens.access_token,
        accessExpiresAt: Date.now() + tokens.expires_in * 1000,
        refreshToken: tokens.refresh_token,
        signedInAt: Date.now(),
        account: claims.preferred_username || claims.email || claims.name || 'your Microsoft account',
      })
    );
    return { handled: true, connected: true };
  } catch (err) {
    return { handled: true, error: "Couldn't reach Microsoft. Check your connection and try again." };
  }
}
