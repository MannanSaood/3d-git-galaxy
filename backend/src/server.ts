
import express from 'express';
import cors from 'cors';
import path from 'path';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import type { RepoData, CommitNode } from './types';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

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


app.post('/api/analyze', async (req: express.Request, res: express.Response) => {
    const { repoUrl } = req.body;

    if (!repoUrl || !/^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repoUrl)) {
        return res.status(400).json({ message: 'Invalid GitHub repository URL.' });
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-galaxy-'));

    try {
        await new Promise((resolve, reject) => {
            exec(`git clone --bare ${repoUrl} .`, { cwd: tempDir }, (error, stdout, stderr) => {
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
