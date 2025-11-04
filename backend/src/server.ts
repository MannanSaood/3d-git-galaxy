
import express from 'express';
import cors from 'cors';
import path from 'path';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import type { RepoData, CommitNode } from './types';
import { fileURLToPath } from 'url';
import session from 'express-session';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initDb, getRepo, storeRepo } from './database.js';
import { addJob, getJobStatus, updateJobStatus } from './jobQueue.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Get DATABASE_URL for session config (same as database.ts uses)
const DATABASE_URL = process.env.DATABASE_URL;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
// Load .env.local first (if it exists), then fallback to .env
const pathToEnvLocal = path.join(__dirname, '../.env.local');
const pathToEnv = path.join(__dirname, '../.env');

// Try to load .env.local first
try {
    dotenv.config({ path: pathToEnvLocal });
} catch (error) {
    // .env.local doesn't exist, that's okay
}

// Also try .env as fallback
try {
    dotenv.config({ path: pathToEnv });
} catch (error) {
    // .env doesn't exist, that's okay
}

// Configure CORS to allow credentials and Vercel frontend
// Normalize FRONTEND_URL by removing trailing slash (browsers send origin without trailing slash)
const FRONTEND_URL_FOR_CORS = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Normalize origin by removing trailing slash
        const normalizedOrigin = origin.replace(/\/$/, '');
        
        // Check if origin matches allowed frontend URL exactly
        if (normalizedOrigin === FRONTEND_URL_FOR_CORS) {
            callback(null, true);
            return;
        }
        
        // In production, allow Vercel preview deployments
        // Vercel preview URLs: https://3d-git-galaxy-*-*-*.vercel.app (can have multiple segments)
        // Vercel production URL: https://3d-git-galaxy.vercel.app
        if (process.env.NODE_ENV === 'production' && FRONTEND_URL_FOR_CORS.includes('vercel.app')) {
            // Extract base domain from FRONTEND_URL (e.g., "3d-git-galaxy" from "https://3d-git-galaxy.vercel.app")
            const frontendUrlMatch = FRONTEND_URL_FOR_CORS.match(/https?:\/\/([^.]+)\.vercel\.app/);
            if (frontendUrlMatch) {
                const baseDomain = frontendUrlMatch[1];
                // Check if origin is a Vercel deployment (production or preview)
                // Preview URLs can have multiple segments: baseDomain-segment1-segment2-...
                // Escape the baseDomain for regex (it might contain special chars)
                const escapedBaseDomain = baseDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Match: baseDomain or baseDomain-segments (where segments are alphanumeric/hyphens)
                // Example: 3d-git-galaxy or 3d-git-galaxy-4tcldct5v-mannansaoods-projects
                const vercelPattern = new RegExp(`^https://${escapedBaseDomain}(-[a-zA-Z0-9-]+)*\\.vercel\\.app$`);
                if (vercelPattern.test(normalizedOrigin)) {
                    callback(null, true);
                    return;
                }
            }
        }
        
        // In development, allow localhost with any port
        if (process.env.NODE_ENV === 'development') {
            if (normalizedOrigin.startsWith('http://localhost:') || normalizedOrigin.startsWith('http://127.0.0.1:')) {
                callback(null, true);
                return;
            }
        }
        
        // Reject all other origins
        callback(new Error(`CORS: Origin ${normalizedOrigin} not allowed. Expected ${FRONTEND_URL_FOR_CORS} or Vercel preview deployment`));
    },
    credentials: true
}));
app.use(express.json());

// Trust proxy (required for Koyeb/cloud platforms with load balancers)
app.set('trust proxy', 1);

// Configure session middleware
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Debug logging
console.log('[SESSION CONFIG]', {
    isProduction,
    hasSessionSecret: !!process.env.SESSION_SECRET,
    sessionSecretLength: SESSION_SECRET.length,
    nodeEnv: process.env.NODE_ENV,
    port: PORT,
    hasDatabaseUrl: !!DATABASE_URL
});

// Configure session store - use PostgreSQL if available, otherwise MemoryStore (dev only)
// Initialize synchronously first, then upgrade to PostgreSQL if needed
let sessionStore: any = new session.MemoryStore();

// Wrapper store that delegates to the current sessionStore
// This allows the store to be updated after middleware creation
// Must extend EventEmitter because express-session expects store.on('disconnect')
class DelegatingStore extends EventEmitter {
    // Use public accessor so Proxy can access it
    public currentStore: any;
    
    constructor(initialStore: any) {
        super();
        this.currentStore = initialStore;
        
        // Forward events from the underlying store
        if (this.currentStore && typeof this.currentStore.on === 'function') {
            this.currentStore.on('disconnect', () => this.emit('disconnect'));
            this.currentStore.on('connect', () => this.emit('connect'));
        }
    }
    
    setStore(store: any) {
        // Remove listeners from old store
        if (this.currentStore && typeof this.currentStore.removeAllListeners === 'function') {
            this.currentStore.removeAllListeners('disconnect');
            this.currentStore.removeAllListeners('connect');
        }
        
        this.currentStore = store;
        
        // Forward events from new store
        if (this.currentStore && typeof this.currentStore.on === 'function') {
            this.currentStore.on('disconnect', () => this.emit('disconnect'));
            this.currentStore.on('connect', () => this.emit('connect'));
        }
    }
    
    get(sid: string, callback: (err: any, session?: any) => void) {
        return this.currentStore.get(sid, callback);
    }
    
    set(sid: string, session: any, callback?: (err?: any) => void) {
        return this.currentStore.set(sid, session, callback);
    }
    
    destroy(sid: string, callback?: (err?: any) => void) {
        return this.currentStore.destroy(sid, callback);
    }
    
    all(callback: (err: any, sessions?: any) => void) {
        return this.currentStore.all(callback);
    }
    
    length(callback: (err: any, length?: number) => void) {
        return this.currentStore.length(callback);
    }
    
    clear(callback?: (err?: any) => void) {
        return this.currentStore.clear(callback);
    }
    
    touch(sid: string, session: any, callback?: (err?: any) => void) {
        return this.currentStore.touch(sid, session, callback);
    }
    
    generate(req: any) {
        if (this.currentStore.generate) {
            return this.currentStore.generate(req);
        }
        // Fallback: generate session ID using crypto (same as express-session default)
        return crypto.randomBytes(24).toString('base64url');
    }
    
    // Additional methods that express-session might call
    createSession(req: any, sess: any) {
        if (this.currentStore.createSession) {
            return this.currentStore.createSession(req, sess);
        }
        // Fallback: return the session as-is if createSession is not implemented
        return sess;
    }
    
    // Proxy any other method calls to the current store using a getter
    // This handles any other methods we might have missed
    getProperty(prop: string): any {
        if (prop in this) {
            return (this as any)[prop];
        }
        if (this.currentStore && typeof this.currentStore[prop] === 'function') {
            return (...args: any[]) => (this.currentStore as any)[prop](...args);
        }
        return this.currentStore?.[prop];
    }
}

// Create a Proxy wrapper that forwards all property access to the store
const createDelegatingStoreProxy = (store: DelegatingStore): any => {
    return new Proxy(store, {
        get(target, prop: string | symbol) {
            // Handle Symbol properties (like Symbol.toStringTag)
            if (typeof prop === 'symbol') {
                return (target as any)[prop];
            }
            
            // If the property exists on the DelegatingStore, return it
            if (prop in target) {
                return (target as any)[prop];
            }
            
            // Otherwise, forward to the current store
            const currentStore = (target as any).currentStore;
            if (currentStore && typeof currentStore[prop] === 'function') {
                return (...args: any[]) => currentStore[prop](...args);
            }
            return currentStore?.[prop];
        }
    });
};

const delegatingStore = createDelegatingStoreProxy(new DelegatingStore(sessionStore));

// Async function to initialize PostgreSQL session store if DATABASE_URL is available
async function initializeSessionStore() {
    if (!DATABASE_URL) {
        // Use MemoryStore only for development (with warning)
        console.log('[SESSION STORE] Using MemoryStore (no DATABASE_URL found)');
        if (isProduction) {
            console.error('[SESSION STORE] WARNING: Using MemoryStore in production! This will cause session issues!');
            console.error('[SESSION STORE] Please set DATABASE_URL environment variable!');
        }
        return;
    }

    // Use PostgreSQL session store if DATABASE_URL is available
    console.log('[SESSION STORE] Attempting to use PostgreSQL session store');
    console.log('[SESSION STORE] DATABASE_URL present:', DATABASE_URL.substring(0, 20) + '...');
    try {
        // Dynamic import to avoid TypeScript module resolution issues in Docker build
        // TypeScript may not resolve this at compile time, but it will work at runtime
        const connectPgSimple = (await import('connect-pg-simple') as any).default;
        const PgSessionStore = connectPgSimple(session);
        // Add SSL mode to connection string if not already present
        let connectionString = DATABASE_URL;
        if (connectionString && !connectionString.includes('sslmode=')) {
            const separator = connectionString.includes('?') ? '&' : '?';
            connectionString = `${connectionString}${separator}sslmode=require`;
            console.log('[SESSION STORE] Added sslmode=require to connection string');
        }
        
        const pgStore = new PgSessionStore({
            conString: connectionString,
            tableName: 'user_sessions', // Table name for sessions
            createTableIfMissing: true,
            // Add connection error handling
            errorLog: (error: Error) => {
                console.error('[SESSION STORE] PostgreSQL connection error:', error.message);
                // Don't let this crash the app
            }
        });
        
        // Add error event handlers to session store
        if (pgStore && typeof (pgStore as any).client === 'object') {
            const client = (pgStore as any).client;
            if (client && typeof client.on === 'function') {
                client.on('error', (err: Error) => {
                    console.error('[SESSION STORE] PostgreSQL client error:', err.message);
                    // Reset connection - it will retry on next operation
                });
            }
        }
        
        sessionStore = pgStore;
        delegatingStore.setStore(pgStore);
        console.log('[SESSION STORE] PostgreSQL session store initialized successfully');
    } catch (error: any) {
        console.error('[SESSION STORE] Failed to initialize PostgreSQL store:', error.message || error);
        console.log('[SESSION STORE] Falling back to MemoryStore');
        if (isProduction) {
            console.error('[SESSION STORE] WARNING: Using MemoryStore in production! Sessions will not persist!');
        }
        // Keep MemoryStore as fallback
    }
}

// Initialize session store asynchronously (non-blocking)
// The DelegatingStore will automatically use the updated store once PostgreSQL initializes
initializeSessionStore().catch((error) => {
    console.error('[SESSION STORE] Initialization error:', error.message || error);
});

const sessionConfig: session.SessionOptions = {
    store: delegatingStore as any,
    secret: SESSION_SECRET,
    resave: true, // Force save on every request for cross-origin reliability
    saveUninitialized: false,
    rolling: true, // Reset expiration on every request
    name: 'gitgalaxy.sid', // Use a custom name instead of default 'connect.sid'
    cookie: {
        secure: isProduction, // Use secure cookies in production (HTTPS required)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-origin in production, 'lax' for development
        path: '/', // Explicit path
        // Don't set domain - let browser handle it for cross-origin
    }
};

app.use(session(sessionConfig));
console.log('[SESSION] Middleware configured with', DATABASE_URL ? 'PostgreSQL store' : 'MemoryStore');

// Middleware to manually add Partitioned attribute to Set-Cookie headers (for CHIPS support)
// express-session doesn't support the partitioned option directly
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const originalEnd = res.end;
    res.end = function(chunk?: any, encoding?: any, cb?: any) {
        // Intercept Set-Cookie headers before response is sent
        const setCookieHeaders = res.getHeader('Set-Cookie');
        if (isProduction && setCookieHeaders) {
            // Handle different return types from getHeader
            let cookieArray: string[] = [];
            if (Array.isArray(setCookieHeaders)) {
                cookieArray = setCookieHeaders.filter((h): h is string => typeof h === 'string');
            } else if (typeof setCookieHeaders === 'string') {
                cookieArray = [setCookieHeaders];
            }
            
            const modifiedCookies = cookieArray.map((cookie: string) => {
                // Add Partitioned attribute if it's our session cookie and doesn't already have it
                if (cookie.includes('gitgalaxy.sid=') && !cookie.includes('Partitioned')) {
                    return cookie + '; Partitioned';
                }
                return cookie;
            });
            
            if (modifiedCookies.length > 0) {
                res.setHeader('Set-Cookie', modifiedCookies);
            }
        }
        return originalEnd.call(this, chunk, encoding, cb);
    };
    next();
});

// Middleware to log session store operations and verify store usage
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const sessionId = req.sessionID;
    const hasSession = !!req.session;
    const sessionKeys = hasSession ? Object.keys(req.session) : [];
    const cookies = req.headers.cookie || 'none';
    
    // Check what store is actually being used
    const sessionMiddleware = (req as any).sessionStore || (sessionConfig as any).store;
    const storeType = sessionStore && sessionStore !== (new session.MemoryStore()) ? 'PostgreSQL' : 'MemoryStore';
    const isUsingPgStore = DATABASE_URL && sessionStore && typeof (sessionStore as any).client !== 'undefined';
    
    console.log('[SESSION REQUEST]', req.method, req.path, {
        sessionId: sessionId,
        hasSession: hasSession,
        hasState: hasSession && 'state' in req.session ? !!req.session.state : false,
        hasAccessToken: hasSession && 'accessToken' in req.session ? !!req.session.accessToken : false,
        cookies: cookies.length > 100 ? cookies.substring(0, 100) + '...' : cookies,
        origin: req.headers.origin,
        referer: req.headers.referer,
        storeType: storeType,
        isUsingPgStore: isUsingPgStore,
        hasDatabaseUrl: !!DATABASE_URL
    });
    
    // Wrap req.session.save to log when sessions are saved
    if (hasSession && req.session.save) {
        const originalSave = req.session.save.bind(req.session);
        req.session.save = function(callback?: (err?: any) => void) {
            console.log('[SESSION SAVE] Saving session', {
                sessionId: sessionId,
                storeType: storeType,
                sessionKeys: Object.keys(req.session || {}),
                hasState: 'state' in (req.session || {}),
                hasAccessToken: 'accessToken' in (req.session || {})
            });
            return originalSave(callback);
        };
    }
    
    next();
});

// Handle unhandled PostgreSQL errors gracefully
process.on('unhandledRejection', (reason: any, promise) => {
    if (reason?.code === '57P01' || reason?.code === 'ECONNRESET' || reason?.message?.includes('terminating connection')) {
        console.error('[DATABASE] Connection terminated (unhandled rejection), but continuing...', reason.message || reason);
        // Don't crash - this might be a temporary connection issue
        return;
    }
    console.error('[UNHANDLED REJECTION]', reason);
});

// Handle uncaught exceptions (like PostgreSQL client errors)
process.on('uncaughtException', (error: Error) => {
    if (error.message?.includes('terminating connection') || (error as any).code === '57P01') {
        console.error('[DATABASE] Connection terminated (uncaught exception), but continuing...', error.message);
        // Don't crash - connection will be retried
        return;
    }
    console.error('[UNCAUGHT EXCEPTION]', error);
    // For other errors, we might want to exit gracefully
    // But for database connection errors, we'll continue
});

// Handle database connection errors in session store
if (sessionStore && typeof sessionStore.on === 'function') {
    sessionStore.on('connect', () => {
        console.log('[SESSION STORE] Connected to PostgreSQL');
    });
    sessionStore.on('error', (error: Error) => {
        console.error('[SESSION STORE] Error:', error.message);
        // Don't crash - fallback to memory-based behavior
    });
}

// Log session middleware info
app.use((req, res, next) => {
    if (req.path === '/api/auth/github' || req.path === '/api/auth/github/callback' || req.path === '/api/auth/status') {
        console.log(`[SESSION REQUEST] ${req.method} ${req.path}`, {
            sessionId: req.sessionID,
            hasSession: !!req.session,
            hasState: !!(req.session && req.session.state),
            hasAccessToken: !!(req.session && req.session.access_token),
            cookies: req.headers.cookie ? req.headers.cookie.substring(0, 50) + '...' : 'none',
            origin: req.headers.origin,
            referer: req.headers.referer
        });
    }
    next();
});

// Initialize Database (async)
initDb().catch((err) => {
    if (process.env.NODE_ENV === 'development') {
        console.error('Database initialization error:', err);
    }
});

// Initialize Gemini AI client
let genAI: GoogleGenerativeAI | null = null;
try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (apiKey) {
        genAI = new GoogleGenerativeAI(apiKey);
    }
} catch (error) {
    // AI initialization failed, continue without AI features
}

// Calculate constellation layout - distribute repos on a sphere
const calculateConstellationLayout = (repos: any[]): any[] => {
    const reposWithPos = repos.map((repo, index) => {
        // Distribute repos on the surface of a sphere
        const phi = Math.acos(-1 + (2 * index) / repos.length); // Polar angle
        const theta = Math.sqrt(repos.length * Math.PI) * phi; // Azimuthal angle
        
        const radius = 15; // Sphere radius
        const x = radius * Math.sin(phi) * Math.cos(theta);
        const y = radius * Math.sin(phi) * Math.sin(theta);
        const z = radius * Math.cos(phi);
        
        return {
            ...repo,
            pos: [x, y, z] as [number, number, number]
        };
    });
    
    return reposWithPos;
};

// A simple layout algorithm for the git graph
const calculateLayout = (commits: Map<string, { parentHashes: string[], message: string, author: string }>): RepoData => {
    const repoData: RepoData = {};
    const processedCommits = new Set<string>();
    
    // Adjacency list for children
    const children = new Map<string, string[]>();
    commits.forEach((commit, hash) => {
        commit.parentHashes.forEach(parentHash => {
            if (!children.has(parentHash)) {
                children.set(parentHash, []);
            }
            children.get(parentHash)!.push(hash);
        });
    });

    const rootHashes = Array.from(commits.keys()).filter(hash => commits.get(hash)!.parentHashes.length === 0);

    let y = 0;
    const lanes = new Map<string, number>(); // hash -> lane index
    let nextLane = 0;

    const assignLane = (hash: string): number => {
        if (lanes.has(hash)) {
            return lanes.get(hash)!;
        }
        
        const parentHashes = commits.get(hash)?.parentHashes || [];
        if (parentHashes.length > 0) {
            const parentLane = assignLane(parentHashes[0]);
            lanes.set(hash, parentLane);
            return parentLane;
        }

        const newLane = nextLane++;
        lanes.set(hash, newLane);
        return newLane;
    };


    const traverse = (hash: string, currentY: number, lane: number) => {
        if (processedCommits.has(hash)) return;
        processedCommits.add(hash);

        const x = lane * 2;
        const z = (lane % 2) * 2 - 1; 

        const commitData = commits.get(hash)!;
        repoData[hash] = {
            pos: [x, currentY, z],
            parent: commitData.parentHashes.length > 0 ? commitData.parentHashes[0] : null,
            message: commitData.message,
            author: commitData.author
        };

        const commitChildren = children.get(hash) || [];
        let childLane = lane;
        commitChildren.forEach((childHash, index) => {
            if (index > 0) {
                nextLane++;
                childLane = nextLane;
            }
             // Check for merge commit
            const childNode = commits.get(childHash)!;
            if (childNode.parentHashes.length > 1 && childNode.parentHashes[0] !== hash) {
                // It's a merge and this is not the first parent, don't create a new lane
                 traverse(childHash, currentY + 2, lanes.get(childNode.parentHashes[0])!);
            } else {
                 lanes.set(childHash, childLane);
                 traverse(childHash, currentY + 2, childLane);
            }
        });
    };

    rootHashes.forEach(rootHash => {
        lanes.set(rootHash, nextLane);
        traverse(rootHash, y, nextLane);
        nextLane++;
    });

    return repoData;
};

// GitHub OAuth Configuration
// Trim whitespace from environment variables (in case .env file has spaces)
const GITHUB_CLIENT_ID = (process.env.GITHUB_CLIENT_ID || '').trim();
const GITHUB_CLIENT_SECRET = (process.env.GITHUB_CLIENT_SECRET || '').trim();
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3001/api/auth/github/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Debug OAuth configuration
console.log('[OAUTH CONFIG]', {
    hasClientId: !!process.env.GITHUB_CLIENT_ID,
    hasClientSecret: !!process.env.GITHUB_CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    frontendUrl: FRONTEND_URL,
    isProduction
});

// Declare session type for TypeScript
declare module 'express-session' {
    interface SessionData {
        state?: string;
        access_token?: string;
        user?: any;
    }
}

// GitHub OAuth: Initiate authentication
app.get('/api/auth/github', (req: express.Request, res: express.Response) => {
    console.log('[OAUTH START] Request received', {
        sessionId: req.sessionID,
        hasExistingSession: !!req.session && Object.keys(req.session).length > 0,
        ip: req.ip,
        origin: req.headers.origin
    });
    // Debug: Log whether credentials are loaded (without exposing secrets)
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
        // GitHub OAuth not configured
        if (process.env.NODE_ENV === 'development') {
            console.error('GitHub OAuth not configured:', {
                hasClientId: !!GITHUB_CLIENT_ID,
                hasClientSecret: !!GITHUB_CLIENT_SECRET,
                clientIdLength: GITHUB_CLIENT_ID?.length || 0,
                clientSecretLength: GITHUB_CLIENT_SECRET?.length || 0
            });
        }
        return res.status(500).json({ message: 'GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env.local file.' });
    }
    
    // Generate random state string
    const state = crypto.randomBytes(32).toString('hex');
    console.log('[OAUTH START] Generated state:', state.substring(0, 8) + '...');
    
    // Set state first (before regeneration to ensure it's in the session)
    req.session.state = state;
    
    // Save session before redirecting (critical for cross-origin)
    req.session.save((err) => {
        if (err) {
            console.error('[OAUTH START] Session save error:', err);
            return res.status(500).send('Failed to initialize session');
        }
        
        console.log('[OAUTH START] Session saved successfully', {
            sessionId: req.sessionID,
            stateSet: !!req.session.state,
            stateLength: req.session.state?.length || 0,
            cookieHeader: res.getHeader('Set-Cookie') ? 'set' : 'not set'
        });
        
        // GitHub authorization URL
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo&state=${state}`;
        
        console.log('[OAUTH START] Redirecting to GitHub', {
            redirectUri: REDIRECT_URI,
            stateLength: state.length
        });
        
        res.redirect(authUrl);
    });
});

// GitHub OAuth: Handle callback
app.get('/api/auth/github/callback', async (req: express.Request, res: express.Response) => {
    const { code, state } = req.query;
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    
    console.log('[OAUTH CALLBACK] Request received', {
        sessionId: req.sessionID,
        hasCode: !!code,
        hasState: !!state,
        receivedState: state ? (state as string).substring(0, 8) + '...' : 'none',
        hasSession: !!req.session,
        sessionKeys: req.session ? Object.keys(req.session) : [],
        sessionState: req.session?.state ? (req.session.state as string).substring(0, 8) + '...' : 'none',
        cookies: req.headers.cookie ? req.headers.cookie.substring(0, 100) : 'none',
        origin: req.headers.origin,
        referer: req.headers.referer
    });
    
    // Validate state
    if (!state) {
        console.error('[OAUTH CALLBACK] Missing state in query');
        return res.redirect(`${frontendUrl}?error=missing_state`);
    }
    
    if (!req.session) {
        console.error('[OAUTH CALLBACK] No session object found', {
            sessionId: req.sessionID,
            cookies: req.headers.cookie ? 'present' : 'missing'
        });
        return res.redirect(`${frontendUrl}?error=session_expired`);
    }
    
    if (!req.session.state) {
        console.error('[OAUTH CALLBACK] Session state missing', {
            sessionId: req.sessionID,
            hasSession: !!req.session,
            sessionKeys: Object.keys(req.session),
            sessionData: JSON.stringify(req.session).substring(0, 200),
            receivedState: state,
            cookies: req.headers.cookie ? req.headers.cookie.substring(0, 100) : 'none'
        });
        return res.redirect(`${frontendUrl}?error=session_expired`);
    }
    
    if (state !== req.session.state) {
        console.error('[OAUTH CALLBACK] State mismatch', {
            received: state,
            expected: req.session.state,
            receivedLength: (state as string).length,
            expectedLength: req.session.state.length,
            receivedStart: (state as string).substring(0, 16),
            expectedStart: req.session.state.substring(0, 16),
            sessionId: req.sessionID,
            sessionKeys: Object.keys(req.session)
        });
        return res.redirect(`${frontendUrl}?error=invalid_state`);
    }
    
    console.log('[OAUTH CALLBACK] State validated successfully', {
        sessionId: req.sessionID,
        stateMatch: true
    });
    
    if (!code) {
        return res.status(400).send('Authorization code not provided');
    }
    
    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code: code,
                redirect_uri: REDIRECT_URI
            })
        });
        
        const tokenData = await tokenResponse.json() as { error?: string; error_description?: string; access_token?: string };
        
        if (tokenData.error) {
            return res.status(400).send(`GitHub OAuth error: ${tokenData.error_description || tokenData.error}`);
        }
        
        if (!tokenData.access_token) {
            return res.status(400).send('Failed to obtain access token');
        }
        
        const accessToken = tokenData.access_token;
        
        // Fetch user profile
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${accessToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        const userData = await userResponse.json();
        
        // Store in session
        req.session.access_token = accessToken;
        req.session.user = userData;
        req.session.state = undefined; // Clear state
        
        console.log('[OAUTH CALLBACK] Storing auth data in session', {
            sessionId: req.sessionID,
            hasAccessToken: !!accessToken,
            hasUser: !!userData,
            userId: userData?.login || 'unknown'
        });
        
        // Save session before redirecting (critical for cross-origin)
        req.session.save((err) => {
            if (err) {
                console.error('[OAUTH CALLBACK] Session save error after auth:', err);
                const frontendUrl = (FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
                return res.redirect(`${frontendUrl}?error=auth_failed`);
            }
            
            console.log('[OAUTH CALLBACK] Session saved successfully', {
                sessionId: req.sessionID,
                cookieHeader: res.getHeader('Set-Cookie') ? 'set' : 'not set',
                cookieValue: res.getHeader('Set-Cookie') ? String(res.getHeader('Set-Cookie')).substring(0, 100) : 'none'
            });
            
            // For cross-origin cookies, use an HTML redirect page instead of res.redirect()
            // This ensures the cookie is set before navigation
            const frontendUrl = (FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
            console.log('[OAUTH CALLBACK] Redirecting to frontend', {
                frontendUrl,
                sessionId: req.sessionID
            });
            
            // Send HTML page with immediate redirect to ensure cookie is set
            res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="refresh" content="0;url=${frontendUrl}?authenticated=true">
    <script>
        // Fallback redirect in case meta refresh doesn't work
        window.location.href = "${frontendUrl}?authenticated=true";
    </script>
</head>
<body>
    <p>Redirecting...</p>
    <a href="${frontendUrl}?authenticated=true">Click here if you are not redirected</a>
</body>
</html>
            `);
        });
    } catch (error) {
        if (process.env.NODE_ENV === 'development') {
            console.error('OAuth callback error:', error);
        }
        res.status(500).send('Failed to complete authentication');
    }
});

// Check authentication status
app.get('/api/auth/status', (req: express.Request, res: express.Response) => {
    console.log('[AUTH STATUS] Checking authentication', {
        sessionId: req.sessionID,
        hasSession: !!req.session,
        hasAccessToken: !!(req.session && req.session.access_token),
        hasUser: !!(req.session && req.session.user),
        sessionKeys: req.session ? Object.keys(req.session) : [],
        cookies: req.headers.cookie ? req.headers.cookie.substring(0, 50) + '...' : 'none',
        origin: req.headers.origin
    });
    
    if (req.session && req.session.access_token && req.session.user) {
        res.json({
            authenticated: true,
            user: req.session.user
        });
    } else {
        res.json({
            authenticated: false
        });
    }
});

// Logout
app.post('/api/auth/logout', (req: express.Request, res: express.Response) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to logout' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// Get user's repositories
app.get('/api/user/repos', async (req: express.Request, res: express.Response) => {
    if (!req.session.access_token) {
        return res.status(401).json({ message: 'Not authenticated' });
    }
    
    try {
        const reposResponse = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
            headers: {
                'Authorization': `token ${req.session.access_token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!reposResponse.ok) {
            return res.status(reposResponse.status).json({ message: 'Failed to fetch repositories' });
        }
        
        const repos = await reposResponse.json() as any[];
        const reposWithLayout = calculateConstellationLayout(repos);
        
        res.json(reposWithLayout);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch repositories' });
    }
});

// Background processing function
async function processRepoAnalysis(repoUrl: string, jobId: string, accessToken?: string) {
    updateJobStatus(jobId, 'processing');
    let tempDir: string | null = null;

    try {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-galaxy-'));
        
        // Prepare git clone command with authentication if available
        let cloneCommand = `git clone --bare ${repoUrl} .`;
        const env = { ...process.env };
        
        if (accessToken) {
            const urlWithAuth = repoUrl.replace('https://', `https://${accessToken}@`);
            cloneCommand = `git clone --bare ${urlWithAuth} .`;
        }
        
        await new Promise<void>((resolve, reject) => {
            if (!tempDir) {
                return reject(new Error('Failed to create temporary directory'));
            }
            exec(cloneCommand, { cwd: tempDir, env }, (error: any, stdout: any, stderr: any) => {
                if (error) {
                    return reject(new Error('Failed to clone repository. It may be private or the URL is incorrect.'));
                }
                resolve();
            });
        });

        const logOutput = await new Promise<string>((resolve, reject) => {
            if (!tempDir) {
                return reject(new Error('Failed to create temporary directory'));
            }
            const format = `"%H|%P|%an|%s"`;
            exec(`git log --pretty=format:${format}`, { cwd: tempDir }, (error: any, stdout: string, stderr: any) => {
                if (error) {
                    return reject(new Error('Failed to read git log from the repository.'));
                }
                resolve(stdout);
            });
        });

        const commits = new Map<string, { parentHashes: string[], message: string, author: string }>();
        logOutput.split('\n').filter(line => line.length > 0).forEach(line => {
            const [hash, parentHashesStr, author, ...messageParts] = line.split('|');
            const parentHashes = parentHashesStr ? parentHashesStr.split(' ') : [];
            const message = messageParts.join('|');
            commits.set(hash, { parentHashes, message, author: author || 'Unknown' });
        });

        if (commits.size === 0) {
            updateJobStatus(jobId, 'failed', undefined, 'This repository appears to be empty.');
            return;
        }

        const repoData = calculateLayout(commits);
        
        // Calculate authors
        const authorMap = new Map<string, number>();
        Object.values(repoData).forEach(node => {
            const count = authorMap.get(node.author) || 0;
            authorMap.set(node.author, count + 1);
        });
        const authors = Array.from(authorMap.entries()).map(([name, count]) => ({ name, commitCount: count }));

        const result = { repoData, authors };
        await storeRepo(repoUrl, result);
        updateJobStatus(jobId, 'complete', result);

    } catch (error: any) {
        updateJobStatus(jobId, 'failed', undefined, error.message || 'An internal server error occurred.');
    } finally {
        if (tempDir) {
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                // Silent cleanup failure
            }
        }
    }
}

app.post('/api/analyze', async (req: express.Request, res: express.Response) => {
    const { repoUrl } = req.body;

    if (!repoUrl || !/^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repoUrl)) {
        return res.status(400).json({ message: 'Invalid GitHub repository URL.' });
    }

    // Check database cache first
    const cached = await getRepo(repoUrl);
    if (cached) {
        return res.json(cached);
    }

    // Create background job
    const jobId = addJob(repoUrl);
    const accessToken = req.session?.access_token;
    
    // Start background processing
    processRepoAnalysis(repoUrl, jobId, accessToken).catch(() => {
        // Error already handled in processRepoAnalysis
    });

    // Return job ID immediately
    res.status(202).json({ jobId, status: 'processing' });
});

// Job status endpoint
app.get('/api/job/:id/status', (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const status = getJobStatus(id);
    
    if (!status) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(status);
});

// Repository refresh endpoint
app.post('/api/repo/refresh', async (req: express.Request, res: express.Response) => {
    const { repoUrl } = req.body;

    if (!repoUrl || !/^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repoUrl)) {
        return res.status(400).json({ message: 'Invalid GitHub repository URL.' });
    }

    // Invalidate cache and reprocess
    const jobId = addJob(repoUrl);
    const accessToken = req.session?.access_token;
    
    processRepoAnalysis(repoUrl, jobId, accessToken).catch(() => {
        // Error already handled in processRepoAnalysis
    });

    res.status(202).json({ jobId, status: 'processing' });
});


// Commit diff statistics endpoint
app.get('/api/repo/commit/:hash/diff', async (req: express.Request, res: express.Response) => {
    const { hash } = req.params;
    const { repoUrl } = req.query;

    if (!repoUrl || typeof repoUrl !== 'string') {
        return res.status(400).json({ error: 'Missing repoUrl query parameter' });
    }

    if (!/^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repoUrl)) {
        return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }

    let tempDir: string | null = null;

    try {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-galaxy-diff-'));
        const accessToken = req.session?.access_token;

        // Clone the repository
        let cloneCommand = `git clone --bare ${repoUrl} .`;
        const env = { ...process.env };

        if (accessToken) {
            const urlWithAuth = repoUrl.replace('https://', `https://${accessToken}@`);
            cloneCommand = `git clone --bare ${urlWithAuth} .`;
        }

        await new Promise<void>((resolve, reject) => {
            if (!tempDir) {
                return reject(new Error('Failed to create temporary directory'));
            }
            exec(cloneCommand, { cwd: tempDir, env }, (error: any, stdout: any, stderr: any) => {
                if (error) {
                    return reject(new Error('Failed to clone repository'));
                }
                resolve();
            });
        });

        // Get diff statistics
        const diffOutput = await new Promise<string>((resolve, reject) => {
            if (!tempDir) {
                return reject(new Error('Failed to create temporary directory'));
            }
            exec(`git show --stat ${hash}`, { cwd: tempDir }, (error: any, stdout: string, stderr: any) => {
                if (error) {
                    return reject(new Error('Failed to get commit diff'));
                }
                resolve(stdout);
            });
        });

        // Parse diff statistics
        let filesChanged = 0;
        let insertions = 0;
        let deletions = 0;

        const lines = diffOutput.split('\n');
        lines.forEach(line => {
            // Count files changed
            if (line.includes('|')) {
                filesChanged++;
                // Parse insertions/deletions from lines like " 5 files changed, 100 insertions(+), 50 deletions(-)"
                const insertMatch = line.match(/(\d+)\s*insertion/i);
                const deleteMatch = line.match(/(\d+)\s*deletion/i);
                if (insertMatch) {
                    insertions += parseInt(insertMatch[1], 10);
                }
                if (deleteMatch) {
                    deletions += parseInt(deleteMatch[1], 10);
                }
            }
        });

        // Also check the summary line
        const summaryMatch = diffOutput.match(/(\d+)\s+files? changed.*?(\d+)\s+insertion.*?(\d+)\s+deletion/i);
        if (summaryMatch) {
            filesChanged = parseInt(summaryMatch[1], 10);
            insertions = parseInt(summaryMatch[2], 10);
            deletions = parseInt(summaryMatch[3], 10);
        }

        res.json({
            filesChanged: filesChanged || 0,
            insertions: insertions || 0,
            deletions: deletions || 0
        });

    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to fetch diff statistics' });
    } finally {
        if (tempDir) {
            try {
        await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                // Silent cleanup failure
            }
        }
    }
});

// Pull Requests endpoint
app.get('/api/repo/prs', async (req: express.Request, res: express.Response) => {
    const { owner, repo } = req.query;
    
    if (!owner || !repo) {
        return res.status(400).json({ error: 'Missing owner and repo parameters' });
    }

    if (!req.session?.access_token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`, {
            headers: {
                'Authorization': `token ${req.session.access_token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API returned ${response.status}`);
        }

        const prs = await response.json() as any[];
        const formattedPRs = prs.map((pr: any) => ({
            id: pr.id,
            title: pr.title,
            state: pr.merged_at ? 'merged' : pr.state,
            headSha: pr.head.sha,
            baseSha: pr.base.sha
        }));

        res.json(formattedPRs);
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to fetch pull requests' });
    }
});

// AI Summarization endpoint
app.post('/api/ai/summarize-commit', async (req: express.Request, res: express.Response) => {
    if (!genAI) {
        return res.status(503).json({ error: 'AI service is not configured. Please set GEMINI_API_KEY in your environment variables.' });
    }

    const { repoUrl, commitHash, commitMessage } = req.body;

    if (!repoUrl || !commitHash || !commitMessage) {
        return res.status(400).json({ error: 'Missing required fields: repoUrl, commitHash, commitMessage' });
    }

    let tempDir: string | null = null;

    try {
        // Create temporary directory for git clone
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-galaxy-ai-'));

        // Clone the repository
        const cloneUrl = repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`;
        let cloneCommand = `git clone --bare ${cloneUrl} .`;
        const env = { ...process.env };
        
        const accessToken = req.session?.access_token;
        if (accessToken) {
            const urlWithAuth = cloneUrl.replace('https://', `https://${accessToken}@`);
            cloneCommand = `git clone --bare ${urlWithAuth} .`;
        }

        await new Promise<void>((resolve, reject) => {
            if (!tempDir) {
                return reject(new Error('Failed to create temporary directory'));
            }
            exec(cloneCommand, { cwd: tempDir, env, timeout: 60000 }, (error: any, stdout: any, stderr: any) => {
                if (error) {
                    reject(new Error(`Failed to clone repository: ${stderr || error.message}`));
                } else {
                    resolve();
                }
            });
        });

        // Get the full diff of the commit
        const diffOutput = await new Promise<string>((resolve, reject) => {
            if (!tempDir) {
                return reject(new Error('Failed to create temporary directory'));
            }
            exec(`git show "${commitHash}"`, { cwd: tempDir, timeout: 30000 }, (error: any, stdout: string, stderr: any) => {
                if (error) {
                    reject(new Error(`Failed to get commit diff: ${stderr || error.message}`));
                } else {
                    resolve(stdout);
                }
            });
        });

        // Create prompt for Gemini
        const prompt = `Analyze this Git commit and provide a clear, high-level summary of the changes.

Commit Message: ${commitMessage}

Full Diff:
\`\`\`
${diffOutput}
\`\`\`

Please provide:
1. A brief summary (1-2 sentences) of what this commit does
2. The main changes made (3-5 bullet points)
3. Any important technical details or context

Format your response in a clear, professional manner suitable for a code review summary.`;

        // Call Gemini API
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const summary = response.text();

        res.json({ summary });

    } catch (error: any) {
        res.status(500).json({ 
            error: 'Failed to generate AI summary', 
            message: error.message || 'Unknown error' 
        });
    } finally {
        // Clean up temporary directory
        if (tempDir) {
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.error('Failed to clean up temp directory:', cleanupError);
            }
        }
    }
});

// Serve static files from the React app build directory (only in production)
const buildPath = path.join(__dirname, '../../../dist');

// Check if build directory exists (only serve static files in production)
// Use an async IIFE to check if the directory exists
(async () => {
  try {
    await fs.access(buildPath);
    // Build directory exists, serve static files
app.use(express.static(buildPath));

    // The "catchall" handler - send all non-API requests to React app
app.get('*', (req: express.Request, res: express.Response) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});
    if (process.env.NODE_ENV === 'development') {
      console.log('Serving static files from:', buildPath);
    }
  } catch (error) {
    // Build directory doesn't exist (development mode)
    if (process.env.NODE_ENV === 'development') {
      console.log('Frontend build directory not found. Running in API-only mode.');
      console.log('Frontend should be served via Vite dev server on http://localhost:5173');
    }
  }
})();

app.listen(PORT, () => {
  if (process.env.NODE_ENV === 'development') {
  console.log(`Server is listening on port ${PORT}`);
  }
});
