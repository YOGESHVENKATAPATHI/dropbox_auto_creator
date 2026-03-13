const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const axios = require('axios');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_PROFILE_DIR = path.join(__dirname, 'chrome_profiles');

// Generate a random string to create a unique folder name
function generateRandomId() {
    return Math.random().toString(36).substring(2, 10);
}

// Function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function createFreshChromeAndConnect() {
    // 1. Create a unique temporary folder for this specific session
    const sessionId = generateRandomId();
    const userDataDir = path.join(BASE_PROFILE_DIR, `profile_${sessionId}`);
    
    // Ensure base directory exists
    if (!fs.existsSync(BASE_PROFILE_DIR)) {
        fs.mkdirSync(BASE_PROFILE_DIR);
    }
    
    console.log(`\n==========================================`);
    console.log(`🚀 LAUNCHING BRAND NEW CHROME SESSION...`);
    console.log(`📁 Profile Folder: ${userDataDir}`);
    console.log(`==========================================\n`);

    // 2. Launch Chrome via command line with the fresh profile
    // We add powerful stealth flags to prevent fingerprinting
    const chromeProcess = spawn(CHROME_PATH, [
        `--remote-debugging-port=9222`,
        `--user-data-dir=${userDataDir}`,
        `--no-first-run`,
        `--no-default-browser-check`,
        `--disable-blink-features=AutomationControlled`,
        `--disable-infobars`,
        `--window-position=0,0`,
        `--ignore-certificate-errors`,
        `--ignore-certificate-errors-spki-list`,
        `--disable-features=IsolateOrigins,site-per-process`,
        // Randomize the user agent slightly by removing the "Headless" or specific build tags if any exist
        `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36`
    ]);

    // Give Chrome a few seconds to fully open and start the debugging port
    await wait(3000);

    // 3. Connect Puppeteer to this newly opened Chrome
    console.log("Connecting to the fresh Chrome instance...");
    try {
        const response = await axios.get('http://127.0.0.1:9222/json/version');
        const wsUrl = response.data.webSocketDebuggerUrl;
        
        const browser = await puppeteer.connect({ 
            browserWSEndpoint: wsUrl, 
            defaultViewport: null 
        });
        
        console.log("✅ Successfully connected!");
        return { browser, chromeProcess, userDataDir };
    } catch (error) {
        console.error("Failed to connect. Is the port already in use or did Chrome not start?", error.message);
        process.exit(1);
    }
}

// We export this so we can use it in your run_flow.js
module.exports = { createFreshChromeAndConnect };

// If you just want to run this file directly to test opening a fresh Chrome:
if (require.main === module) {
    createFreshChromeAndConnect().then(async ({ browser }) => {
        const pages = await browser.pages();
        const page = pages[0];
        await page.goto("https://www.dropbox.com/register");
        console.log("Test page loaded. You can close the browser manually.");
    });
}
