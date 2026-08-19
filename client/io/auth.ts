// OAuth Authorization Code + PKCE, client-direct to ServiceNow.
//
// No client secret: this is a public client, which is the only correct kind
// for code in a public repository. No OAuth library either — the flow is a
// hundred lines of WebCrypto, and a library here would be more code to audit
// than the thing it replaces.
//
// The verifier is per-login, single-use, and lives only in a local variable
// inside signIn(). That is why authorisation happens in a separate window
// rather than by navigating this page away: a full-page redirect would destroy
// the variable and force the verifier into storage, where it outlives the
// login it belongs to. On device the same shape is provided by
// @capacitor/browser (ASWebAuthenticationSession / Custom Tabs) — never an
// embedded webview, which Apple and most identity providers reject outright.

import { parseInstanceURL } from './config.js';

export interface OAuth {
  readonly instance: URL;
  readonly clientID: string;
  // Served from this origin, so the callback can postMessage back to the app
  // and the app can check the origin of what it receives.
  readonly redirect: string;
}

export function oauthFrom(instance: string, clientID: string, redirect: string): OAuth {
  return { instance: parseInstanceURL(instance), clientID, redirect };
}

export async function signIn(oauth: OAuth): Promise<string> {
  const verifier = randomID(32);
  const state = randomID(16);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));

  const authorize = new URL('/oauth_auth.do', oauth.instance);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: oauth.clientID,
    redirect_uri: oauth.redirect,
    state,
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
  }).toString();

  // Opened from the click that started the login, so it is not a blocked
  // popup. If the organisation federates to Okta or Entra, ServiceNow
  // redirects inside this window on its own — SAML is never touched directly.
  const window_ = window.open(authorize, 'assetwalk-auth', 'width=480,height=760');
  if (window_ === null) throw new Error('sign-in window was blocked');

  const code = await awaitCode(window_, state);

  const response = await fetch(new URL('/oauth_token.do', oauth.instance), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: oauth.clientID,
      redirect_uri: oauth.redirect,
      code,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`token exchange failed: ${response.status}`);

  const token: unknown = await response.json();
  const access = (token as Record<string, unknown>)['access_token'];
  if (typeof access !== 'string') throw new Error('token response had no access_token');
  return access;
}

// The callback page posts the query string back and closes itself. Both checks
// here matter: the origin check rejects a message from anywhere but our own
// callback page, and the state check rejects a code this login did not ask for.
function awaitCode(child: Window, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const closed = setInterval(() => {
      if (child.closed) {
        finish();
        reject(new Error('sign-in was cancelled'));
      }
    }, 500);

    function finish(): void {
      clearInterval(closed);
      window.removeEventListener('message', onMessage);
    }

    function onMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin || typeof event.data !== 'string') return;
      const params = new URLSearchParams(event.data);
      if (params.get('state') !== state) return;
      finish();
      child.close();
      const code = params.get('code');
      if (code === null) reject(new Error(params.get('error') ?? 'sign-in failed'));
      else resolve(code);
    }

    window.addEventListener('message', onMessage);
  });
}

function randomID(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// base64url, per RFC 7636: standard base64 with the two URL-unsafe characters
// swapped and the padding dropped.
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
