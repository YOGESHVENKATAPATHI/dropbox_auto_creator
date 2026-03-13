const axios = require('axios');

async function testCurrentFlow() {
  const SERVER_URL = 'http://localhost:3000';
  
  try {
    console.log('Step 1: check server status...');
    
    // 1. Generate Email
    console.log('Step 2: Generating new email (via Browser Automation)...');
    const genRes = await axios.get(`${SERVER_URL}/generate-email`);
    const { email } = genRes.data;
    console.log(`   > Email received: ${email}`);
    // console.log(`   > Session Token: ${sid_token}`); // No longer used

    if (!email) throw new Error('No email returned');

    // 2. Register on Dropbox
    console.log('Step 3: Registering on Dropbox (Opening Browser)...');
    console.log('   > This will start Puppeteer, input email, and fill registration details.');
    const regRes = await axios.post(`${SERVER_URL}/register`, { email });
    console.log('   > Dropbox Response:', regRes.data);

    // 3. Poll for OTP
    console.log('Step 4: Waiting for OTP (up to 10 minutes)...');
    
    // const startTime = Date.now(); // Already defined below
    const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    // const POLL_INTERVAL = 10000; // Not used directly in while loop here

    let otpFound = false;
    const loopStart = Date.now();
    
    while (Date.now() - loopStart < TIMEOUT_MS) {
      try {
        console.log(`   > Checking for Verification Email... (${Math.floor((Date.now() - loopStart) / 1000)}s elapsed)`);
        
        try {
            const otpRes = await axios.get(`${SERVER_URL}/get-otp`);
            
            if (otpRes.data.status === 'verified') {
                console.log('   > SUCCESS: Email verified successfully!');
                otpFound = true;
                break;
            } else if (otpRes.data.otp) {
                // Fallback support if OTP logic remains
                console.log('   > OTP FOUND:', otpRes.data.otp);
                otpFound = true;
                break;
            }
        } catch (err) {
            // Ignore 404/waiting errors
            if (err.response && err.response.status !== 404) {
                 console.log('   > Error checking verification:', err.message);
            }
        }

        await new Promise(r => setTimeout(r, 5000));
        
      } catch (loopErr) {
          console.log('Loop error:', loopErr.message);
      }
    }

    if (!otpFound) {
      console.error('   > Timeout: No verification received after 10 minutes.');
    } else {
      console.log('   > Flow matched successfully!');
    }
    
  } catch (err) {
    console.error('Error in test flow:', err.message);
    if (err.response) {
      console.error('Server Data:', err.response.data);
    }
  }
}

testCurrentFlow();