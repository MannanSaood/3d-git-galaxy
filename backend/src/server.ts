
import express from 'express';
import cors from 'cors';
import path from 'path';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import type { RepoData, CommitNode } from './types';
import { fileURLToPath } from 'url';
import session from 'express-session';
import crypto from 'crypto';
import dotenv from 'dotenv';

const app = express();
const PORT = process.env.PORT || 3001;

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

// Configure CORS to allow credentials
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// Configure session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

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
const calculateLayout = (commits: Map<string, { parentHashes: string[], message: string }>): RepoData => {
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
            message: commitData.message
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
    // Debug: Log whether credentials are loaded (without exposing secrets)
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
        console.error('GitHub OAuth not configured:', {
            hasClientId: !!GITHUB_CLIENT_ID,
            hasClientSecret: !!GITHUB_CLIENT_SECRET,
            clientIdLength: GITHUB_CLIENT_ID?.length || 0,
            clientSecretLength: GITHUB_CLIENT_SECRET?.length || 0
        });
        return res.status(500).json({ message: 'GitHub OAuth is not configured. Please set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env.local file.' });
    }
    
    // Generate random state string
    const state = crypto.randomBytes(32).toString('hex');
    req.session.state = state;
    
    // GitHub authorization URL
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo&state=${state}`;
    
    res.redirect(authUrl);
});

// GitHub OAuth: Handle callback
app.get('/api/auth/github/callback', async (req: express.Request, res: express.Response) => {
    const { code, state } = req.query;
    
    // Validate state
    if (!state || state !== req.session.state) {
        return res.status(400).send('Invalid state parameter');
    }
    
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
        
        // Redirect to frontend
        res.redirect(FRONTEND_URL);
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send('Failed to complete authentication');
    }
});

// Check authentication status
app.get('/api/auth/status', (req: express.Request, res: express.Response) => {
    if (req.session.access_token && req.session.user) {
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
        console.error('Error fetching repos:', error);
        res.status(500).json({ message: 'Failed to fetch repositories' });
    }
});

app.post('/api/analyze', async (req: express.Request, res: express.Response) => {
    const { repoUrl } = req.body;

    if (!repoUrl || !/^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repoUrl)) {
        return res.status(400).json({ message: 'Invalid GitHub repository URL.' });
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-galaxy-'));

    try {
        // Check if user is authenticated
        const accessToken = req.session?.access_token;
        
        // Prepare git clone command with authentication if available
        let cloneCommand = `git clone --bare ${repoUrl} .`;
        const env = { ...process.env };
        
        if (accessToken) {
            // For authenticated users, modify the URL to include the token
            const urlWithAuth = repoUrl.replace('https://', `https://${accessToken}@`);
            cloneCommand = `git clone --bare ${urlWithAuth} .`;
        }
        
        await new Promise((resolve, reject) => {
            exec(cloneCommand, { cwd: tempDir, env }, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Clone error: ${stderr}`);
                    return reject(new Error('Failed to clone repository. It may be private or the URL is incorrect.'));
                }
                resolve(stdout);
            });
        });

        const logOutput = await new Promise<string>((resolve, reject) => {
            // Using a simple format: hash|parent_hashes|message
            const format = `"%H|%P|%s"`;
            exec(`git log --pretty=format:${format}`, { cwd: tempDir }, (error, stdout, stderr) => {
                if (error) {
                     console.error(`Log error: ${stderr}`);
                    return reject(new Error('Failed to read git log from the repository.'));
                }
                resolve(stdout);
            });
        });

        const commits = new Map<string, { parentHashes: string[], message: string }>();
        logOutput.split('\n').filter(line => line.length > 0).forEach(line => {
            const [hash, parentHashesStr, message] = line.split('|');
            const parentHashes = parentHashesStr ? parentHashesStr.split(' ') : [];
            commits.set(hash, { parentHashes, message });
        });

        if (commits.size === 0) {
             return res.status(400).json({ message: 'This repository appears to be empty.' });
        }

        const repoData = calculateLayout(commits);
        res.json(repoData);

    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'An internal server error occurred.' });
    } finally {
        // Cleanup the temporary directory
        await fs.rm(tempDir, { recursive: true, force: true });
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
    console.log('Serving static files from:', buildPath);
  } catch (error) {
    // Build directory doesn't exist (development mode)
    console.log('Frontend build directory not found. Running in API-only mode.');
    console.log('Frontend should be served via Vite dev server on http://localhost:5173');
  }
})();


app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
