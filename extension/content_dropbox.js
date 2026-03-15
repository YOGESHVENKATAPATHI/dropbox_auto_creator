const wait = ms => new Promise(r => setTimeout(r, ms));

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function pace(min = 350, max = 850) {
    await wait(randomBetween(min, max));
}

function clickElement(el) {
    if (!el) return false;
    el.scrollIntoView({ behavior: 'auto', block: 'center' });

    try {
        el.focus?.();
        el.click();
        return true;
    } catch (e) {
        try {
            el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
        } catch (err) {
            return false;
        }
    }
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

function randomFrom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function randomLetters(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let out = '';
    for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

function shuffleText(text) {
    const arr = text.split('');
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
}

function generateStrongPassword() {
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nums = '0123456789';
    const syms = '!@#$%^&*()_+-=';
    const all = lower + upper + nums + syms;
    const length = randomBetween(14, 18);

    let password =
        lower[randomBetween(0, lower.length - 1)] +
        upper[randomBetween(0, upper.length - 1)] +
        nums[randomBetween(0, nums.length - 1)] +
        syms[randomBetween(0, syms.length - 1)];

    for (let i = 4; i < length; i++) {
        password += all[randomBetween(0, all.length - 1)];
    }

    return shuffleText(password);
}

function buildUniqueProfile() {
    const firstPool = [
        'Aarav','Liam','Noah','Ethan','Mason','Lucas','Elijah','Logan','Benjamin','Henry',
        'Olivia','Emma','Ava','Sophia','Mia','Amelia','Harper','Evelyn','Aria','Ella',
        'Riya','Anaya','Zara','Nora','Lina','Ira','Kiran','Aanya','Meera','Sia'
    ];
    const lastPool = [
        'Carter','Brooks','Hayes','Reed','Morris','Wright','Foster','Hunter','Porter','Bennett',
        'Shaw','Miller','Turner','Parker','Cooper','Ward','Dawson','Hayden','Griffin','Sutton',
        'Kapoor','Mehta','Sharma','Patel','Verma','Reddy','Nair','Iyer','Malik','Bhat'
    ];

    return {
        firstName: `${randomFrom(firstPool)}${randomLetters(2)}`,
        lastName: `${randomFrom(lastPool)}${randomLetters(3)}`,
        password: generateStrongPassword()
    };
}

function uniqueAppName() {
    const base = randomFrom(['AURORA', 'NEXORA', 'CLOUDMINT', 'SYNCLEAF', 'DATAHIVE', 'DROPNEST', 'FLOWVAULT', 'SKYPULSE']);
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

    const profile = buildUniqueProfile();
    const firstName = profile.firstName;
    const lastName = profile.lastName;
    const password = profile.password;

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
            await pace(350, 900);
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

        await pace(500, 1000);
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
                await pace(350, 900);
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
        await pace(350, 900);
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
        await pace(450, 1000);
        clickElement(continueBtn);
        await wait(900);
    }

    const allowBtn = document.querySelector('.auth-button-allow, button.auth-button-allow');
    if (allowBtn) {
        console.log('Clicking OAuth Allow...');
        await pace(450, 1000);
        clickElement(allowBtn);
    }
}

function findAccountMenuTrigger() {
    const container =
        document.querySelector('#account-menu-trigger__browse') ||
        document.querySelector('[data-test-id="account-menu-trigger"]') ||
        document.querySelector('[data-testid="account-menu-trigger"]');

    if (container) {
        const innerButton = container.querySelector('button');
        if (innerButton) return innerButton;
        if (container.tagName && container.tagName.toLowerCase() === 'button') return container;
    }

    return (
        document.querySelector('button[aria-label*="Account menu" i]') ||
        document.querySelector('button[aria-haspopup="true"][aria-label*="account" i]')
    );
}

function findLogoutButton() {
    const direct =
        document.querySelector('a[href*="/logout"]') ||
        document.querySelector('a[href*="logout"]') ||
        document.querySelector('[data-testid*="logout" i]') ||
        document.querySelector('[data-test-id*="logout" i]') ||
        document.querySelector('[role="menuitem"][href*="logout"]');
    if (direct) return direct;

    const candidates = Array.from(document.querySelectorAll('a, button, div, span'));
    const titleNode = candidates.find(el => (el.textContent || '').trim().toLowerCase() === 'log out');
    if (!titleNode) return null;

    return (
        titleNode.closest('a, button, [role="menuitem"]') ||
        titleNode.parentElement ||
        titleNode
    );
}

function isLoggedOutPage() {
    const path = (location.pathname || '').toLowerCase();
    if (path.includes('/login') || path.includes('/register') || path.includes('/logout')) return true;

    // Require concrete login form fields to avoid false positives on /home text content.
    const loginForm = document.querySelector(
        'input[name="login_email"], input[name="susi_email"], input[type="email"], input[type="password"]'
    );
    return !!loginForm;
}

async function waitForLogoutButton(timeoutMs = 3200, stepMs = 220) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const btn = findLogoutButton();
        if (btn) return btn;
        await wait(stepMs);
    }
    return null;
}

async function performLogoutSequence() {
    // If already logged out, continue immediately.
    if (isLoggedOutPage()) {
        console.log('Dropbox already logged out. Proceeding to next cycle...');
        await chrome.storage.local.set({ logoutRetryCount: 0 });
        chrome.runtime.sendMessage({ action: 'logout_completed' });
        return true;
    }

    let logoutBtn = findLogoutButton();

    // Open account menu in paced attempts because Dropbox UI may re-render instantly.
    for (let attempt = 1; !logoutBtn && attempt <= 3; attempt++) {
        const menuTrigger = findAccountMenuTrigger();
        if (!menuTrigger) {
            console.log('Account menu not ready yet.');
            await pace(500, 900);
            continue;
        }

        console.log(`Clicking account menu (attempt ${attempt})...`);
        clickElement(menuTrigger);
        await pace(700, 1200);
        logoutBtn = await waitForLogoutButton(2600, 220);
    }

    if (logoutBtn) {
        console.log('Clicking logout button...');
        clickElement(logoutBtn);
        await pace(2800, 4200);

        // Only continue after logout is actually reflected in UI/URL.
        if (isLoggedOutPage()) {
            await chrome.storage.local.set({ logoutRetryCount: 0 });
            chrome.runtime.sendMessage({ action: 'logout_completed' });
            return true;
        }

        console.log('Logout clicked but session still active. Retrying...');
    }

    return false;
}

async function startDropboxFlow() {
    const data = await chrome.storage.local.get(['flowState', 'email', 'logoutRetryCount']);

    if (data.flowState === 'logout_dropbox') {
        await pace(300, 700);
        const done = await performLogoutSequence();
        if (!done) {
            const nextRetry = Number(data.logoutRetryCount || 0) + 1;
            await chrome.storage.local.set({ logoutRetryCount: nextRetry });

            // Keep trying on redirect-heavy Dropbox pages until true logout is detected.
            if (nextRetry % 5 === 0) {
                console.log(`Still not logged out after ${nextRetry} attempts.`);
            }
            setTimeout(startDropboxFlow, randomBetween(2600, 4200));
        }
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