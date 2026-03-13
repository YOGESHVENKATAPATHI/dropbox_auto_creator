console.log("Ghost Automator Background Script Loaded.");

const API_BASE_CANDIDATES = [
    'http://localhost:3000',
    'http://127.0.0.1:3000'
];

async function postCredentialsToBackend(payload) {
    let lastError = null;

    for (const base of API_BASE_CANDIDATES) {
        const url = `${base}/save-credentials`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(`save-credentials failed (${response.status}): ${body}`);
            }

            const json = await response.json();
            return { ...json, endpoint: base };
        } catch (err) {
            lastError = err;
        }
    }

    throw lastError || new Error('Could not reach any local API endpoint');
}

// Listen for the user clicking the extension icon
chrome.action.onClicked.addListener(async (tab) => {
    console.log("Extension Clicked! Starting flow...");
    
    // Clear out old data and set state to 1 (Get Email)
    await chrome.storage.local.set({ 
        flowState: 'get_email', 
        email: '',
        getEmailDeleteDone: false
    });
    
    // Open Temp Mail to start
    chrome.tabs.create({ url: "https://temp-mail.io/" });
});

// The content scripts talk to this brain
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Step 2: Email was copied, move to Dropbox
    if (request.action === "email_copied") {
        console.log("Email grabbed:", request.email);
        chrome.storage.local.set({ email: request.email, flowState: 'fill_dropbox' });
        chrome.tabs.create({ url: "https://www.dropbox.com/register" });
    } 
    
    // Step 4: Form is filled, move back to Temp-Mail for verification
    else if (request.action === "signup_completed") {
        console.log("Signup form filled. Going to verify email...");
        chrome.storage.local.set({ flowState: 'wait_verification' });
        // After 5 seconds, open temp-mail again to check for the verification email
        setTimeout(() => {
            chrome.tabs.create({ url: "https://temp-mail.io/" });
        }, 5000);
    }

    // Step 5: verification link was clicked, start app creation pipeline.
    else if (request.action === 'email_verified') {
        console.log('Email verification clicked. Opening Dropbox developers app page...');
        chrome.storage.local.set({ flowState: 'create_dropbox_app' });
        setTimeout(() => {
            chrome.tabs.create({ url: 'https://www.dropbox.com/developers/apps' });
        }, 6000);
    }

    // Start a fresh cycle by logging out from Dropbox first.
    else if (request.action === 'start_new_cycle') {
        console.log('Starting new automation cycle: opening Dropbox logout flow...');
        chrome.storage.local.set({
            flowState: 'logout_dropbox',
            email: '',
            getEmailDeleteDone: false,
            oauthRetryCount: 0
        });
        chrome.tabs.create({ url: 'https://www.dropbox.com/login?src=logout' });
    }

    // After logout sequence, go back to temp-mail for the next cycle.
    else if (request.action === 'logout_completed') {
        console.log('Dropbox logout completed. Returning to temp-mail...');
        chrome.storage.local.set({
            flowState: 'get_email',
            email: '',
            getEmailDeleteDone: false,
            oauthRetryCount: 0
        });
        chrome.tabs.create({ url: 'https://temp-mail.io/' });
    }

    // Persist captured Dropbox credentials and refresh token.
    else if (request.action === 'persist_credentials') {
        postCredentialsToBackend(request.payload)
            .then((result) => {
                console.log('Credentials saved:', result);
                sendResponse({ ok: true, result });
            })
            .catch((err) => {
                console.error('Failed to save credentials:', err.message);
                chrome.storage.local.get(['pendingCredentials'], (data) => {
                    const pending = Array.isArray(data.pendingCredentials) ? data.pendingCredentials : [];
                    pending.push({ ...request.payload, queuedAt: Date.now(), error: err.message });
                    chrome.storage.local.set({ pendingCredentials: pending }, () => {
                        sendResponse({
                            ok: false,
                            error: err.message,
                            queuedLocally: true,
                            queueSize: pending.length
                        });
                    });
                });
            });
        return true;
    }
    
    return true; // Keep message port open
});