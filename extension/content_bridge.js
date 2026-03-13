const wait = ms => new Promise(r => setTimeout(r, ms));

async function humanTypeDOM(element, text) {
    if (!element) return;
    element.focus();
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    let current = '';
    for (const ch of text) {
        current += ch;
        setter.call(element, current);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(Math.floor(Math.random() * 60) + 40);
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
}

async function fillBridgeOAuthForm(data) {
    const form = document.querySelector('#oauthForm');
    if (!form) return;

    const appKeyInput = document.querySelector('#appKey');
    const appSecretInput = document.querySelector('#appSecret');
    const submitBtn = form.querySelector('button[type="submit"]') ||
        Array.from(form.querySelectorAll('button')).find(b => {
            const t = (b.textContent || '').toLowerCase();
            return t.includes('get refresh token') || t.includes('get access token');
        });

    if (!appKeyInput || !appSecretInput || !submitBtn) return;

    if (!appKeyInput.value) await humanTypeDOM(appKeyInput, data.appKey || '');
    if (!appSecretInput.value) await humanTypeDOM(appSecretInput, data.appSecret || '');

    await wait(500);
    submitBtn.click();

    await chrome.storage.local.set({ flowState: 'oauth_authorize' });
}

function looksLikeToken(value) {
    if (!value) return false;
    const token = value.trim();
    if (token.length < 30) return false;
    return /^[A-Za-z0-9._-]+$/.test(token);
}

function extractTokenPayloadFromPage() {
    const preText = document.querySelector('pre')?.textContent?.trim();

    if (preText) {
        try {
            const json = JSON.parse(preText);
            if (json && json.refresh_token) {
                return {
                    refreshToken: json.refresh_token,
                    accessToken: json.access_token || null,
                    accountId: json.account_id || null,
                    uid: json.uid || null,
                    scope: json.scope || null
                };
            }
        } catch (e) {
            if (looksLikeToken(preText)) {
                return {
                    refreshToken: preText,
                    accessToken: null,
                    accountId: null,
                    uid: null,
                    scope: null
                };
            }
        }
    }

    const bodyText = (document.body?.innerText || '').trim();
    if (!bodyText) return null;

    // JSON-like page content rendered as plain text.
    const jsonTokenMatch = bodyText.match(/"refresh_token"\s*:\s*"([^"]+)"/i);
    if (jsonTokenMatch && looksLikeToken(jsonTokenMatch[1])) {
        const accessTokenMatch = bodyText.match(/"access_token"\s*:\s*"([^"]+)"/i);
        const accountIdMatch = bodyText.match(/"account_id"\s*:\s*"([^"]+)"/i);
        const uidMatch = bodyText.match(/"uid"\s*:\s*"([^"]+)"/i);
        const scopeMatch = bodyText.match(/"scope"\s*:\s*"([^"]+)"/i);
        return {
            refreshToken: jsonTokenMatch[1],
            accessToken: accessTokenMatch ? accessTokenMatch[1] : null,
            accountId: accountIdMatch ? accountIdMatch[1] : null,
            uid: uidMatch ? uidMatch[1] : null,
            scope: scopeMatch ? scopeMatch[1] : null
        };
    }

    // New format: callback page contains only a refresh token string.
    if (looksLikeToken(bodyText)) {
        return {
            refreshToken: bodyText,
            accessToken: null,
            accountId: null,
            uid: null,
            scope: null
        };
    }

    return null;
}

async function handleInvalidStatePage(data) {
    const bodyText = (document.body?.innerText || '').toLowerCase();
    if (!bodyText.includes('invalid or expired state')) return false;

    const retries = Number(data.oauthRetryCount || 0);
    if (retries >= 3) {
        console.error('OAuth state invalid after max retries. Stopping automatic retry loop.');
        await chrome.storage.local.set({ flowState: 'oauth_failed' });
        return true;
    }

    console.warn(`OAuth state invalid, retrying bridge flow (${retries + 1}/3)...`);
    await chrome.storage.local.set({
        flowState: 'oauth_bridge',
        oauthRetryCount: retries + 1
    });

    setTimeout(() => {
        window.location.href = 'https://dropboxrefesh.vercel.app/';
    }, 1200);

    return true;
}

async function captureRefreshTokenAndPersist(data) {
    const tokenPayload = extractTokenPayloadFromPage();
    if (!tokenPayload || !tokenPayload.refreshToken) return;

    const payload = {
        appKey: data.appKey,
        appSecret: data.appSecret,
        refreshToken: tokenPayload.refreshToken,
        accessToken: tokenPayload.accessToken,
        accountId: tokenPayload.accountId,
        uid: tokenPayload.uid,
        scope: tokenPayload.scope,
        appName: data.appName || null
    };

    console.log('Captured refresh token. Saving to backend...');
    chrome.runtime.sendMessage({ action: 'persist_credentials', payload }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('persist_credentials runtime error:', chrome.runtime.lastError.message);
            return;
        }

        if (!response || !response.ok) {
            if (response?.queuedLocally) {
                console.warn(`Backend unavailable. Credentials queued locally (queue=${response.queueSize}).`);
            } else {
                console.error('Failed to persist credentials:', response?.error || 'Unknown error');
            }
            return;
        }

        console.log('Credentials persisted:', response.result);
        chrome.storage.local.set({ flowState: 'done', latestTokenPayload: payload, oauthRetryCount: 0 }, () => {
            chrome.runtime.sendMessage({ action: 'start_new_cycle' });
        });
    });
}

async function runBridgeAutomation() {
    const data = await chrome.storage.local.get(['flowState', 'appKey', 'appSecret', 'appName', 'oauthRetryCount']);

    const handledInvalidState = await handleInvalidStatePage(data);
    if (handledInvalidState) return;

    if (data.flowState === 'oauth_bridge') {
        await fillBridgeOAuthForm(data);
    }

    await captureRefreshTokenAndPersist(data);
}

setTimeout(runBridgeAutomation, 1200);
