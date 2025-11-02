
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
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initDb, getRepo, storeRepo } from './database.js';
import { addJob, getJobStatus, updateJobStatus } from './jobQueue.js';

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

// Configure CORS to allow credentials and Vercel frontend
const FRONTEND_URL_FOR_CORS = process.env.FRONTEND_URL || 'http://localhost:5173';
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

// Initialize Database
initDb();

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
        if (process.env.NODE_ENV === 'development') {
            console.error('OAuth callback error:', error);
        }
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
        storeRepo(repoUrl, result);
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
    const cached = getRepo(repoUrl);
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
