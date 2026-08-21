const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const app = express();

const PORT = Number(process.env.PORT || process.env.APP_PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL || 'http://admin:4000';
const ADMIN_SERVICE_TOKEN = process.env.ADMIN_SERVICE_TOKEN;
const AUTH_COOKIE = 'jwt_token';
const TOKEN_TTL_SECONDS = 60 * 60 * 2;

for (const [name, value] of Object.entries({ JWT_SECRET, INTERNAL_SECRET, ADMIN_SERVICE_TOKEN })) {
    if (!value) throw new Error(`${name} is not defined in the environment variables.`);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

function parseCookies(header = '') {
    return header.split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return cookies;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (name) cookies[name] = decodeURIComponent(value);
        return cookies;
    }, {});
}

function signToken(user) {
    return jwt.sign(
        { username: user.username, role: user.role },
        JWT_SECRET,
        {
            algorithm: 'HS256',
            subject: String(user.id),
            expiresIn: TOKEN_TTL_SECONDS,
            issuer: 'legend-portal'
        }
    );
}

function setAuthCookie(res, token) {
    res.cookie(AUTH_COOKIE, token, {
        // Intentionally readable by JavaScript: this is the stored-XSS objective.
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: TOKEN_TTL_SECONDS * 1000,
        path: '/'
    });
}

function ensureReviewerAccount() {
    const username = process.env.ADMIN_USERNAME || 'legend_reviewer';
    let reviewer = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(username);

    if (!reviewer) {
        const randomPassword = crypto.randomBytes(32).toString('hex');
        const passwordHash = bcrypt.hashSync(randomPassword, 10);
        const result = db.prepare(`
            INSERT INTO users (username, password_hash, role)
            VALUES (?, ?, 'admin')
        `).run(username, passwordHash);
        reviewer = { id: Number(result.lastInsertRowid), username, role: 'admin' };
    } else if (reviewer.role !== 'admin') {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(reviewer.id);
        reviewer.role = 'admin';
    }

    return reviewer;
}

const reviewerAccount = ensureReviewerAccount();

app.use((req, _res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
    if (token) {
        try {
            const payload = jwt.verify(token, JWT_SECRET, {
                algorithms: ['HS256'],
                issuer: 'legend-portal'
            });
            req.user = {
                id: Number(payload.sub),
                username: payload.username,
                role: payload.role
            };
        } catch (_error) {
            // Invalid and expired tokens are treated as logged out.
        }
    }
    next();
});

function requireAuth(req, res, next) {
    if (!req.user) return res.redirect(303, '/login');
    next();
}

function requireApiAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user) return res.redirect(303, '/login');
    if (!['admin', 'superadmin'].includes(req.user.role)) {
        return res.status(403).render('403', { user: req.user, error: 'Chỉ có admin mới được truy cập nha' });
    }
    next();
}

function requireSuperadmin(req, res, next) {
    if (!req.user) return res.redirect(303, '/login');
    if (req.user.role !== 'superadmin') {
        return res.status(403).render('403', {
            user: req.user,
            error: 'Liên hệ với supperadmin hoặc chính bạn có thể trở thành họ =))'
        });
    }
    next();
}

function requireApiRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: `Required role: ${roles.join(' or ')}` });
        }
        next();
    };
}

function requireInternal(req, res, next) {
    const suppliedBuffer = Buffer.from(req.get('X-Internal-Secret') || '');
    const expectedBuffer = Buffer.from(INTERNAL_SECRET || '');
    const valid = suppliedBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
    if (!valid) return res.status(403).json({ error: 'Forbidden' });
    next();
}

async function readFlagFromVault() {
    const response = await fetch(`${ADMIN_SERVICE_URL}/api/flag`, {
        headers: { 'X-Admin-Service-Token': ADMIN_SERVICE_TOKEN },
        signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) throw new Error(`Flag vault returned ${response.status}`);
    const data = await response.json();
    return data.flag;
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function normalizeInternalRedirect(target, fallback) {
    if (typeof target !== 'string') return fallback;
    if (!target.startsWith('/')) return fallback;
    if (target.startsWith('//')) return fallback;
    return target;
}

app.get('/', (req, res) => {
    const posts = db.prepare(`
        SELECT posts.id, posts.title, posts.content, posts.created_at, users.username
        FROM posts
        JOIN users ON posts.user_id = users.id
        ORDER BY posts.created_at DESC
    `).all();

    let createdPost = null;
    const createdPostId = Number(req.query.created);
    if (req.user && Number.isInteger(createdPostId) && createdPostId > 0) {
        createdPost = db.prepare(`
            SELECT posts.id, posts.title, posts.created_at
            FROM posts
            WHERE posts.id = ? AND posts.user_id = ?
        `).get(createdPostId, req.user.id) || null;
    }

    const reportedPostId = Number(req.query.reported);

    res.render('index', {
        user: req.user,
        posts,
        createdPost,
        reportedPostId: Number.isInteger(reportedPostId) && reportedPostId > 0 ? reportedPostId : null
    });
});

app.get('/register', (req, res) => {
    if (req.user) return res.redirect(303, '/');
    res.render('register', { user: null, error: null });
});

app.post('/register', async (req, res, next) => {
    try {
        if (req.user) return res.redirect(303, '/');
        let { username, password } = req.body;
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).render('register', { user: null, error: 'Invalid input' });
        }

        username = username.trim();
        if (username.length < 3 || username.length > 20) {
            return res.status(400).render('register', {
                user: null,
                error: 'Username must be between 3 and 20 characters'
            });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).render('register', {
                user: null,
                error: 'Username can only contain letters, numbers, and underscores'
            });
        }
        if (password.length < 6 || password.length > 100) {
            return res.status(400).render('register', {
                user: null,
                error: 'Password must be between 6 and 100 characters'
            });
        }
        if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
            return res.status(400).render('register', { user: null, error: 'Username already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = db.prepare(`
            INSERT INTO users (username, password_hash, role)
            VALUES (?, ?, 'user')
        `).run(username, passwordHash);
        const user = { id: Number(result.lastInsertRowid), username, role: 'user' };
        setAuthCookie(res, signToken(user));
        res.redirect(303, '/');
    } catch (error) {
        next(error);
    }
});

app.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, '/');
    res.render('login', { user: null, error: null });
});

app.post('/login', async (req, res, next) => {
    try {
        if (req.user) return res.redirect(303, '/');
        let { username, password } = req.body;
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).render('login', { user: null, error: 'Invalid input' });
        }

        username = username.trim();
        const user = db.prepare(`
            SELECT id, username, password_hash, role
            FROM users
            WHERE username = ?
        `).get(username);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(400).render('login', { user: null, error: 'Invalid username or password' });
        }

        setAuthCookie(res, signToken(user));
        res.redirect(303, '/');
    } catch (error) {
        next(error);
    }
});

function logout(_req, res) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    res.redirect(303, '/login');
}
app.get('/logout', logout);
app.post('/logout', logout);

app.get('/posts/create', requireAuth, (req, res) => {
    res.render('create', { user: req.user, error: null });
});

app.post('/posts', requireAuth, (req, res, next) => {
    try {
        let { title, content } = req.body;
        if (typeof title !== 'string' || typeof content !== 'string') {
            return res.status(400).render('create', { user: req.user, error: 'Invalid post' });
        }

        title = title.trim();
        if (title.length < 1 || title.length > 100) {
            return res.status(400).render('create', {
                user: req.user,
                error: 'Title must be between 1 and 100 characters'
            });
        }
        if (content.length < 1 || content.length > 3000) {
            return res.status(400).render('create', {
                user: req.user,
                error: 'Content must be between 1 and 3000 characters'
            });
        }

        const result = db.prepare(`
            INSERT INTO posts (user_id, title, content)
            VALUES (?, ?, ?)
        `).run(req.user.id, title, content);
        res.redirect(303, `/?created=${result.lastInsertRowid}`);
    } catch (error) {
        next(error);
    }
});

app.get('/posts/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).render('404', { user: req.user, error: 'Invalid post ID' });
    }

    const post = db.prepare(`
        SELECT posts.id, users.username, posts.title, posts.content, posts.created_at
        FROM posts
        JOIN users ON posts.user_id = users.id
        WHERE posts.id = ?
    `).get(id);
    if (!post) return res.status(404).render('404', { user: req.user, error: 'Post not found' });

    res.render('post', { user: req.user, post, reported: req.query.reported === '1' });
});

function submitReport(postId, reporterId) {
    if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(postId)) {
        return { ok: false, status: 404, error: 'Post not found' };
    }

    const existing = db.prepare(`
        SELECT id FROM reports
        WHERE post_id = ? AND reporter_id = ? AND status = 'pending'
    `).get(postId, reporterId);
    if (!existing) {
        db.prepare(`
            INSERT INTO reports (post_id, reporter_id, status)
            VALUES (?, ?, 'pending')
        `).run(postId, reporterId);
    }
    return { ok: true };
}

app.post('/posts/:id/report', requireAuth, (req, res, next) => {
    try {
        const postId = Number(req.params.id);
        if (!Number.isInteger(postId) || postId <= 0) {
            return res.status(400).render('404', { user: req.user, error: 'Invalid post ID' });
        }
        const result = submitReport(postId, req.user.id);
        if (!result.ok) {
            return res.status(result.status).render('404', { user: req.user, error: result.error });
        }
        const fallbackTarget = `/posts/${postId}?reported=1`;
        const nextTarget = normalizeInternalRedirect(req.body.next, fallbackTarget);
        res.redirect(303, nextTarget);
    } catch (error) {
        next(error);
    }
});

app.post('/api/reports', requireApiAuth, (req, res, next) => {
    try {
        const postId = Number(req.body.postId);
        if (!Number.isInteger(postId) || postId <= 0) {
            return res.status(400).json({ error: 'Invalid post ID' });
        }
        const result = submitReport(postId, req.user.id);
        if (!result.ok) return res.status(result.status).json({ error: result.error });
        res.status(202).json({ message: 'Report queued for admin review' });
    } catch (error) {
        next(error);
    }
});

app.get('/admin', requireAdmin, (_req, res) => res.redirect(303, '/admin/dashboard'));
app.get('/admin/dashboard', requireAdmin, (req, res) => {
    res.render('admin-dashboard', { user: req.user });
});
app.get('/admin/secret', requireAdmin, (req, res) => {
    res.render('admin-secret', { user: req.user, secret: JWT_SECRET });
});
app.get('/api/admin/secret', requireApiRole('admin', 'superadmin'), (_req, res) => {
    res.json({ algorithm: 'HS256', secret: JWT_SECRET });
});
app.get('/admin/flag', requireSuperadmin, async (req, res, next) => {
    try {
        res.render('admin-flag', { user: req.user, flag: await readFlagFromVault() });
    } catch (error) {
        next(error);
    }
});
app.get('/api/admin/flag', requireApiRole('superadmin'), async (_req, res, next) => {
    try {
        res.json({ flag: await readFlagFromVault() });
    } catch (error) {
        next(error);
    }
});

app.get('/internal/bot/token', requireInternal, (_req, res) => {
    res.json({
        cookieName: AUTH_COOKIE,
        token: signToken(reviewerAccount),
        maxAge: TOKEN_TTL_SECONDS
    });
});

app.get('/internal/reports/next', requireInternal, (_req, res) => {
    const report = db.prepare(`
        SELECT id, post_id, reporter_id, status, created_at
        FROM reports
        WHERE status = 'pending'
        ORDER BY id ASC
        LIMIT 1
    `).get();
    if (!report) return res.status(404).json({ error: 'No pending reports found' });
    res.json(report);
});

app.post('/internal/reports/:id/reviewed', requireInternal, (req, res) => {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
        return res.status(400).json({ error: 'Invalid report ID' });
    }
    const result = db.prepare(`
        UPDATE reports SET status = 'reviewed'
        WHERE id = ? AND status = 'pending'
    `).run(reportId);
    if (!result.changes) return res.status(404).json({ error: 'Report not found or already reviewed' });
    res.json({ ok: true });
});

app.post('/internal/reports/:id/failed', requireInternal, (req, res) => {
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
        return res.status(400).json({ error: 'Invalid report ID' });
    }
    db.prepare(`
        UPDATE reports SET status = 'failed'
        WHERE id = ? AND status = 'pending'
    `).run(reportId);
    res.json({ ok: true });
});

app.use((req, res) => {
    res.status(404).render('404', { user: req.user, error: 'Page not found' });
});

app.use((error, req, res, _next) => {
    console.error(error.stack || error);
    res.status(500).render('500', { user: req.user, error: 'Internal Server Error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Legend Portal listening on http://0.0.0.0:${PORT}`);
});
