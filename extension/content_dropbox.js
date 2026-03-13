const wait = ms => new Promise(r => setTimeout(r, ms));

function clickElement(el) {
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
}

async function humanTypeDOM(element, text) {
    if (!element) return;
    element.focus();
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));

    let currentValue = '';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    for (const char of text) {
        currentValue += char;
        setter.call(element, currentValue);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(Math.floor(Math.random() * 70) + 40);
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
}

function uniqueAppName() {
    const base = 'YOGESH';
    const rand = Math.random().toString(36).slice(2, 10);
    return `${base}${rand}`;
}

async function fillRegisterStep(data) {
    const emailInput = document.querySelector('input[type="email"], input[name="login_email"], input[name="susi_email"]');
    if (!emailInput) return;

    console.log('Found Dropbox email input. Filling...');
    await humanTypeDOM(emailInput, data.email || '');
    await wait(700);

    const continueBtn = document.querySelector('button.email-submit-button, button[type="submit"]');
    if (continueBtn) clickElement(continueBtn);
    else emailInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));

    await wait(3500);

    const firstName = ['James', 'John', 'Emma', 'Olivia'][Math.floor(Math.random() * 4)];
    const lastName = ['Smith', 'Johnson', 'Brown', 'Jones'][Math.floor(Math.random() * 4)];
    const password = 'Yogesh@1972005';

    await humanTypeDOM(document.querySelector('input[name="fname"], input[name="first_name"]'), firstName);
    await wait(300);
    await humanTypeDOM(document.querySelector('input[name="lname"], input[name="last_name"]'), lastName);
    await wait(300);
    await humanTypeDOM(document.querySelector('input[name="password"], input[type="password"]'), password);
    await wait(600);

    const submit = Array.from(document.querySelectorAll('button')).find(b => {
        const t = (b.innerText || '').toLowerCase();
        return t.includes('agree and sign up') || t.includes('create an account');
    });
    if (submit) {
        clickElement(submit);
        chrome.runtime.sendMessage({ action: 'signup_completed' });
    }
}

async function ensureCreateAppPage(data) {
    if (location.pathname === '/developers/apps') {
        const createBtn = document.querySelector('a.app-list__create-btn, .app-list__header a[href="/developers/apps/create"]');
        if (createBtn) {
            console.log('Clicking Create app on My apps page...');
            clickElement(createBtn);
        }
        return;
    }

    if (location.pathname === '/developers/apps/create') {
        const scoped = document.querySelector('#scoped');
        if (scoped && !scoped.checked) clickElement(scoped);

        const appFolder = document.querySelector('#app_folder_permission');
        if (appFolder && !appFolder.checked) clickElement(appFolder);

        const nameInput = document.querySelector('#app-name, input[name="name"]');
        if (nameInput && !nameInput.value) {
            const appName = uniqueAppName();
            await humanTypeDOM(nameInput, appName);
            await chrome.storage.local.set({ appName });
        }

        const tos = document.querySelector('#accept-tos');
        if (tos && !tos.checked) clickElement(tos);

        await wait(500);
        const createButton = document.querySelector('#create-button.button-primary, #create-button, button#create-button');
        if (createButton) {
            console.log('Submitting Dropbox app creation...');
            clickElement(createButton);
            await chrome.storage.local.set({ flowState: 'configure_dropbox_app' });
        }
    }
}

async function configureAppSettings(data) {
    const isDevelopersSettings = location.pathname.includes('/developers/apps/') && !location.pathname.endsWith('/create');
    if (!isDevelopersSettings) return;

    const redirectInput = document.querySelector('form#oauth-add-uri-form input[name="oauth_uri"], input.app-info__url-input[name="oauth_uri"]');
    if (redirectInput) {
        const redirectUri = 'https://dropboxrefesh.vercel.app/api/auth/callback';
        const currentUris = (document.querySelector('#oauth-uri-list')?.innerText || '').toLowerCase();
        if (!currentUris.includes(redirectUri.toLowerCase())) {
            await humanTypeDOM(redirectInput, redirectUri);
            const addBtn = document.querySelector('form#oauth-add-uri-form input[type="submit"], form#oauth-add-uri-form .freshbutton-silver');
            if (addBtn) {
                console.log('Adding OAuth redirect URI...');
                clickElement(addBtn);
                await wait(1200);
            }
        }
    }

    let appKey = document.querySelector('.app-key')?.textContent?.trim();
    const appSecretContainer = document.querySelector('.app-secret');
    const secretShow = appSecretContainer?.querySelector('a');
    if (secretShow) {
        clickElement(secretShow);
        await wait(500);
    }

    const appSecret = appSecretContainer?.getAttribute('data-app-secret') || appSecretContainer?.textContent?.trim();

    if (appKey && appSecret) {
        await chrome.storage.local.set({ appKey, appSecret });
    }

    const permissionsTab = document.querySelector('a[data-hash="permissions"], a.c-tabs__label[href="#"]#tab_pyxl3564164188837752160') ||
                           Array.from(document.querySelectorAll('a.c-tabs__label')).find(a => (a.textContent || '').trim().toLowerCase() === 'permissions');
    if (permissionsTab) {
        clickElement(permissionsTab);
        await wait(1200);
    }

    const panel = document.querySelector('div.c-tabs__content--selected, #pyxl3564164188837752160');
    if (panel) {
        const checkboxes = Array.from(panel.querySelectorAll('input[type="checkbox"]'));
        for (const cb of checkboxes) {
            if (!cb.disabled && !cb.checked) clickElement(cb);
        }

        await wait(700);
        const submitPermissions = document.querySelector('.permissions-submit-button, button.permissions-submit-button');
        if (submitPermissions) clickElement(submitPermissions);
    }

    if (appKey && appSecret) {
        await chrome.storage.local.set({ flowState: 'oauth_bridge' });
        window.open('https://dropboxrefesh.vercel.app', '_blank');
    }
}

async function handleOAuthAuthorizePages(data) {
    if (data.flowState !== 'oauth_authorize') return;

    const continueBtn = document.querySelector('#warning-button-continue, .auth-button-continue');
    if (continueBtn) {
        console.log('Clicking OAuth Continue...');
        clickElement(continueBtn);
        await wait(900);
    }

    const allowBtn = document.querySelector('.auth-button-allow, button.auth-button-allow');
    if (allowBtn) {
        console.log('Clicking OAuth Allow...');
        clickElement(allowBtn);
    }
}

function findAccountMenuTrigger() {
    return (
        document.querySelector('#account-menu-trigger__browse') ||
        document.querySelector('[data-test-id="account-menu-trigger"]') ||
        document.querySelector('[data-testid="account-menu-trigger"]') ||
        document.querySelector('button[aria-label*="Account menu" i]') ||
        document.querySelector('button[aria-haspopup="true"][aria-label*="account" i]')
    );
}

function findLogoutButton() {
    const direct =
        document.querySelector('a[href*="/logout"]') ||
        document.querySelector('[data-testid*="logout" i]') ||
        document.querySelector('[data-test-id*="logout" i]');
    if (direct) return direct;

    const candidates = Array.from(document.querySelectorAll('a, button, div, span'));
    return candidates.find(el => (el.textContent || '').trim().toLowerCase() === 'log out') || null;
}

function isLoggedOutPage() {
    const path = (location.pathname || '').toLowerCase();
    if (path.includes('/login') || path.includes('/register')) return true;

    const loginForm = document.querySelector('input[name="login_email"], input[name="susi_email"], input[type="email"]');
    const loginText = (document.body?.innerText || '').toLowerCase();
    return !!loginForm || loginText.includes('sign in') || loginText.includes('log in');
}

async function performLogoutSequence() {
    // If already logged out, continue immediately.
    if (isLoggedOutPage()) {
        console.log('Dropbox already logged out. Proceeding to next cycle...');
        chrome.runtime.sendMessage({ action: 'logout_completed' });
        return;
    }

    const menuTrigger = findAccountMenuTrigger();
    if (menuTrigger) {
        console.log('Clicking account menu...');
        clickElement(menuTrigger);
        await wait(1200);
    }

    const logoutBtn = findLogoutButton();
    if (logoutBtn) {
        console.log('Clicking logout button...');
        clickElement(logoutBtn);
        await wait(2200);
        chrome.runtime.sendMessage({ action: 'logout_completed' });
        return;
    }

    // Retry for delayed menu rendering.
    await wait(1500);
    const retryLogoutBtn = findLogoutButton();
    if (retryLogoutBtn) {
        console.log('Clicking logout button (retry)...');
        clickElement(retryLogoutBtn);
        await wait(2200);
        chrome.runtime.sendMessage({ action: 'logout_completed' });
        return;
    }

    // If URL already points to explicit logout entry, continue to next stage.
    if ((location.href || '').includes('src=logout')) {
        console.log('Logout URL loaded; continuing cycle.');
        chrome.runtime.sendMessage({ action: 'logout_completed' });
    }
}

async function startDropboxFlow() {
    const data = await chrome.storage.local.get(['flowState', 'email']);

    if (data.flowState === 'logout_dropbox') {
        await performLogoutSequence();
        return;
    }

    if (data.flowState === 'fill_dropbox') {
        await fillRegisterStep(data);
        return;
    }

    if (data.flowState === 'create_dropbox_app') {
        await ensureCreateAppPage(data);
        return;
    }

    if (data.flowState === 'configure_dropbox_app') {
        await configureAppSettings(data);
        return;
    }

    await handleOAuthAuthorizePages(data);
}

setTimeout(startDropboxFlow, 1500);