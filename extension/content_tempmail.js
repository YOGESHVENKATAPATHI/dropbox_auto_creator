const wait = ms => new Promise(r => setTimeout(r, ms));

function clickElement(el) {
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
}

function clickRefreshButton() {
    const selectors = [
        'button[data-qa="refresh-button"]',
        '[data-qa="refresh-button"]',
        'button[title*="Refresh"]',
        'button[aria-label*="Refresh"]'
    ];

    for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn && clickElement(btn)) {
            return true;
        }
    }

    const byText = Array.from(document.querySelectorAll('button, a, span, div')).find(el => {
        const t = (el.innerText || '').trim().toLowerCase();
        return t === 'refresh' || t.includes(' refresh');
    });

    return clickElement(byText);
}

function clickDeleteButton() {
    const selectors = [
        'button[data-qa="delete-button"]',
        '[data-qa="delete-button"]',
        'button[title*="Delete"]',
        'button[aria-label*="Delete"]'
    ];

    for (const selector of selectors) {
        const btn = document.querySelector(selector);
        if (btn && clickElement(btn)) {
            return true;
        }
    }

    const byText = Array.from(document.querySelectorAll('button, a, span, div')).find(el => {
        const t = (el.innerText || '').trim().toLowerCase();
        return t === 'delete' || t.includes(' delete');
    });

    return clickElement(byText);
}

function findDropboxMessageRow() {
    const rows = Array.from(document.querySelectorAll('li[data-qa="message"], .message.list-complete-item, ul.email-list li.message'));
    for (const row of rows) {
        const sender = (row.querySelector('[title*="dropbox" i], .truncate')?.textContent || '').toLowerCase();
        const subject = (row.querySelector('[data-qa="message-subject"], .message__subject')?.textContent || '').toLowerCase();
        const body = (row.textContent || '').toLowerCase();

        if (sender.includes('dropbox') || subject.includes('verify your email') || body.includes('dropbox')) {
            return row;
        }
    }
    return null;
}

async function main() {
    const data = await chrome.storage.local.get(['flowState', 'getEmailDeleteDone']);
    console.log("Current state:", data.flowState);

    // FLOW 1: Grabbing the email for the first time
    if (data.flowState === 'get_email') {
        if (!data.getEmailDeleteDone) {
            console.log("New cycle detected. Clicking delete button first...");
            const deleted = clickDeleteButton();

            if (deleted) {
                await chrome.storage.local.set({ getEmailDeleteDone: true });
                await wait(2500);
            } else {
                console.log("Delete button not found yet. Retrying shortly...");
                setTimeout(main, 2000);
                return;
            }
        }

        console.log("Waiting for email address to generate...");
        
        let email = "";
        for (let i = 0; i < 15; i++) { // wait up to 15 seconds
            await wait(1000);
            const input = document.querySelector('input[id="email"]') || document.querySelector('input[type="text"]');
            if (input && input.value && input.value.includes('@')) {
                email = input.value;
                break;
            }
        }
        
        if (email) {
            console.log("Caught email:", email);
            chrome.runtime.sendMessage({ action: "email_copied", email: email });
        } else {
            console.log("Could not find email address.");
        }
    } 
    
    // FLOW 3: Coming back here to click verification
    else if (data.flowState === 'wait_verification') {
        console.log("Scanning for Dropbox Verification email...");
        
        let foundEmailRow = false;
        for (let i = 0; i < 60; i++) {
            console.log(`Poll ${i + 1}/60: clicking refresh and checking inbox...`);
            clickRefreshButton();
            await wait(2500);

            const row = findDropboxMessageRow();
            if (row) {
                console.log("Found Dropbox email row. Clicking subject/row...");
                const subject = row.querySelector('[data-qa="message-subject"], .message__subject');
                if (!clickElement(subject)) {
                    clickElement(row);
                }
                foundEmailRow = true;
                break;
            }

            // Required cadence: refresh every 10 seconds.
            await wait(10000);
        }

        if (foundEmailRow) {
            await wait(3000); // Let the email load
            console.log("Scanning email body for verify button...");
            
            for(let i=0; i<30; i++) {
                // Dropbox uses a literal <a> tag for the link that says "Verify your email"
                let verifyBtn = Array.from(document.querySelectorAll('a')).find(a => 
                    a.innerText && a.innerText.toLowerCase().includes('verify your email')
                );
                
                if (verifyBtn) {
                    console.log("Found Dropbox Verify Link! Navigating directly to it...");
                    // Navigate to verify URL and signal background to continue app setup flow.
                    window.location.href = verifyBtn.href;
                    chrome.storage.local.set({ flowState: 'create_dropbox_app' });
                    chrome.runtime.sendMessage({ action: 'email_verified' });
                    break;
                }

                // Check in iframes if it's hiding inside one
                if (!verifyBtn) {
                   const iframes = document.querySelectorAll('iframe');
                   for(let frame of iframes) {
                       try {
                           const doc = frame.contentDocument;
                           if (doc) {
                               verifyBtn = Array.from(doc.querySelectorAll('a')).find(a => 
                                   a.innerText && a.innerText.toLowerCase().includes('verify your email')
                               );
                               if (verifyBtn) {
                                    window.location.href = verifyBtn.href;
                                 chrome.storage.local.set({ flowState: 'create_dropbox_app' });
                                 chrome.runtime.sendMessage({ action: 'email_verified' });
                                    break;
                               }
                           }
                       }catch(e){} // Cross-origin safety
                   }
                }
                
                await wait(3000);
            }
        }
    }
}

// Ensure the page is somewhat loaded before starting
setTimeout(main, 2000);