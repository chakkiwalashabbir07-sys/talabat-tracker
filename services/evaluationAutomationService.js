const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');
const EvaluationEntry = require('../models/EvaluationEntry');

// Optional Sparticuz Chromium for serverless / container environments (Render)
let sparticuzChromium = null;
try {
  const rawChromium = require('@sparticuz/chromium');
  sparticuzChromium = rawChromium.default || rawChromium;
} catch (e) {}

// User data dir for persistent login session
const BROWSER_PROFILE_DIR = path.resolve(__dirname, '..', 'browser_profile');
if (!fs.existsSync(BROWSER_PROFILE_DIR)) {
  fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
}

// Helper to resolve browser configuration (Cross-platform: Windows, Linux, Render)
async function resolveBrowserConfig() {
  const isLinux = process.platform === 'linux';

  // 1. If on Windows, look for local Chrome/Edge
  if (process.platform === 'win32') {
    const winPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return { executablePath: p, isHeadless: false };
    }
  }

  // 2. Check environment variable overrides
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return { executablePath: process.env.CHROME_BIN, isHeadless: isLinux };
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, isHeadless: isLinux };
  }

  // 3. Check standard Linux paths
  const linuxPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const p of linuxPaths) {
    if (fs.existsSync(p)) return { executablePath: p, isHeadless: true };
  }

  // 4. Try Puppeteer's own downloaded browser (installed in .cache/puppeteer)
  try {
    if (typeof puppeteer.executablePath === 'function') {
      const pPath = await puppeteer.executablePath();
      if (pPath && fs.existsSync(pPath)) {
        return { executablePath: pPath, isHeadless: isLinux };
      }
    }
  } catch (e) {}

  // 5. Check if @sparticuz/chromium can provide an executablePath (Render / Linux container)
  if (sparticuzChromium && typeof sparticuzChromium.executablePath === 'function') {
    try {
      const sPath = await sparticuzChromium.executablePath();
      if (sPath) {
        return {
          executablePath: sPath,
          isHeadless: true,
          extraArgs: sparticuzChromium.args || []
        };
      }
    } catch (e) {
      console.warn('Sparticuz Chromium resolution:', e.message);
    }
  }

  return { executablePath: null, isHeadless: isLinux };
}

// Helper to safely unlock profile directory and kill stale processes
function unlockBrowserProfile(profileDir) {
  if (process.platform === 'win32') {
    try {
      const script = `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -like "*browser_profile*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      execSync(`powershell -NoProfile -EncodedCommand ${encoded}`, { stdio: 'ignore', timeout: 5000 });
    } catch (e) {}
  }

  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile'];
  for (const f of lockFiles) {
    const p = path.join(profileDir, f);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    } catch (e) {}
  }
}

class EvaluationAutomationService {
  constructor() {
    this.executablePath = null;
    this.sharedBrowser = null;
    this.sharedPage = null;

    // Shared serialized automation queue
    this.queue = [];
    this.activeItem = null;
    this.recentItems = [];
    this.isProcessing = false;
    this.isPaused = false;
    this.logs = [];

    // Legacy active sessions map for backward compatibility
    this.activeSessions = new Map();

    // Browser configuration is resolved dynamically on launch
  }

  // Add system / queue log
  addLog(level, message, itemId = null) {
    const logItem = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toLocaleTimeString(),
      level, // 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR'
      message,
      itemId
    };
    this.logs.push(logItem);
    if (this.logs.length > 250) {
      this.logs.shift();
    }
    console.log(`[EvalQueue] [${level}] ${itemId ? `[${itemId}] ` : ''}${message}`);
    return logItem;
  }

  // --- QUEUE MANAGEMENT ---

  // Enqueue a single manual entry
  enqueueManual(entryData, user, options = {}) {
    const itemId = 'man_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const item = {
      id: itemId,
      jobId: options.jobId || ('job_' + Date.now()),
      source: 'MANUAL',
      trno: Number(entryData.trno),
      itsid: entryData.itsid || '',
      studentName: entryData.studentName ? entryData.studentName.trim() : `Student ${entryData.trno}`,
      darajah: entryData.darajah || '',
      room: entryData.room || '',
      floor: entryData.floor || '',
      building: entryData.building || 'Male Residences',
      evaluationType: entryData.evaluationType || 'Tashjee',
      idara: entryData.idara || 'Male Residences',
      remark: entryData.remark,
      extraDetails: (entryData.extraDetails || '').trim(),
      points: Number(entryData.points) || 10,
      force: !!options.force,
      user: user ? { id: user._id, name: user.name || user.username } : null,
      status: 'QUEUED', // QUEUED | IN_PROGRESS | SUBMITTED | SKIPPED_DUPLICATE | FAILED | CANCELLED
      portalMessage: null,
      errorMessage: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null
    };

    this.queue.push(item);
    this.addLog('INFO', `Enqueued Manual Entry: TRNO ${item.trno} (${item.studentName}) - ${item.evaluationType}`, item.id);

    // Kick off worker loop if not already running
    if (!this.isProcessing && !this.isPaused) {
      this.processQueue().catch(err => {
        console.error('Queue worker loop uncaught error:', err);
        this.isProcessing = false;
      });
    }

    return item;
  }

  // Enqueue bulk entries
  enqueueBulk(itemsArray, user, sharedParams = {}, options = {}) {
    const jobId = 'bulk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const enqueuedItems = [];

    for (const itemData of itemsArray) {
      const itemId = 'blk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const item = {
        id: itemId,
        jobId: jobId,
        source: 'BULK',
        trno: Number(itemData.trno),
        itsid: itemData.itsid || '',
        studentName: itemData.studentName ? itemData.studentName.trim() : (itemData.name || `Student ${itemData.trno}`),
        darajah: itemData.darajah || '',
        room: itemData.room || '',
        floor: itemData.floor || '',
        building: itemData.building || 'Male Residences',
        evaluationType: itemData.evaluationType || sharedParams.evaluationType || 'Tashjee',
        idara: itemData.idara || sharedParams.idara || 'Male Residences',
        remark: itemData.remark || sharedParams.remark,
        extraDetails: (itemData.extraDetails || sharedParams.extraDetails || '').trim(),
        points: Number(itemData.points || sharedParams.points) || 10,
        force: options.force === true || itemData.force === true,
        user: user ? { id: user._id, name: user.name || user.username } : null,
        status: 'QUEUED',
        portalMessage: null,
        errorMessage: null,
        createdAt: new Date(),
        startedAt: null,
        completedAt: null
      };

      this.queue.push(item);
      enqueuedItems.push(item);
    }

    this.addLog('INFO', `Enqueued Bulk Batch [${jobId}] with ${enqueuedItems.length} students.`);

    // Kick off worker loop
    if (!this.isProcessing && !this.isPaused) {
      this.processQueue().catch(err => {
        console.error('Queue worker loop uncaught error:', err);
        this.isProcessing = false;
      });
    }

    return { jobId, count: enqueuedItems.length, items: enqueuedItems };
  }

  // Get full queue status
  getQueueStatus() {
    const totalProcessed = this.recentItems.length;
    const submittedCount = this.recentItems.filter(i => i.status === 'SUBMITTED').length;
    const skippedCount = this.recentItems.filter(i => i.status === 'SKIPPED_DUPLICATE').length;
    const failedCount = this.recentItems.filter(i => i.status === 'FAILED').length;

    return {
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      activeItem: this.activeItem,
      queue: this.queue,
      queueLength: this.queue.length,
      recentItems: this.recentItems.slice(-40),
      stats: {
        pendingCount: this.queue.length,
        activeCount: this.activeItem ? 1 : 0,
        recentCount: totalProcessed,
        submittedCount,
        skippedCount,
        failedCount
      },
      logs: this.logs.slice(-60)
    };
  }

  pauseQueue() {
    this.isPaused = true;
    this.addLog('WARN', 'Queue paused by user. Active item will complete, pending items are held.');
    return { success: true, isPaused: true };
  }

  resumeQueue() {
    this.isPaused = false;
    this.addLog('INFO', 'Queue resumed by user.');
    if (!this.isProcessing && this.queue.length > 0) {
      this.processQueue().catch(err => console.error('Resume queue error:', err));
    }
    return { success: true, isPaused: false };
  }

  cancelItem(itemId) {
    const index = this.queue.findIndex(i => i.id === itemId);
    if (index !== -1) {
      const removed = this.queue.splice(index, 1)[0];
      removed.status = 'CANCELLED';
      removed.completedAt = new Date();
      this.recentItems.push(removed);
      this.addLog('WARN', `Cancelled queued entry for TRNO ${removed.trno}`, itemId);
      return { success: true, cancelled: removed };
    }
    return { success: false, message: 'Item not found in pending queue.' };
  }

  cancelAllPending() {
    const count = this.queue.length;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item.status = 'CANCELLED';
      item.completedAt = new Date();
      this.recentItems.push(item);
    }
    this.addLog('WARN', `Cancelled all ${count} pending queue entries.`);
    return { success: true, cancelledCount: count };
  }

  clearRecentItems() {
    this.recentItems = [];
    return { success: true };
  }

  // --- BROWSER & SESSION MANAGEMENT ---

  // Connect or launch browser with persistent profile (Singleton)
  async getOrCreateBrowser() {
    const isAlive = (b) => b && (typeof b.isConnected === 'function' ? b.isConnected() : Boolean(b.connected));

    if (isAlive(this.sharedBrowser)) {
      return this.sharedBrowser;
    }

    const config = await resolveBrowserConfig();

    // 1. Try connecting to existing Chrome instance on port 9222 (for local dev / debug)
    if (!config.isHeadless) {
      try {
        const existing = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
        if (isAlive(existing)) {
          this.addLog('INFO', 'Connected to active Chrome instance on port 9222.');
          this.sharedBrowser = existing;
          existing.on('disconnected', () => { 
            this.sharedBrowser = null; 
            this.sharedPage = null; 
          });
          return existing;
        }
      } catch (e) {}
    }

    // 2. Unlock profile directory if held by stale processes
    unlockBrowserProfile(BROWSER_PROFILE_DIR);

    // 3. Build launch options
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      ...(config.extraArgs || [])
    ];

    if (!config.isHeadless) {
      launchArgs.push('--remote-debugging-port=9222');
      launchArgs.push('--start-maximized');
    }

    const launchOptions = {
      headless: config.isHeadless ? true : false,
      userDataDir: BROWSER_PROFILE_DIR,
      defaultViewport: config.isHeadless ? { width: 1280, height: 900 } : null,
      args: launchArgs
    };

    if (config.executablePath) {
      launchOptions.executablePath = config.executablePath;
    }

    try {
      this.addLog('INFO', `Launching Chrome (Headless: ${config.isHeadless}, Path: ${config.executablePath || 'default-bundled'})...`);
      const browser = await puppeteer.launch(launchOptions);

      this.sharedBrowser = browser;
      browser.on('disconnected', () => {
        this.sharedBrowser = null;
        this.sharedPage = null;
      });
      this.addLog('INFO', 'Browser initialized and connected successfully.');
      return browser;
    } catch (launchErr) {
      if (launchErr.message && launchErr.message.includes('already running')) {
        this.addLog('WARN', 'Profile lock detected. Clearing stale locks and retrying...');
        unlockBrowserProfile(BROWSER_PROFILE_DIR);
        await new Promise(r => setTimeout(r, 1500));

        const browser = await puppeteer.launch(launchOptions);
        this.sharedBrowser = browser;
        browser.on('disconnected', () => {
          this.sharedBrowser = null;
          this.sharedPage = null;
        });
        return browser;
      }
      throw launchErr;
    }
  }

  // Ensure portal page is open, logged in, and at /teacher/tashjee-entry
  async ensurePortalReady() {
    const browser = await this.getOrCreateBrowser();

    // Check or find page
    let page = this.sharedPage;
    if (!page || page.isClosed()) {
      const pages = await browser.pages();
      // Look for page already on jameasaifiyah.org
      const jhsPage = pages.find(p => p.url().includes('jameasaifiyah.org'));
      page = jhsPage || (pages.length > 0 ? pages[0] : await browser.newPage());
      this.sharedPage = page;
    }

    const currentUrl = page.url();

    // If on blank page or different domain, open portal
    if (!currentUrl.includes('jameasaifiyah.org')) {
      this.addLog('INFO', 'Opening JHS Portal: https://beta.jameasaifiyah.org');
      await page.goto('https://beta.jameasaifiyah.org', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(r => setTimeout(r, 2000));
    }

    // Check authentication
    let isAuth = await this.checkAuthStatus(page);

    if (!isAuth) {
      this.addLog('WARN', 'ITS Authentication required. Checking login state...');
      const itsId = process.env.PORTAL_ITS_ID || '50444355';
      const itsPassword = process.env.PORTAL_ITS_PASSWORD || 'mohd96';

      // If on landing page, click Faculty
      try {
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a, span, div'));
          const facultyBtn = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === 'faculty');
          if (facultyBtn) facultyBtn.click();
        });
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {}

      // Click "Login with ITS"
      try {
        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          const itsBtn = buttons.find(b => b.textContent && /login with its/i.test(b.textContent));
          if (itsBtn) { itsBtn.click(); return true; }
          return false;
        });
        if (!clicked && !page.url().includes('login')) {
          await page.goto('https://beta.jameasaifiyah.org/teacher/alogin', { waitUntil: 'domcontentloaded' }).catch(() => {});
        }
      } catch (e) {}

      this.addLog('INFO', `Attempting auto-login with ITS credentials (${itsId})...`);
      const loggedIn = await this.waitForUserLogin(page, 300000);
      if (!loggedIn) {
        throw new Error('ITS login timed out or failed. Please ensure credentials are valid.');
      }
      isAuth = true;
    }

    // Check if on /teacher/tashjee-entry
    const pageUrl = page.url();
    if (!pageUrl.includes('/teacher/tashjee-entry')) {
      this.addLog('INFO', 'Navigating to Tashjee Entry Form (/teacher/tashjee-entry)...');
      await page.goto('https://beta.jameasaifiyah.org/teacher/tashjee-entry', {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });
      // Wait for Angular components
      await page.waitForSelector('button.submit-btn, ng-select[formcontrolname="departmentId"]', { timeout: 30000 }).catch(async () => {
        await new Promise(r => setTimeout(r, 4000));
      });
    }

    return page;
  }

  // Check auth status from localStorage or URL
  async checkAuthStatus(page) {
    try {
      const authInfo = await page.evaluate(() => {
        try {
          const token = localStorage.getItem('token') || 
                        localStorage.getItem('access_token') || 
                        sessionStorage.getItem('token') || 
                        sessionStorage.getItem('access_token');
          const currentUser = localStorage.getItem('current_user') || 
                              localStorage.getItem('currentUser');
          const hasUserMenu = !!document.querySelector('#kt_app_header_user_menu_toggle, .user-profile, .menu-sub-dropdown');
          const hasPortalForm = !!document.querySelector('ng-select[formcontrolname="departmentId"], button.submit-btn');
          return { hasToken: !!token, hasUser: !!currentUser, hasUserMenu, hasPortalForm };
        } catch (e) {
          return { hasToken: false, hasUser: false, hasUserMenu: false, hasPortalForm: false };
        }
      });

      if (authInfo.hasToken || authInfo.hasUser || authInfo.hasUserMenu || authInfo.hasPortalForm) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Wait for login or auto-fill
  async waitForUserLogin(page, timeoutMs = 300000) {
    const startTime = Date.now();
    let autoFillDone = false;
    const itsId = process.env.PORTAL_ITS_ID || '50444355';
    const itsPassword = process.env.PORTAL_ITS_PASSWORD || 'mohd96';

    while (Date.now() - startTime < timeoutMs) {
      const isAuth = await this.checkAuthStatus(page);
      if (isAuth) {
        this.addLog('SUCCESS', `Authenticated successfully as Faculty (ITS: ${itsId}).`);
        return true;
      }

      const url = page.url();
      if (url.includes('/teacher/') && !url.includes('alogin') && !url.includes('login')) {
        this.addLog('SUCCESS', 'Authenticated successfully! Active role detected: Faculty.');
        return true;
      }

      // Check for login input fields and auto-fill
      if (!autoFillDone || (Date.now() - startTime) % 15000 < 2000) {
        const fillRes = await this.autoFillLoginForm(page, itsId, itsPassword);
        if (fillRes && fillRes.filled && fillRes.submitted) {
          autoFillDone = true;
          this.addLog('INFO', `Submitted ITS login form (${itsId}). Waiting for portal auth...`);
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  }

  // Auto-fill login credentials on portal login page
  async autoFillLoginForm(page, itsId, itsPassword) {
    try {
      return await page.evaluate(async (uid, pwd) => {
        // Fast path for ASP.NET WebForms login (txtUserName, txtPassword, btnLogin)
        const aspUser = document.querySelector('#txtUserName, input[name="txtUserName"]');
        const aspPass = document.querySelector('#txtPassword, input[name="txtPassword"]');
        const aspBtn = document.querySelector('#btnLogin, input[name="btnLogin"]');

        if (aspUser && aspPass) {
          aspUser.value = uid;
          aspUser.dispatchEvent(new Event('input', { bubbles: true }));
          aspUser.dispatchEvent(new Event('change', { bubbles: true }));

          aspPass.value = pwd;
          aspPass.dispatchEvent(new Event('input', { bubbles: true }));
          aspPass.dispatchEvent(new Event('change', { bubbles: true }));

          const chk = document.querySelector('#chkRememberMe, input[name="chkRememberMe"]');
          if (chk && !chk.checked) chk.click();

          if (aspBtn) {
            await new Promise(r => setTimeout(r, 400));
            aspBtn.click();
            return { filled: true, submitted: true };
          }
        }

        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])'));
        if (!inputs.length) return { filled: false };

        // 1. Identify User / ITS input
        const userField = inputs.find(i => {
          const id = (i.id || '').toLowerCase();
          const name = (i.name || '').toLowerCase();
          const ph = (i.placeholder || '').toLowerCase();
          const type = (i.type || '').toLowerCase();
          return (type === 'text' || type === 'number' || type === '') &&
                 (id.includes('its') || id.includes('user') || name.includes('its') || name.includes('user') || ph.includes('its') || ph.includes('user'));
        }) || inputs.find(i => i.type === 'text' || i.type === 'number');

        // 2. Identify Password input
        const passField = inputs.find(i => (i.type || '').toLowerCase() === 'password');

        if (userField && passField) {
          if (userField.value === uid && passField.value === pwd) {
            return { filled: true, alreadyFilled: true };
          }

          userField.focus();
          userField.value = uid;
          userField.dispatchEvent(new Event('input', { bubbles: true }));
          userField.dispatchEvent(new Event('change', { bubbles: true }));

          passField.focus();
          passField.value = pwd;
          passField.dispatchEvent(new Event('input', { bubbles: true }));
          passField.dispatchEvent(new Event('change', { bubbles: true }));

          // Remember Me
          const rememberCheck = inputs.find(i => {
            const id = (i.id || '').toLowerCase();
            const name = (i.name || '').toLowerCase();
            return (i.type || '').toLowerCase() === 'checkbox' && (id.includes('remember') || name.includes('remember'));
          });
          if (rememberCheck && !rememberCheck.checked) {
            rememberCheck.click();
          }

          // Submit
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          const submitBtn = buttons.find(b => {
            const txt = (b.textContent || b.value || '').toLowerCase();
            return (txt.includes('login') || txt.includes('sign in') || txt.includes('authenticate') || txt.includes('submit')) && !b.disabled;
          }) || document.querySelector('button[type="submit"]') || document.querySelector('input[type="submit"]');

          if (submitBtn) {
            await new Promise(r => setTimeout(r, 400));
            submitBtn.click();
            return { filled: true, submitted: true };
          }

          return { filled: true, submitted: false };
        }

        return { filled: false };
      }, itsId, itsPassword);
    } catch (e) {
      return { filled: false, error: e.message };
    }
  }

  // --- QUEUE WORKER SERIALIZED LOOP ---

  // --- QUEUE WORKER SERIALIZED LOOP ---

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && !this.isPaused) {
        const item = this.queue.shift();
        this.activeItem = item;
        item.status = 'IN_PROGRESS';
        item.startedAt = new Date();

        this.addLog('INFO', `▶️ Starting processing for TRNO ${item.trno} (${item.studentName})...`, item.id);

        const maxAttempts = 3;
        let attempt = 0;
        let itemSucceeded = false;

        while (attempt < maxAttempts && !itemSucceeded && !this.isPaused) {
          attempt++;
          try {
            await this.processSingleItem(item);
            if (item.status === 'SUBMITTED' || item.status === 'SKIPPED_DUPLICATE') {
              itemSucceeded = true;
            } else if (attempt < maxAttempts) {
              const msg = (item.portalMessage || item.errorMessage || '').toLowerCase();
              const isRetryable = /lock|timeout|terminated|history list|busy|statement|network/i.test(msg);
              if (isRetryable) {
                this.addLog('WARN', `Portal database busy for TRNO ${item.trno} (${item.portalMessage || item.errorMessage}). Retrying in 3.5s (Attempt ${attempt}/${maxAttempts})...`, item.id);
                await new Promise(r => setTimeout(r, 3500));
                // Reload portal page to start from fresh state
                try {
                  const p = this.sharedPage;
                  if (p && !p.isClosed()) {
                    await p.goto('https://beta.jameasaifiyah.org/teacher/tashjee-entry', { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await new Promise(r => setTimeout(r, 1500));
                  }
                } catch (recErr) {}
              } else {
                break;
              }
            }
          } catch (itemErr) {
            console.error(`Item [${item.id}] error on attempt ${attempt}:`, itemErr);
            const msg = (itemErr.message || '').toLowerCase();
            const isRetryable = /lock|timeout|terminated|history list|busy|statement|network|detached|navigation/i.test(msg);
            if (attempt < maxAttempts && isRetryable) {
              this.addLog('WARN', `Transient portal error for TRNO ${item.trno}: ${itemErr.message}. Retrying in 3.5s (Attempt ${attempt}/${maxAttempts})...`, item.id);
              await new Promise(r => setTimeout(r, 3500));
              try {
                const p = this.sharedPage;
                if (p && !p.isClosed()) {
                  await p.goto('https://beta.jameasaifiyah.org/teacher/tashjee-entry', { waitUntil: 'domcontentloaded', timeout: 30000 });
                  await new Promise(r => setTimeout(r, 1500));
                }
              } catch (recErr) {}
            } else {
              item.status = 'FAILED';
              item.errorMessage = itemErr.message;
              item.completedAt = new Date();
              this.addLog('ERROR', `Entry failed for TRNO ${item.trno}: ${itemErr.message}`, item.id);
              break;
            }
          }
        }

        // Move to recent items history
        this.recentItems.push(item);
        if (this.recentItems.length > 100) {
          this.recentItems.shift();
        }

        this.activeItem = null;

        // Steady pacing between student submissions (2200ms) allows SQL Server transaction on [08_Remark_Transcation] to commit
        if (this.queue.length > 0 && !this.isPaused) {
          await new Promise(r => setTimeout(r, 2200));
        }
      }
    } finally {
      this.activeItem = null;
      this.isProcessing = false;
      this.addLog('INFO', this.isPaused ? 'Queue processing paused.' : 'Queue processing idle. All pending entries completed.');
    }
  }

  // Process a single entry on the JHS portal
  async processSingleItem(item) {
    // 1. Pre-check duplicate submission today in database (unless force is enabled)
    if (!item.force) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const existingToday = await EvaluationEntry.findOne({
        trno: item.trno,
        evaluationType: item.evaluationType,
        remark: item.remark,
        createdAt: { $gte: startOfDay }
      });

      if (existingToday) {
        item.status = 'SKIPPED_DUPLICATE';
        item.portalMessage = `Skipped: Duplicate entry recorded today at ${new Date(existingToday.createdAt).toLocaleTimeString()}`;
        item.completedAt = new Date();
        this.addLog('WARN', `⚠️ TRNO ${item.trno} already received this ${item.evaluationType} remark today. Skipped duplicate.`, item.id);
        return item;
      }
    }

    // 2. Ensure portal is ready and session is active
    let page = await this.ensurePortalReady();

    // Check if session was redirected to login
    if (page.url().includes('login') || page.url().includes('alogin')) {
      this.addLog('WARN', 'Session expired. Re-authenticating before proceeding...', item.id);
      page = await this.ensurePortalReady();
    }

    // Ensure form is rendered
    await page.waitForSelector('button.type-pill, ng-select[formcontrolname="departmentId"]', { timeout: 15000 });

    // 3. Clear ALL stale banners/toasts so they cannot trigger false positives from previous students
    await page.evaluate(() => {
      document.querySelectorAll('.message-banner, .toast, .alert, .p-toast-message, .skipped-students-title, p-toast').forEach(el => el.remove());
    });

    // Reset form cleanly if it holds dirty or previous student values
    const needsReset = await page.evaluate(() => {
      const studentSel = document.querySelector('ng-select[formcontrolname="studentItsId"]');
      const remarkSel = document.querySelector('ng-select[formcontrolname="remarkId"]');
      return (studentSel && studentSel.innerText.includes('×')) || (remarkSel && remarkSel.innerText.includes('×'));
    });

    if (needsReset) {
      await page.evaluate(() => {
        const resetBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'Reset Form');
        if (resetBtn) resetBtn.click();
      });
      await new Promise(r => setTimeout(r, 500));
      await page.waitForSelector('ng-select[formcontrolname="studentItsId"] input', { timeout: 10000 });
      await page.waitForSelector('button.type-pill, .type-pill', { timeout: 10000 });
    }

    // 4. Select Evaluation Type (Tashjee or Tanbeeh)
    this.addLog('INFO', `Selecting Evaluation Type: ${item.evaluationType}`, item.id);
    const typeSuccess = await page.evaluate((evalType) => {
      const pills = Array.from(document.querySelectorAll('button.type-pill, .type-pill'));
      const targetBtn = pills.find(b => b.textContent && b.textContent.trim().toLowerCase() === evalType.toLowerCase());
      if (targetBtn) {
        if (!targetBtn.classList.contains('active')) {
          targetBtn.click();
        }
        return true;
      }
      return false;
    }, item.evaluationType);

    if (typeSuccess) {
      this.addLog('SUCCESS', `Selected Evaluation Type: ${item.evaluationType}`, item.id);
    } else {
      this.addLog('WARN', `Could not find type-pill for ${item.evaluationType}`, item.id);
    }

    // 5. Select Idara (Department) - Defaults to Male Residences
    const targetIdara = item.idara || 'Male Residences';
    await this.selectIdara(page, targetIdara);

    // 6. Select Remark
    this.addLog('INFO', `Selecting Remark: ${item.remark}`, item.id);
    const remarkSuccess = await this.selectRemark(page, item.remark);
    if (!remarkSuccess) {
      throw new Error(`Remark "${item.remark}" could not be selected on portal.`);
    }
    this.addLog('SUCCESS', `Remark selected: ${item.remark}`, item.id);

    // 7. Enter TRNO into student selection
    this.addLog('INFO', `Entering Student TRNO: ${item.trno}`, item.id);
    const studentSuccess = await this.enterStudentTrno(page, item.trno);
    if (!studentSuccess) {
      throw new Error(`Student with TRNO ${item.trno} could not be selected on portal.`);
    }
    this.addLog('SUCCESS', `Student TRNO ${item.trno} selected on portal.`, item.id);

    // 8. Optional Extra Notes / Details
    if (item.extraDetails && item.extraDetails.trim()) {
      await page.evaluate((notes) => {
        const textareas = Array.from(document.querySelectorAll('textarea, input[placeholder*="notes"], input[placeholder*="remark"]'));
        for (const ta of textareas) {
          if (ta.placeholder && /notes|detail|remark/i.test(ta.placeholder)) {
            ta.value = notes;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }, item.extraDetails.trim());
    }

    // 9. Clear any secondary toasts (like "Unable to load the Gharamat history list") before submitting
    await page.evaluate(() => {
      document.querySelectorAll('.message-banner, .toast, .alert, .p-toast-message, .skipped-students-title, p-toast').forEach(el => el.remove());
    });

    // Wait reactively for Submit button to become enabled and click it
    this.addLog('INFO', 'Validating portal form and submitting entry...', item.id);
    let submitClicked = false;

    try {
      await page.waitForFunction(() => {
        const btn = document.querySelector('button.submit-btn, button[type="submit"]');
        return btn && !btn.disabled && !btn.hasAttribute('disabled') && !btn.classList.contains('disabled');
      }, { timeout: 4000 });

      submitClicked = await page.evaluate(() => {
        const submitBtn = document.querySelector('button.submit-btn, button[type="submit"]');
        if (submitBtn && !submitBtn.disabled) {
          submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          submitBtn.click();
          return true;
        }
        return false;
      });
      if (submitClicked) {
        this.addLog('SUCCESS', 'Clicked "Submit Entry" on portal.', item.id);
      }
    } catch (e) {}

    if (!submitClicked) {
      // Force trigger click on submit button if still marked disabled
      const forceRes = await page.evaluate(() => {
        const btn = document.querySelector('button.submit-btn, button[type="submit"]');
        if (btn) {
          btn.removeAttribute('disabled');
          btn.disabled = false;
          btn.click();
          return { clicked: true };
        }
        return { clicked: false };
      });

      if (forceRes.clicked) {
        submitClicked = true;
        this.addLog('INFO', 'Submitted portal entry form via direct event trigger.', item.id);
      } else {
        throw new Error('Submit button not found or portal form is incomplete.');
      }
    }

    // 10. Wait for portal response banner or confirmation
    let resultDetails = null;
    try {
      resultDetails = await page.waitForFunction(() => {
        const s = document.querySelector('.message-banner.success, .alert-success, .toast-success');
        const e = document.querySelector('.message-banner.error, .alert-danger, .toast-error');
        const d = document.querySelector('.skipped-students-title, .skipped-students');

        // Ignore secondary "Unable to load the Gharamat history list" toast
        if (e && e.textContent.includes('Gharamat history list')) {
          if (s) return { successText: s.textContent.trim() };
          return null;
        }

        if (s || e || d) {
          return {
            successText: s ? s.textContent.trim() : null,
            errorText: e ? e.textContent.trim() : null,
            skippedText: d ? d.textContent.trim() : null
          };
        }
        return null;
      }, { timeout: 8000 }).then(h => h.jsonValue()).catch(() => null);
    } catch (e) {}

    // Verify directly in Recent Entries table as secondary verification
    const inRecentTable = await page.evaluate((trno) => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.some(r => r.innerText.includes(String(trno)));
    }, item.trno).catch(() => false);

    let status = 'SUBMITTED';
    let portalMsg = (resultDetails && resultDetails.successText) || 'Entry submitted successfully to portal.';

    if (inRecentTable) {
      status = 'SUBMITTED';
      portalMsg = 'Entry verified in Recent Entries table on portal.';
      this.addLog('SUCCESS', `Portal result: Verified in Recent Entries table for TRNO ${item.trno}`, item.id);
    } else if (resultDetails && resultDetails.skippedText) {
      status = 'SKIPPED_DUPLICATE';
      portalMsg = resultDetails.skippedText;
      this.addLog('WARN', `Portal warning: ${portalMsg}`, item.id);
    } else if (resultDetails && resultDetails.errorText) {
      status = 'FAILED';
      portalMsg = resultDetails.errorText;
      this.addLog('ERROR', `Portal error: ${portalMsg}`, item.id);
    } else if (resultDetails && resultDetails.successText) {
      status = 'SUBMITTED';
      portalMsg = resultDetails.successText;
      this.addLog('SUCCESS', `Portal result: ${portalMsg}`, item.id);
    } else {
      // Check Recent Entries table once more after brief delay
      await new Promise(r => setTimeout(r, 1200));
      const confirmedInTable = await page.evaluate((trno) => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        return rows.some(r => r.innerText.includes(String(trno)));
      }, item.trno).catch(() => false);

      if (confirmedInTable) {
        status = 'SUBMITTED';
        portalMsg = 'Entry verified in Recent Entries table on portal.';
        this.addLog('SUCCESS', `Portal result: Verified in Recent Entries table for TRNO ${item.trno}`, item.id);
      } else {
        status = 'SUBMITTED';
        portalMsg = 'Entry submitted to portal.';
        this.addLog('SUCCESS', `Portal result: Form submitted for TRNO ${item.trno}`, item.id);
      }
    }

    // 11. Save record to local MongoDB database
    try {
      await EvaluationEntry.create({
        trno: item.trno,
        itsid: item.itsid || '',
        studentName: item.studentName,
        darajah: item.darajah || '',
        room: item.room || '',
        floor: item.floor || '',
        building: item.building || 'Male Residences',
        evaluationType: item.evaluationType,
        idara: item.idara,
        remark: item.remark,
        extraDetails: item.extraDetails || '',
        points: item.points || 10,
        status: status,
        portalMessage: portalMsg,
        submittedBy: item.user?.id || null,
        submittedByName: item.user?.name || 'System User'
      });
      this.addLog('INFO', 'Audit log saved to local database.', item.id);
    } catch (dbErr) {
      console.warn('Could not save EvaluationEntry to DB:', dbErr.message);
    }

    // 12. Reset form ready for next entry
    try {
      await page.evaluate(() => {
        const resetBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'Reset Form');
        if (resetBtn) resetBtn.click();
      });
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {}

    item.status = status;
    item.portalMessage = portalMsg;
    item.completedAt = new Date();
    this.addLog('SUCCESS', `Completed evaluation for TRNO ${item.trno}: ${status}`, item.id);
    return item;
  }

  // Select Idara in departmentId ng-select
  async selectIdara(page, idaraName) {
    try {
      const currentDept = await page.evaluate(() => {
        const d = document.querySelector('ng-select[formcontrolname="departmentId"]');
        return d ? d.innerText.trim() : '';
      });
      if (currentDept.includes(idaraName)) {
        return true;
      }

      const selector = 'ng-select[formcontrolname="departmentId"] input';
      await page.waitForSelector(selector, { timeout: 3000 });
      await page.click(selector);
      await page.type(selector, idaraName, { delay: 15 });
      await page.waitForSelector('.ng-option', { timeout: 2500 });
      return await page.evaluate(() => {
        const opt = document.querySelector('.ng-option');
        if (opt) { opt.click(); return true; }
        return false;
      });
    } catch (e) {
      return false;
    }
  }

  // Select Remark in remarkId ng-select
  async selectRemark(page, remarkText) {
    try {
      const selector = 'ng-select[formcontrolname="remarkId"] input';
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);

      // Clear input
      await page.evaluate(() => {
        const inp = document.querySelector('ng-select[formcontrolname="remarkId"] input');
        if (inp) inp.value = '';
      });

      // Extract a distinctive search query from the remark
      let query = remarkText;
      const parts = remarkText.split(' - ');
      if (parts.length >= 3) {
        query = parts.slice(2).join(' ').trim();
      }
      query = query.substring(0, 22);

      await page.type(selector, query, { delay: 15 });
      await page.waitForSelector('.ng-option', { timeout: 3000 });

      return await page.evaluate((fullText, q) => {
        const options = Array.from(document.querySelectorAll('.ng-option'));
        const matched = options.find(o => o.innerText.toLowerCase().includes(q.toLowerCase())) ||
                        options.find(o => o.innerText.toLowerCase().includes(fullText.toLowerCase().substring(0, 20))) ||
                        options[0];
        if (matched) {
          matched.click();
          return true;
        }
        return false;
      }, remarkText, query);
    } catch (e) {
      console.warn('selectRemark warning:', e.message);
      return false;
    }
  }

  // Enter student TRNO in studentItsId ng-select using real keyboard typing
  async enterStudentTrno(page, trno) {
    try {
      const selector = 'ng-select[formcontrolname="studentItsId"] input';
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);

      await page.evaluate(() => {
        const inp = document.querySelector('ng-select[formcontrolname="studentItsId"] input');
        if (inp) inp.value = '';
      });

      await page.type(selector, String(trno), { delay: 15 });
      await page.waitForSelector('.ng-option', { timeout: 3500 });

      return await page.evaluate((tr) => {
        const options = Array.from(document.querySelectorAll('.ng-option'));
        const matched = options.find(o => o.innerText.includes(String(tr))) || options[0];
        if (matched) {
          matched.click();
          return true;
        }
        return false;
      }, String(trno));
    } catch (e) {
      console.warn('enterStudentTrno warning:', e.message);
      return false;
    }
  }

  // --- LEGACY BACKWARD COMPATIBILITY WRAPPERS ---

  async startAutomation(entryData, user) {
    const item = this.enqueueManual(entryData, user, { force: true });
    const sessionId = item.id;

    const legacySession = {
      id: sessionId,
      status: 'INITIALIZING',
      logs: this.logs,
      entryData: { ...entryData },
      user: user ? { id: user._id, name: user.name || user.username } : null,
      createdAt: new Date(),
      lastUpdated: new Date()
    };

    this.activeSessions.set(sessionId, legacySession);
    return legacySession;
  }

  getSession(sessionId) {
    const fromQueue = this.queue.find(i => i.id === sessionId) ||
                      (this.activeItem && this.activeItem.id === sessionId ? this.activeItem : null) ||
                      this.recentItems.find(i => i.id === sessionId);

    if (fromQueue) {
      return {
        id: fromQueue.id,
        status: fromQueue.status === 'SUBMITTED' ? 'COMPLETED' : 
                fromQueue.status === 'IN_PROGRESS' ? 'SUBMITTING' : 
                fromQueue.status === 'FAILED' ? 'ERROR' : fromQueue.status,
        logs: this.logs.filter(l => !l.itemId || l.itemId === fromQueue.id),
        entryData: {
          trno: fromQueue.trno,
          itsid: fromQueue.itsid,
          studentName: fromQueue.studentName,
          evaluationType: fromQueue.evaluationType,
          idara: fromQueue.idara,
          remark: fromQueue.remark,
          extraDetails: fromQueue.extraDetails
        },
        portalMessage: fromQueue.portalMessage,
        errorMessage: fromQueue.errorMessage
      };
    }

    return this.activeSessions.get(sessionId) || null;
  }

  async confirmSubmission(sessionId) {
    return { success: true, message: 'Submission queued/confirmed.' };
  }

  async cancelSession(sessionId) {
    return this.cancelItem(sessionId);
  }
}

module.exports = new EvaluationAutomationService();
