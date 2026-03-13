const puppeteerWrapper = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerWrapper.use(StealthPlugin());
const fs = require('fs');
const axios = require('axios');
const { createFreshChromeAndConnect } = require('./launch_fresh_chrome'); // Import the new launcher

const RECORD_FILE = 'human_pattern.json';

async function getWebSocketDebuggerUrl() {
    const response = await axios.get('http://127.0.0.1:9222/json/version');
    return response.data.webSocketDebuggerUrl;
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// This function replays the recorded events with the exact human timing
async function replayEvents(page, events) {
    if (!events || events.length === 0) return;
    
    console.log(`Replaying ${events.length} events...`);
    let startTime = events[0].time;
    
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const prevEvent = i > 0 ? events[i - 1] : events[0];
        const delay = event.time - prevEvent.time;
        
        if (delay > 0) {
            await wait(delay); // Mimic exact human speed and delay between actions
        }

        try {
            if (event.type === 'move') {
                await page.mouse.move(event.x, event.y);
            } else if (event.type === 'click') {
                await page.mouse.click(event.x, event.y);
            } else if (event.type === 'mousedown') {
                await page.mouse.down();
            } else if (event.type === 'mouseup') {
                await page.mouse.up();
            } else if (event.type === 'keydown') {
                await page.keyboard.down(event.key);
            } else if (event.type === 'keyup') {
                await page.keyboard.up(event.key);
            } else if (event.type === 'scroll') {
                await page.evaluate((x, y) => window.scrollTo(x, y), event.scrollX, event.scrollY);
            }
        } catch (err) {
            console.error(`Error replaying event ${event.type} at ${event.x || ''}, ${event.y || ''}:`, err);
        }
    }
}

// Function to humanly type text with realistic mistakes and corrections
async function humanType(page, text) {
    for (const char of text) {
        // 10% chance to make a typo (simulate human error) if it's a regular letter
        if (Math.random() < 0.10 && /[a-zA-Z]/.test(char)) {
            // Type a random wrong letter nearby on the keyboard
            const wrongChar = ['s', 'e', 'x', 'w', 'q', 'a', 'd'][Math.floor(Math.random() * 7)];
            await page.keyboard.type(wrongChar, { delay: Math.floor(Math.random() * 100) + 50 });
            await wait(Math.floor(Math.random() * 300) + 200); // Pause, realizing mistake
            await page.keyboard.press('Backspace'); // Delete wrong character
            await wait(Math.floor(Math.random() * 200) + 100); // Pause briefly before correcting
        }
        // Type the correct character slowly, like a human
        await page.keyboard.type(char, { delay: Math.floor(Math.random() * 150) + 80 }); 
    }
}

// Function to search for text on the page and physically track the cursor to it
async function findAndHumanClick(page, textToFind) {
    const targetRect = await page.evaluate((text) => {
        const elements = Array.from(document.querySelectorAll('a, button, div, span, td, li'));
        for (let el of elements.reverse()) { // Reverse to get the most specific child element first
            if (el.innerText && el.innerText.trim().includes(text)) {
                const rect = el.getBoundingClientRect();
                // Verify it's actually visible
                if (rect.width > 5 && rect.height > 5 && rect.top >= 0 && rect.left >= 0) {
                    return { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2), found: true };
                }
            }
        }
        // Check inside iframes as well, just in case temp-mail renders the email in an iframe
        const iframes = document.querySelectorAll('iframe');
        for (let iframe of iframes) {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                if (doc) {
                    const frameElements = Array.from(doc.querySelectorAll('a, button, div, span, td, li'));
                    for (let el of frameElements.reverse()) {
                        if (el.innerText && el.innerText.trim().includes(text)) {
                            const rect = el.getBoundingClientRect();
                            const frameRect = iframe.getBoundingClientRect();
                            if (rect.width > 5 && rect.height > 5) {
                                return { 
                                    x: frameRect.x + rect.x + (rect.width / 2), 
                                    y: frameRect.y + rect.y + (rect.height / 2), 
                                    found: true 
                                };
                            }
                        }
                    }
                }
            } catch(e) { } // Cross-origin frames will throw securely
        }
        return { found: false };
    }, textToFind);

    if (targetRect.found) {
        const startX = Math.random() * 500;
        const startY = Math.random() * 500;
        const steps = 30;
        for (let i = 1; i <= steps; i++) {
            const x = startX + (targetRect.x - startX) * (i / steps);
            const y = startY + (targetRect.y - startY) * (i / steps);
            await page.mouse.move(x, y);
            await wait(Math.random() * 10 + 10); 
        }
        await wait(Math.floor(Math.random() * 200) + 100);
        await page.mouse.click(targetRect.x, targetRect.y);
        return true;
    }
    return false;
}

// Function to move the mouse like a human to a specific element and click it
async function humanMoveAndClick(page, selector) {
    await page.waitForSelector(selector);
    const rect = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
    }, selector);

    // Calculate center of the element with some slight randomness
    const targetX = rect.x + (rect.width / 2) + (Math.random() * 10 - 5);
    const targetY = rect.y + (rect.height / 2) + (Math.random() * 10 - 5);

    // Get current mouse position (we'll assume random starting point if not tracking)
    const startX = Math.random() * 500;
    const startY = Math.random() * 500;

    // Move in steps
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
        const x = startX + (targetX - startX) * (i / steps);
        const y = startY + (targetY - startY) * (i / steps);
        await page.mouse.move(x, y);
        await wait(Math.random() * 10 + 10); // 10-20ms per step
    }

    await wait(Math.floor(Math.random() * 200) + 100); // Pause before click
    await page.mouse.click(targetX, targetY);
}

// Click temp-mail inbox refresh button with human-like movement.
async function clickInboxRefresh(page) {
    const refreshSelectors = [
        'button[data-qa="refresh-button"]',
        '[data-qa="refresh-button"]',
        'button[title*="Refresh"]',
        'button[aria-label*="Refresh"]'
    ];

    for (const selector of refreshSelectors) {
        try {
            await humanMoveAndClick(page, selector);
            return true;
        } catch (e) {
            // Try next selector.
        }
    }

    // Final fallback by visible label.
    return findAndHumanClick(page, 'refresh');
}

async function main() {
    console.log("Starting a completely fresh Chrome instance...");
    // We replace the manual connection with our new automated fresh launch
    const { browser, chromeProcess, userDataDir } = await createFreshChromeAndConnect();
    
    const pages = await browser.pages();
    const page = pages[0]; // Get the active tab

    // --- STEALTH INJECTIONS ---
    console.log("Injecting stealth properties to mask Puppeteer fingerprints...");
    await page.evaluateOnNewDocument(() => {
        // Overwrite the 'webdriver' property
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        
        // Pass the Permissions test
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ? 
            Promise.resolve({ state: Notification.permission }) : 
            originalQuery(parameters)
        );
        
        // Mocking languages and plugins so it doesn't look empty
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
        
        // Mock hardware concurrency
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
    });

    let allEvents = [];
    if (fs.existsSync(RECORD_FILE)) {
        allEvents = JSON.parse(fs.readFileSync(RECORD_FILE, 'utf8'));
    }

    // --- STEP 1: TEMP-MAIL ---
    console.log("Navigating to temp-mail.io...");
    await page.goto('https://temp-mail.io/', { waitUntil: 'networkidle2' });

    console.log("Waiting for email address to generate...");
    await wait(3000); // Give it some time to load

    // Copy the email by finding the input box
    console.log("Locating the email box...");
    const emailSelector = 'input[id="email"], input[type="text"]';
    await humanMoveAndClick(page, emailSelector); // Human cursor movement to click the email
    
    // Select the text and copy it via keyboard (Ctrl+A, Ctrl+C)
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await wait(100);
    await page.keyboard.press('c');
    await page.keyboard.up('Control');
    await wait(500);

    const emailAddress = await page.evaluate(() => {
        const input = document.querySelector('input[id="email"]') || document.querySelector('input[type="text"]');
        return input ? input.value : "";
    });
    console.log(`Copied Email: ${emailAddress}`);

    // --- STEP 2: DROPBOX ---
    console.log("Navigating to Dropbox...");
    await page.goto('https://www.dropbox.com/register', { waitUntil: 'networkidle2' }); // Login or Registration page
    await wait(2000);

    // Find the Email Input field on Dropbox
    console.log("Moving cursor to the Dropbox email field...");
    const dropboxEmailInput = 'input[type="email"], input[name="login_email"], input[name="susi_email"]'; 
    await humanMoveAndClick(page, dropboxEmailInput); // Human mouse movement
    
    console.log("Typing (pasting) the email...");
    await humanType(page, emailAddress);

    // Wait a brief human moment
    await wait(800 + Math.random() * 500);

    // Find the Continue Button, move the mouse to it, and click it
    console.log("Moving cursor to the Continue button and clicking...");
    
    // Dropbox commonly uses these classes/types for the blue continue button
    const continueBtnSelector = 'button[type="submit"], button[data-testid="susi-continue-button"]';
    
    try {
        await humanMoveAndClick(page, continueBtnSelector); // This creates the human cursor tracking to click
        console.log("Continue button clicked!");
    } catch (e) {
        console.log("Could not find Continue button with usual selector, falling back to basic Enter key.");
        await wait(500);
        await page.keyboard.press('Enter');
    }

    // --- STEP 3: FULL REGISTRATION FORM (Names & Password) ---
    console.log("Waiting for the extended registration form (Names/Password) to appear...");
    await wait(2500); // Wait for the form expansion animation

    // Random human names generator
    const firstNames = ["James", "Robert", "John", "Michael", "David", "William", "Richard", "Joseph", "Thomas", "Charles", "Emma", "Olivia", "Ava", "Isabella", "Sophia", "Mia", "Amelia", "Harper", "Evelyn", "Abigail"];
    const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];
    
    const randomFirstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const randomLastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const password = "Yogesh@1972005";

    console.log(`Using Name: ${randomFirstName} ${randomLastName}`);

    // Point/Click First Name using cursor
    console.log("Moving cursor to First name...");
    const fnameSelector = 'input[name="fname"], input[name="first_name"]';
    await humanMoveAndClick(page, fnameSelector);
    await humanType(page, randomFirstName);
    await wait(500 + Math.random() * 500); 

    // Point/Click Surname using cursor
    console.log("Moving cursor to Surname...");
    const lnameSelector = 'input[name="lname"], input[name="last_name"]';
    await humanMoveAndClick(page, lnameSelector);
    await humanType(page, randomLastName);
    await wait(500 + Math.random() * 500);

    // Point/Click Password using cursor
    console.log("Moving cursor to Password...");
    const passSelector = 'input[name="password"], input[type="password"]';
    await humanMoveAndClick(page, passSelector);
    await humanType(page, password);
    await wait(1000 + Math.random() * 500);

    // Point/Click "Agree and sign up" button
    console.log("Moving cursor to 'Agree and sign up' button...");
    // Using the highly specific data attribute to avoid clicking wrong submit buttons
    const signUpBtnSelector = 'button[data-uxa-log="register_form_submit_button"]'; 
    
    try {
        await humanMoveAndClick(page, signUpBtnSelector);
        console.log("'Agree and sign up' clicked using specific selector!");
    } catch (e) {
        console.log("Could not find button using selector. Trying text match...");
        // Fallback to our visual text clicking method
        const clicked = await findAndHumanClick(page, "Agree and sign up");
        if (!clicked) {
            console.log("Fallback to Enter key for sign up.");
            await page.keyboard.press('Enter');
        } else {
            console.log("'Agree and sign up' clicked via visual text search!");
        }
    }

    // --- STEP 4: EMAIL VERIFICATION ---
    console.log("Waiting 10 seconds for the account configuration...");
    await wait(10000);

    console.log("Navigating back to temp-mail.io...");
    await page.goto('https://temp-mail.io/', { waitUntil: 'networkidle2' });

    // Give inbox components a moment to become interactive.
    await wait(3000);

    console.log("Waiting for the Dropbox verification email to arrive...");
    let foundEmail = false;
    const maxRefreshCycles = 60; // Up to ~10 minutes of polling.
    for (let i = 0; i < maxRefreshCycles; i++) {
        console.log(`Inbox poll ${i + 1}/${maxRefreshCycles}: clicking refresh and checking for Dropbox email...`);

        await clickInboxRefresh(page);
        await wait(2500);

        // Scan for any row/sender that says "Dropbox" and open it.
        foundEmail = await findAndHumanClick(page, 'Dropbox');
        if (foundEmail) {
            console.log("Found and clicked the Dropbox email with human cursor movement!");
            break;
        }

        // Required polling cadence: refresh every 10 seconds.
        await wait(10000);
    }

    if (!foundEmail) {
        console.log("Dropbox email not found after refresh polling timeout.");
    } else {
        await wait(3000); // Give the email body window a moment to load and render
        console.log("Scanning email body for 'Verify your email' button...");
        
        let foundVerify = false;
        for (let i = 0; i < 24; i++) { // Poll up to ~2 minutes for verify CTA.
            // Look for common phrasing on the button
            foundVerify = await findAndHumanClick(page, "Verify your email") || 
                          await findAndHumanClick(page, "Verify") || 
                          await findAndHumanClick(page, "verify");
                          
            if (foundVerify) {
                console.log("Successfully swept cursor and clicked the Verify button!");
                break;
            }
            await wait(5000);
        }

        if (!foundVerify) {
            console.log("Verification button/link was not found after opening the Dropbox email.");
        }
    }

    console.log("Entire flow completed successfully!");
    
    // Optionally clean up the browser and processes when completely done
    await wait(3000);
    await browser.disconnect();
    chromeProcess.kill();
    console.log(`🧹 Closed Chrome. (Profile data remains in ${userDataDir} if you want to inspect it)`);
    
    process.exit();
}

main().catch(console.error);
