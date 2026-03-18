const express = require('express');
const axios = require('axios');
const serverless = require('serverless-http');
const path = require('path');
const Captcha = require('2captcha');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

const RESOLVED_DATABASE_URL =
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL ||
    '';

const neonPool = RESOLVED_DATABASE_URL
    ? new Pool({
        connectionString: RESOLVED_DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    })
    : null;

async function ensureDropboxAppCredsTable() {
    if (!neonPool) {
        throw new Error('Database connection is not configured. Set NEON_DATABASE_URL or DATABASE_URL.');
    }

    const sql = `
        CREATE TABLE IF NOT EXISTS dropbox_app_credentials (
            id BIGSERIAL PRIMARY KEY,
            app_key TEXT UNIQUE NOT NULL,
            app_secret TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            access_token TEXT,
            account_id TEXT,
            uid TEXT,
            scope TEXT,
            app_name TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `;
    await neonPool.query(sql);
}

// Mail.tm API Base URL (Changed to mail.gw for more domain options)
const MAIL_TM_URL = 'https://api.mail.gw';

// Helper to set a random User-Agent and IP to avoid blocking
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// Retry helper for axios requests
async function fetchWithRetry(url, options = {}, retries = 3, delay = 1000) {
  try {
    // Set a timeout of 8 seconds to allow for retries within Vercel's limit
    const config = { ...options, timeout: 8000, headers: { ...headers, ...options.headers } };
    return await axios(url, config); // axios(url, config) handles both GET and POST if method is in config
  } catch (err) {
    if (retries > 0) {
      console.warn(`Request failed. Retrying in ${delay}ms... (${retries} retries left) - ${err.message}`);
      await new Promise(res => setTimeout(res, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw err;
  }
}

// 1. Generate Email (using temp-mail.org via Puppeteer)
app.get('/generate-email', async (req, res) => {
  try {
    const browser = await getBrowser();
    
    // Clear browsing data first (cookies, cache, storage)
    // This is "clicking the extension" programmatically
    console.log('Clearing browser data...');
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    
    try {
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
        await client.send('Network.clearBrowserCache');
        await client.send('Storage.clearDataForOrigin', {
            origin: '*',
            storageTypes: 'all'
        });
        console.log('Browser data cleared.');
    } catch (e) {
        console.warn('Failed to clear data via CDP, falling back to basic cookie clear:', e.message);
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
    }

    // Go to temp-mail.org
    console.log('Navigating to temp-mail.org...');
    await page.goto('https://temp-mail.org/en/', { waitUntil: 'domcontentloaded' });
    
    // Wait for the email input to be populated (it starts with "Loading")
    const emailInputSelector = '#mail';
    await page.waitForSelector(emailInputSelector);
    
    let email = '';
    let attempts = 0;
    while (attempts < 20) {
        email = await page.$eval(emailInputSelector, el => el.value);
        if (email && !email.includes('Loading')) break;
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
    }

    if (!email || email.includes('Loading')) {
        throw new Error('Failed to retrieve email from temp-mail.org');
    }

    // Keep the page open for later OTP check!
    // We store the page reference in a global map or rely on finding the tab by URL later
    
    console.log(`Generated email: ${email}`);
    res.json({ email, type: 'web-automation' });

  } catch (err) {
    console.error('failed to generate email:', err.message);
    res.status(500).json({ error: 'failed to generate email' });
  }
});

app.post('/save-credentials', async (req, res) => {
    const {
        appKey,
        appSecret,
        refreshToken,
        accessToken = null,
        accountId = null,
        uid = null,
        scope = null,
        appName = null
    } = req.body || {};

    if (!appKey || !appSecret || !refreshToken) {
        return res.status(400).json({ error: 'appKey, appSecret and refreshToken are required' });
    }

    try {
        if (!neonPool) {
            return res.status(500).json({
                error: 'Database is not configured',
                details: 'Set NEON_DATABASE_URL or DATABASE_URL in server environment variables'
            });
        }

        await ensureDropboxAppCredsTable();

        const upsertSql = `
            INSERT INTO dropbox_app_credentials
                (app_key, app_secret, refresh_token, access_token, account_id, uid, scope, app_name, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (app_key)
            DO UPDATE SET
                app_secret = EXCLUDED.app_secret,
                refresh_token = EXCLUDED.refresh_token,
                access_token = EXCLUDED.access_token,
                account_id = EXCLUDED.account_id,
                uid = EXCLUDED.uid,
                scope = EXCLUDED.scope,
                app_name = EXCLUDED.app_name,
                updated_at = NOW()
            RETURNING id, app_key, account_id, uid, created_at, updated_at;
        `;

        const result = await neonPool.query(upsertSql, [
            appKey,
            appSecret,
            refreshToken,
            accessToken,
            accountId,
            uid,
            scope,
            appName
        ]);

        return res.json({ ok: true, saved: result.rows[0] });
    } catch (err) {
        console.error('Failed saving Dropbox credentials:', err.message);
        return res.status(500).json({ error: 'Failed saving credentials', details: err.message });
    }
});

app.get('/health/db', async (req, res) => {
    if (!neonPool) {
        return res.status(500).json({
            ok: false,
            error: 'Database is not configured',
            details: 'Set NEON_DATABASE_URL or DATABASE_URL'
        });
    }

    try {
        const result = await neonPool.query('SELECT NOW() AS now');
        return res.json({ ok: true, now: result.rows[0]?.now || null });
    } catch (err) {
        return res.status(500).json({ ok: false, error: 'Database connection failed', details: err.message });
    }
});


const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// 2. Check Inbox
// Requires 'sid_token' query param passed from step 1
app.get('/check-inbox', async (req, res) => {
  const { sid_token } = req.query;
  if (!sid_token) return res.status(400).json({ error: 'sid_token (JWT) is required to check inbox' });

  try {
    const response = await fetchWithRetry(`${MAIL_TM_URL}/messages`, {
        headers: { Authorization: `Bearer ${sid_token}` }
    });
    
    // API returns 'hydra:member' array
    const messages = response.data['hydra:member'];
    res.json({ messages });
  } catch (err) {
    console.error('failed to check inbox:', err.message);
    res.status(502).json({ error: 'failed to check inbox' });
  }
});

// Helper to generate random names
const getRandomName = () => {
    const firstNames = ['Yogesh', 'Rahul', 'Amit', 'Priya', 'Sneha', 'Rohan', 'Kavita', 'Vikram', 'Anjali', 'Suresh'];
    const lastNames = ['Kumar', 'Sharma', 'Singh', 'Verma', 'Gupta', 'Patel', 'Reddy', 'Das', 'Joshi', 'Yadav'];
    const randomFirst = firstNames[Math.floor(Math.random() * firstNames.length)] + Math.floor(Math.random() * 100);
    const randomLast = lastNames[Math.floor(Math.random() * lastNames.length)];
    return { firstName: randomFirst, lastName: randomLast };
  };

// Random User Agents List
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
];

// Helper for random pauses
const delay = (min, max) => new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

// 2b-bis. CAPTCHA Solving Helper
// Handle different export styles of 2captcha library
let SolverClass;
try {
    SolverClass = Captcha.Solver || Captcha;
} catch (e) {
    SolverClass = Captcha;
}

async function solveCaptcha(page) {
    const API_KEY = process.env.TWO_CAPTCHA_API_KEY;
    if (!API_KEY) {
        console.warn('Skipping CAPTCHA check: TWO_CAPTCHA_API_KEY not set.');
        return false;
    }
    
    console.log('Checking for CAPTCHA...');
    try {
        const solver = new SolverClass(API_KEY);

        // 1. Check for reCAPTCHA v2 checkbox frame
        const recaptchaFrameHandle = await page.$('iframe[src*="google.com/recaptcha/api2/anchor"]');
        if (recaptchaFrameHandle) {
            console.log('Found reCAPTCHA v2 iframe!');
            const src = await page.evaluate(iframe => iframe.src, recaptchaFrameHandle);
            const urlObj = new URL(src);
            const sitekey = urlObj.searchParams.get('k');
            
            if (sitekey) {
                console.log(`Solving reCAPTCHA v2 (sitekey: ${sitekey})...`);
                const result = await solver.recaptcha(sitekey, page.url());
                
                if (result && result.data) {
                    console.log('Solved! Injecting token...');
                    await page.evaluate((token) => {
                        const el = document.getElementById('g-recaptcha-response');
                        if (el) el.innerHTML = token;
                    }, result.data);
                    return true;
                }
            }
        }

        // 2. Check for Arkose Labs / Funcaptcha (More common on Dropbox)
        const arkoseFrameHandle = await page.$('iframe[src*="arkoselabs.com"], iframe[src*="funcaptcha.com"]');
        if (arkoseFrameHandle) {
            console.log('Found Arkose Labs / Funcaptcha iframe!');
            const src = await page.evaluate(iframe => iframe.src, arkoseFrameHandle);
            const urlObj = new URL(src);
            const region = urlObj.host; 
            const publicKey = urlObj.searchParams.get('pk') || urlObj.searchParams.get('k');

            if (publicKey) {
                 console.log(`Solving Funcaptcha (pk: ${publicKey})...`);
                 const serviceUrl = `https://${region}`;
                 const result = await solver.funCaptcha(publicKey, page.url(), serviceUrl);
                 
                 if (result && result.data) {
                     console.log('Funcaptcha solved! Injecting token...');
                     await page.evaluate((token) => {
                         const inputs = [
                             'input[name="fc-token"]',
                             'input[id="fc-token"]', 
                             'input[name="captcha-token"]',
                             'textarea[name="fc-token"]'
                         ];
                         for (const sel of inputs) {
                             const el = document.querySelector(sel);
                             if (el) el.value = token;
                         }
                     }, result.data);
                     return true;
                 }
            }
        }
    } catch (err) {
        console.error('CAPTCHA solving failed or timed out:', err.message);
    }
    return false;
}

// 2b. Register on Dropbox (Step 2 & 4: Full Registration)
let globalBrowser = null;

async function getBrowser() {
  if (globalBrowser && globalBrowser.isConnected()) {
    return globalBrowser;
  }
  
  // When running on Vercel we must run in headless mode and disable
  // the sandbox. The platform already provides a Chromium binary that
  // works with puppeteer, so we don't need to specify an executablePath
  // unless you have a custom build. We also remove ``--start-maximized``
  // since there is no GUI.
  const isVercel = !!process.env.VERCEL;
  const launchOptions = {
    headless: isVercel ? true : false,
    defaultViewport: null,
    userDataDir: isVercel ? undefined : path.join(__dirname, 'user_data'), // Persistent profile for local dev
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled' 
    ],
    ignoreDefaultArgs: ['--enable-automation'] // Hides "Chrome is being controlled by automated test software" bar
  };

  try {
      if (!isVercel) console.log(`Launching browser with user data dir: ${launchOptions.userDataDir}`);
      globalBrowser = await puppeteer.launch(launchOptions);
      return globalBrowser;
  } catch (err) {
      console.error('Failed to launch browser:', err);
      throw err;
  }
}

app.post('/register', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  let page;
  try {
    const browser = await getBrowser();
    
    // Use the default context (persistent profile) instead of creating a new one.
    // This allows cookies/history to be saved, avoiding "too many attempts" flags.
    // Also fixes "createIncognitoBrowserContext is not a function" error.
    if (browser.pages) {
        // Try to reuse an existing blank page if available (often created on launch)
        const pages = await browser.pages();
        if (pages.length > 0 && pages[0].url() === 'about:blank') {
            page = pages[0];
        }
    }
    if (!page) {
        page = await browser.newPage();
    }

    
    // Randomize User-Agent & Viewport
    // Only set UA if on Vercel (headless) or if explicitly testing different environments
    // For local dev (headless: false), letting Chrome use its own UA is often safer
    // UNLESS we want to rotate UAs to avoid fingerprinting.
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    // Ensure the UA matches the platform if possible, but rotation is key here.
    await page.setUserAgent(randomUA);
    await page.setViewport({
        width: 1280 + Math.floor(Math.random() * 100),
        height: 720 + Math.floor(Math.random() * 100),
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: true,
        isMobile: false
    });

    // Mask webdriver property
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
    });

    // Open Dropbox Login
    await page.goto('https://www.dropbox.com/login?src=logout', { waitUntil: 'domcontentloaded' });
    await delay(2000, 5000);

    // --- HANDLE COOKIE BANNER ---
    try {
        const cookieAcceptSelector = '#onetrust-accept-btn-handler'; // Common OneTrust ID
        // Or look for text "Accept All"
        const buttons = await page.$$('button');
        let cookieClicked = false;
        for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text.includes('Accept All') || text.includes('Accept all')) {
                console.log('Found cookie banner "Accept All", clicking...');
                await btn.click();
                cookieClicked = true;
                await delay(1000, 2000);
                break;
            }
        }
    } catch (e) {
        console.log('Cookie banner check failed or not found (ignoring):', e.message);
    }
    
    // Simulate mouse movement to random coordinates to look human
    await page.mouse.move(Math.random() * 500, Math.random() * 500);
    await delay(500, 1000);

    // 1. Type Email
    // Using the name attribute you confirmed: name="susi_email"
    const emailSelector = 'input[name="susi_email"]';
    await page.waitForSelector(emailSelector);
    await page.click(emailSelector); // Focus first
    await delay(300, 700);
    await page.type(emailSelector, email, { delay: Math.floor(Math.random() * 100) + 50 }); // Random typing speed

    await delay(1000, 2500);

    // 2. Click Continue
    // Using the class you confirmed: .email-submit-button
    const continueBtnSelector = '.email-submit-button';
    await page.waitForSelector(continueBtnSelector);
    
    // Move mouse to button before clicking
    const btnBox = await page.$eval(continueBtnSelector, el => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.move(btnBox.x, btnBox.y, { steps: 10 });
    await delay(200, 500);
    await page.click(continueBtnSelector);

    // --- STEP 4: Fill Profile & Password ---
    console.log('Waiting for Step 4 details (First Name, Last Name, Password)...');
    
    // Wait for the First Name field to appear (indicates step 2 is active)
    const fnameSelector = 'input[name="fname"]';
    await page.waitForSelector(fnameSelector, { visible: true, timeout: 60000 });

    const { firstName, lastName } = getRandomName();
    const password = 'Yogesh@1972005'; 

    console.log(`Filling details: ${firstName} ${lastName}`);

    await delay(1000, 2000);

    // Fill First Name
    await page.type(fnameSelector, firstName, { delay: Math.floor(Math.random() * 100) + 50 });
    
    // Fill Last Name
    const lnameSelector = 'input[name="lname"]';
    await delay(200, 800);
    await page.type(lnameSelector, lastName, { delay: Math.floor(Math.random() * 100) + 50 });

    // Fill Password
    const passwordSelector = 'input[name="password"]';
    await page.waitForSelector(passwordSelector);
    await delay(300, 900);
    await page.type(passwordSelector, password, { delay: Math.floor(Math.random() * 100) + 50 });

    // --- MANUAL CAPTCHA PAUSE ---
    console.log('Injecting "Continue" button for manual CAPTCHA solving...');
    
    await page.evaluate(() => {
        const btn = document.createElement('button');
        btn.id = 'manual-continue-btn';
        btn.innerText = 'I HAVE SOLVED THE CAPTCHA - CONTINUE';
        btn.style.position = 'fixed';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '999999';
        btn.style.padding = '15px 30px';
        btn.style.backgroundColor = '#0061fe'; // Dropbox Blue
        btn.style.color = '#fff';
        btn.style.border = '2px solid #fff';
        btn.style.borderRadius = '5px';
        btn.style.fontWeight = 'bold';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        
        btn.onclick = () => {
            window.manualCaptchaSolved = true;
            btn.innerText = 'Continuing...';
            btn.style.backgroundColor = '#00702c'; // Green
            setTimeout(() => btn.remove(), 1000);
        };
        
        document.body.appendChild(btn);
        window.manualCaptchaSolved = false;
    });

    console.log('Waiting for user to click "Continue"...');
    await page.waitForFunction(() => window.manualCaptchaSolved === true, { timeout: 0 }); // No timeout
    console.log('User clicked continue. Resuming automation...');

    // Click "Agree and sign up" button
    console.log('Submitting registration...');

    // Try multiple selectors for the signup button
    const signupSelectors = [
      '//*[@id="login-or-register-page-content"]/div/div/div/div/div/div/div[2]/div/div[3]/div/form/button',
      'button[type="submit"]',
      '//span[contains(text(), "Agree and sign up")]/ancestor::button'
    ];

    let signupBtn = null;
    let foundSelector = '';
    for (const selector of signupSelectors) {
        try {
            if (selector.startsWith('//')) {
                // XPath
                await page.waitForXPath(selector, { timeout: 5000, visible: true });
                const elements = await page.$x(selector);
                if (elements.length > 0) {
                    signupBtn = elements[0];
                    foundSelector = selector;
                    console.log(`Found signup button with XPath: ${selector}`);
                    break;
                }
            } else {
                // CSS Selector
                await page.waitForSelector(selector, { timeout: 5000, visible: true });
                signupBtn = await page.$(selector);
                foundSelector = selector;
                console.log(`Found signup button with Selector: ${selector}`);
                break;
            }
        } catch (e) {
            console.log(`Selector failed: ${selector}`);
        }
    }

    if (!signupBtn) {
        console.error('Could not find the "Agree and sign up" button with any selector.');
        throw new Error('Signup button not found');
    }
    
    // Check if button is disabled (or has a disabled class/attribute)
    const isDisabled = await page.evaluate(btn => btn.disabled || btn.getAttribute('disabled') !== null || btn.classList.contains('disabled'), signupBtn);
    if (isDisabled) {
        console.warn('Signup button appears disabled! Triggering input events to re-validate form...');
        // Trigger input/change events on all inputs to ensure validation runs
        await page.evaluate(() => {
            document.querySelectorAll('input').forEach(input => {
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur', { bubbles: true })); // Sometimes validation runs on blur
            });
        });
        await delay(1500, 3000);
    }

    // Handle potential cookie banner again if it appeared late
    try {
        const buttons = await page.$$('button');
        for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text.includes('Accept All') || text.includes('Accept all')) {
                 if (await btn.boundingBox()) { // Check if visible
                    await btn.click();
                    await delay(500, 1000);
                 }
            }
        }
    } catch(e) {}

    // Move and Click with navigation handling
    try {
        // Scroll into view first
        await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), signupBtn);
        await delay(500, 1000);

        const box = await signupBtn.boundingBox();
        if (box) {
             const x = box.x + box.width / 2;
             const y = box.y + box.height / 2;
             await page.mouse.move(x, y);
             await delay(200, 500);
        }

        // Setup navigation listener before clicking to avoid race condition
        const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        
        console.log('Clicking signup button...');
        await signupBtn.click();
        
        // Wait for either navigation or a reasonable timeout
        // (sometimes Dropbox doesn't do a full page nav immediately but shows loading)
        await Promise.race([
            navigationPromise,
            delay(5000, 8000)
        ]).catch(e => console.log('Navigation timeout or error (might be AJAX):', e.message));

    } catch (e) {
        console.log('Standard click failed, trying evaluate click...', e.message);
        try {
             await page.evaluate(btn => btn.click(), signupBtn);
             await delay(3000, 5000);
        } catch (innerErr) {
             console.log('Evaluate click also failed', innerErr.message);
        }
    }
    
    // Wait for submission to process (either navigation or error message)
    // Don't close immediately!
    console.log('Clicked signup, waiting for navigation or response...');

    // Close page nicely (keeping browser/profile open)
    if (page) await page.close();

    res.json({ 
        message: 'Registration form submitted successfully', 
        registeredUser: { firstName, lastName, email, password } 
    });

  } catch (err) {
    console.error('Dropbox registration error:', err);
    // Only close page on error, keep browser running
    try {
        if (page) await page.close();
    } catch (e) { /* ignore */ }
    
    res.status(500).json({ error: 'Dropbox registration failed', details: err.message });
  }
});

// 3. Extract OTP / Verification Link (Web Scraping Version)
app.get('/get-otp', async (req, res) => {
  try {
    const browser = await getBrowser();
    if (!browser) return res.status(500).json({ error: 'Browser not active' });
    
    // Find the temp-mail tab
    const pages = await browser.pages();
    let mailPage = null;
    for (const p of pages) {
        const url = p.url();
        if (url.includes('temp-mail.org')) {
            mailPage = p;
            break;
        }
    }
    
    if (!mailPage) {
        return res.status(404).json({ error: 'Temp-mail tab not found. Did you run /generate-email?' });
    }

    console.log('Checking temp-mail inbox for Dropbox verification...');

    let verificationStatus = null;
    let attempts = 0;
    const maxAttempts = 60; // Up to ~10 minutes with 10s polling interval.
    
    while (attempts < maxAttempts && !verificationStatus) {
        // Always refresh inbox first so new messages are fetched.
        const refreshedInbox = await mailPage.evaluate(() => {
            const refreshSelectors = [
                'button[data-qa="refresh-button"]',
                '[data-qa="refresh-button"]',
                'button[title*="Refresh"]',
                'button[aria-label*="Refresh"]'
            ];

            for (const selector of refreshSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    el.click();
                    return true;
                }
            }

            const candidates = Array.from(document.querySelectorAll('button, a, span, div'));
            const byText = candidates.find(el => {
                const t = (el.innerText || '').trim().toLowerCase();
                return t === 'refresh' || t.includes('refresh');
            });

            if (byText) {
                byText.click();
                return true;
            }

            return false;
        });

        if (refreshedInbox) {
            console.log(`Inbox refresh clicked (${attempts + 1}/${maxAttempts}).`);
        } else {
            console.log(`Refresh button not found (${attempts + 1}/${maxAttempts}), checking inbox anyway.`);
        }

        await delay(2000, 2500);

        // 1. Check if we need to click on an email in the list
        const clickedEmail = await mailPage.evaluate(() => {
            // Check for Dropbox in the list view
            // temp-mail.org structure usually has a list of emails
            // We look for any element containing "Dropbox" that seems clickable
            // But we must be careful not to click if we are ALREADY inside the email.
            
            // Check if we are already viewing an email (look for "Back to list" button)
            const backBtn = document.querySelector('a.back-to-list, a[title="Back to list"]');
            if (backBtn) {
                // We are inside an email.
                 return 'ALREADY_OPEN';
            }

            const links = Array.from(document.querySelectorAll('a, div.user-data-subject, li.mail-item'));
            const dropboxEl = links.find(el => el.innerText.includes('Dropbox') || (el.title && el.title.includes('Dropbox')));
            
            if (dropboxEl) {
                dropboxEl.click();
                return 'CLICKED';
            }
            return 'NOT_FOUND';
        });

        if (clickedEmail === 'CLICKED') {
            console.log('Found Dropbox email in list. Clicked.');
            await delay(2000, 3000);
        } else if (clickedEmail === 'NOT_FOUND') {
            console.log('Dropbox email not found in list yet...');
        } else {
             console.log('Email currently open. Searching for link...');
        }

        // 2. Search for the "Verify your email" link
        // It might be in the main body or inside an iframe
        const verifyLink = await mailPage.evaluate(() => {
            // Helper to search in a document/root
            const findLink = (root) => {
                const anchors = Array.from(root.querySelectorAll('a'));
                return anchors.find(a => 
                    a.innerText.trim().toLowerCase().includes('verify your email') || 
                    a.innerText.trim().toLowerCase().includes('verify email')
                );
            };

            // Search in main document
            let link = findLink(document);
            if (link) return link.href;

            // Search in iframes (if accessible)
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const innerDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (innerDoc) {
                        const iframeLink = findLink(innerDoc);
                        if (iframeLink) return iframeLink.href;
                    }
                } catch(e) { }
            }
            return null;
        });

        if (verifyLink) {
             console.log(`Found verification link: ${verifyLink}`);
             
             // Open the verification link in a new tab
             let verifyPage;
             try {
                 verifyPage = await browser.newPage();
                 console.log('Navigating to verification link...');
                 await verifyPage.goto(verifyLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
                 
                 console.log('Verification page loaded. Waiting for confirmation...');
                 await delay(5000, 8000); 
                 
                 // Look for success text to be sure?
                 const pageTitle = await verifyPage.title();
                 console.log(`Verification Page Title: ${pageTitle}`);

                 await verifyPage.close();
                 verificationStatus = 'VERIFIED';
                 break;
             } catch (navErr) {
                 console.warn('Error during verification navigation:', navErr.message);
                 if (verifyPage) await verifyPage.close().catch(() => {});
             }
        }

        if (!verificationStatus) {
            attempts++;
            await new Promise(r => setTimeout(r, 10000));
        }
    }

    if (verificationStatus === 'VERIFIED') {
        res.json({ message: 'Email verified!', status: 'verified' });
    } else {
        res.status(404).json({ error: 'Verification link not found or timed out.' });
    }

  } catch (err) {
    console.error('failed to process verification:', err.message);
    res.status(500).json({ error: 'failed to process verification' });
  }
});



const port = process.env.PORT || 3000;
// only start a standalone HTTP listener when this file is run directly
// (e.g. `node index.js` during local development). When deployed to
// Vercel the app will be required by `api/index.js` and the handler
// exported below will be used instead.
if (require.main === module) {
  const server = app.listen(port, () => console.log(`server listening on ${port}`));
  server.setTimeout(600000); // 10 minutes timeout
}

// Add a root GET route so the server doesn't hang on base domain hits.
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Dropbox Automator API is running' });
});

// export for importing by serverless functions or tests
module.exports = app;
// We no longer double-wrap with serverless-http since Vercel's @vercel/node handles Express apps naturally.

