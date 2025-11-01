import React, { useState } from 'react';
import GitGalaxyCanvas from './components/GitGalaxyCanvas';
import CommitInfoPanel from './components/CommitInfoPanel';
import RepoInputForm from './components/RepoInputForm';
import Loader from './components/Loader';
import type { CommitNode, RepoData } from './types';

const App: React.FC = () => {
  const [selectedCommit, setSelectedCommit] = useState<{ hash: string, node: CommitNode } | null>(null);
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyzeRepo = async (repoUrl: string) => {
    setIsLoading(true);
    setError(null);
    setRepoData(null);
    setSelectedCommit(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repoUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to analyze repository');
      }

      const data: RepoData = await response.json();
      setRepoData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative w-screen h-screen bg-black overflow-hidden">
      {repoData && <GitGalaxyCanvas repoData={repoData} onCommitSelect={setSelectedCommit} selectedCommit={selectedCommit} />}
      
      <div className="absolute top-0 left-0 p-4 md:p-8 pointer-events-none">
        <h1 className="text-2xl md:text-4xl font-mono text-cyan-300/80 tracking-widest">3D Git Galaxy</h1>
        {!repoData && <p className="text-sm md:text-base font-mono text-white/60 mt-2">Visualize a public Git repository</p>}
      </div>

      {!repoData && !isLoading && <RepoInputForm onAnalyze={handleAnalyzeRepo} error={error} />}
      {isLoading && <Loader />}
      
      {repoData && <CommitInfoPanel commit={selectedCommit} onClose={() => setSelectedCommit(null)} />}
      
      {repoData && (
        <div className="absolute bottom-0 right-0 p-4 md:p-8 pointer-events-none text-right">
           <p className="text-xs md:text-sm font-mono text-white/40">Click a node to inspect</p>
           <p className="text-xs md:text-sm font-mono text-white/40">Drag to rotate | Scroll to zoom</p>
        </div>
      )}
    </main>
  );
};

export default App;