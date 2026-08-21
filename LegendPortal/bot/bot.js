const {
    chromium
} = require('playwright');

const APP_ORIGIN = process.env.APP_ORIGIN || "http://app:3000";
const APP_URL = new URL(APP_ORIGIN);

const INTERNAL_SECRET = process.env.INTERNAL_SECRET;

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || process.env.POLL_INTERVAL) || 3000;

const VISIT_TIMEOUT_MS = Number(process.env.VISIT_TIMEOUT_MS || process.env.VISIT_INTERVAL) || 10000;
const BLOCKED_APP_PREFIXES = ['/admin', '/api/admin', '/internal'];

if (!INTERNAL_SECRET) {
    throw new Error("INTERNAL_SECRET environment variable is not set.");
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isPrivateIPv4(hostname) {
    const parts = hostname.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }

    const [first, second] = parts;
    return first === 10 ||
        first === 127 ||
        first === 0 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
}

function isPrivateIPv6(hostname) {
    const normalized = hostname.toLowerCase();
    return normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:');
}

function isInternalHostname(hostname) {
    const normalized = hostname.toLowerCase();
    const appHost = APP_URL.hostname.toLowerCase();

    if (normalized === appHost) {
        return false;
    }

    if ([
        'localhost',
        '127.0.0.1',
        '0.0.0.0',
        '::1'
    ].includes(normalized)) {
        return true;
    }

    if (isPrivateIPv4(normalized) || isPrivateIPv6(normalized)) {
        return true;
    }

    // Docker service names such as "admin" or "redis" should never be reachable from XSS.
    if (!normalized.includes('.')) {
        return true;
    }

    return false;
}

function isBlockedAppPath(pathname) {
    return BLOCKED_APP_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function shouldBlockBrowserRequest(targetUrl) {
    let parsedUrl;
    try {
        parsedUrl = new URL(targetUrl);
    } catch (_error) {
        return false;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return false;
    }

    if (parsedUrl.origin === APP_URL.origin) {
        return isBlockedAppPath(parsedUrl.pathname);
    }

    return isInternalHostname(parsedUrl.hostname);
}

async function getAdminCookie() {
    const response = await fetch(`${APP_ORIGIN}/internal/bot/token`, {
        headers: { "X-internal-secret": INTERNAL_SECRET }
    });
    if (!response.ok) {
        throw new Error(`Failed to get admin token: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

//Queue API

async function getNextReport() {
    const response = await fetch(`${APP_ORIGIN}/internal/reports/next`, {
        headers: {
            "X-internal-secret": INTERNAL_SECRET
        }
    });
    if (response.status === 204 || response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`Failed to get next report: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.report || data;
}
async function markReviewed(reportId) {
    const response = await fetch(`${APP_ORIGIN}/internal/reports/${reportId}/reviewed`, {
        method: "POST",
        headers: {
            "X-internal-secret": INTERNAL_SECRET
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to mark report as reviewed: ${response.status} ${response.statusText}`);
    }
}
async function markFailed(reportId, errorMessage) {
    const response = await fetch(`${APP_ORIGIN}/internal/reports/${reportId}/failed`, {
        method: "POST",
        headers: {
            "X-internal-secret": INTERNAL_SECRET,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: errorMessage })
    });
    if (!response.ok) {
        throw new Error(`Failed to mark report as failed: ${response.status} ${response.statusText}`);
    }
}

async function visitReport(browser, report) {
    const target =
        `${APP_ORIGIN}/posts/${report.post_id}`;


    console.log(
        `[BOT] Reviewing report ${report.id}`
    );


    console.log(
        `[BOT] Visiting ${target}`
    );

    const adminCookie = await getAdminCookie();
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    });
    try {
        await context.route('**/*', route => {
            const url = route.request().url();
            if (shouldBlockBrowserRequest(url)) {
                console.log(`[BOT] Blocked browser request to ${url}`);
                return route.abort('blockedbyclient');
            }
            return route.continue();
        });
        await context.addCookies([{
            name: adminCookie.cookieName,
            value: adminCookie.token,
            url: APP_ORIGIN,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax'
        }]);
        const page = await context.newPage();
        await page.goto(target, { timeout: VISIT_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        console.log(`[BOT] Successfully visited report ${report.id}`);
    } finally {
        await context.close();
    }
}
async function main() {
    console.log("[BOT] Starting bot...");
    console.log(`[BOT] App origin: ${APP_ORIGIN}`);
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    process.on('SIGINT', async () => {
        console.log("[BOT] Shutting down...");
        await browser.close();
        process.exit(0);
    });

    while (true) {
        try {
            const report = await getNextReport();
            if (!report) {
                await sleep(POLL_INTERVAL_MS);
                continue;
            }
            try {
                await visitReport(browser, report);
                await markReviewed(report.id);
            } catch (error) {
                console.error(`[BOT] Error occurred while processing report ${report.id}:`, error);
                await markFailed(report.id, error.message);
            }
        } catch (error) {
            console.error("[BOT] Error occurred while fetching next report:", error);
            await sleep(POLL_INTERVAL_MS);
        }
    }
}

main().catch(error => {
    console.error("[BOT] Fatal error occurred:", error);
    process.exit(1);
});
