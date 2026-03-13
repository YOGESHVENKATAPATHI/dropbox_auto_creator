const puppeteer = require('puppeteer-core');
const fs = require('fs');
const axios = require('axios');

const RECORD_FILE = 'human_pattern.json';
let isRecording = false;
const allRecordedEvents = []; // Store events in Node.js instead of the browser

async function getWebSocketDebuggerUrl() {
    const response = await axios.get('http://127.0.0.1:9222/json/version');
    return response.data.webSocketDebuggerUrl;
}

async function main() {
    console.log("Connecting to open Chrome...");
    const wsUrl = await getWebSocketDebuggerUrl();
    const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
    
    const pages = await browser.pages();
    const page = pages[0]; // Get the active tab

    // Expose Node function to the browser context for the custom button
    await page.exposeFunction('switchTabCommand', async () => {
        console.log("Button clicked! Switching tabs logic goes here...");
        // Logic to find the other tab and bring it to front
    });

    // Expose Node function to receive events immediately
    await page.exposeFunction('reportEvent', (eventData) => {
        allRecordedEvents.push(eventData);
    });

    // 2. We inject the tracker script immediately, and also set it to inject on all future page loads
    const trackingScript = `
        // 1. Inject Floating Button
        if (!document.getElementById('bot-controls')) {
            const btnContainer = document.createElement('div');
            btnContainer.id = 'bot-controls';
            btnContainer.style.cssText = 'position:fixed; top:10px; right:10px; z-index:999999; background:#fff; border:2px solid #000; padding:10px;';
            
            const switchBtn = document.createElement('button');
            switchBtn.innerText = 'Switch Dropbox/Tempmail';
            switchBtn.onclick = () => { window.switchTabCommand() }; // Call to Node.js
            
            btnContainer.appendChild(switchBtn);
            document.body.appendChild(btnContainer);
        }

        // 2. Track Events (Mouse, Keyboard, Scroll) and send them to Node.js immediately
        if (!window.__trackingInitialized) {
            window.__trackingInitialized = true;
            
            const trackMouseEvent = (e, type) => {
                window.reportEvent({ type, x: e.clientX, y: e.clientY, time: Date.now() });
            };
            
            const trackKeyEvent = (e, type) => {
                window.reportEvent({ type, key: e.key, code: e.code, time: Date.now() });
            };
            
            const trackScrollEvent = (e) => {
                window.reportEvent({ type: 'scroll', scrollX: window.scrollX, scrollY: window.scrollY, time: Date.now() });
            };
            
            document.addEventListener('mousemove', e => trackMouseEvent(e, 'move'));
            document.addEventListener('click', e => trackMouseEvent(e, 'click'));
            document.addEventListener('mousedown', e => trackMouseEvent(e, 'mousedown'));
            document.addEventListener('mouseup', e => trackMouseEvent(e, 'mouseup'));
            document.addEventListener('keydown', e => trackKeyEvent(e, 'keydown'));
            document.addEventListener('keyup', e => trackKeyEvent(e, 'keyup'));
            document.addEventListener('scroll', trackScrollEvent, { passive: true });
        }
    `;

    await page.evaluateOnNewDocument(trackingScript); // Injects on newly opened pages or refreshed pages
    await page.evaluate(trackingScript); // Injects on the current page immediately

    console.log("Recording started... Do your manual steps on the page.");

    // Listen for process exit to save the recorded events
    process.on('SIGINT', async () => {
        console.log("Saving recorded actions...");
        fs.writeFileSync(RECORD_FILE, JSON.stringify(allRecordedEvents, null, 2));
        console.log(`Saved ${allRecordedEvents.length} events to ${RECORD_FILE}`);
        process.exit();
    });
}

main().catch(console.error);
