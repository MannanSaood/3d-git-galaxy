import React, { useState, useEffect } from 'react';
import GitGalaxyCanvas from './components/GitGalaxyCanvas';
import CommitInfoPanel from './components/CommitInfoPanel';
import RepoInputForm from './components/RepoInputForm';
import Loader from './components/Loader';
import Header from './components/Header';
import ConstellationCanvas from './components/ConstellationCanvas';
import AnalyticsPanel from './components/AnalyticsPanel';
import type { CommitNode, RepoData, User, ConstellationRepo, Author } from './types';

const App: React.FC = () => {
  const [selectedCommit, setSelectedCommit] = useState<{ hash: string, node: CommitNode } | null>(null);
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentRepoUrl, setCurrentRepoUrl] = useState<string | null>(null);
  
  // New state for authentication and constellation view
  const [view, setView] = useState<'constellation' | 'detail'>('constellation');
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [userRepos, setUserRepos] = useState<ConstellationRepo[]>([]);
  
  // Phase 6: Analytics state
  const [authors, setAuthors] = useState<Author[]>([]);
  const [filteredAuthor, setFilteredAuthor] = useState<string | null>(null);
  const [timelineCommitLimit, setTimelineCommitLimit] = useState<number | null>(null);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const response = await fetch('/api/auth/status', {
          credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.authenticated && data.user) {
          setAuthState('authenticated');
          setUser(data.user);
          
          // Fetch user's repositories
          try {
            const reposResponse = await fetch('/api/user/repos', {
              credentials: 'include'
            });
            
            if (reposResponse.ok) {
              const repos = await reposResponse.json();
              setUserRepos(repos);
            }
          } catch (err) {
            console.error('Failed to fetch repositories:', err);
          }
        } else {
          setAuthState('unauthenticated');
        }
      } catch (err) {
        console.error('Failed to check auth status:', err);
        setAuthState('unauthenticated');
      }
    };
    
    checkAuthStatus();
  }, []);

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
        credentials: 'include',
        body: JSON.stringify({ repoUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to analyze repository');
      }

      const responseData = await response.json();
      
      // Phase 8: Check if we got a job ID (202 response)
      if (response.status === 202 && responseData.jobId) {
        // Poll for job status
        const pollInterval = setInterval(async () => {
          try {
            const statusResponse = await fetch(`/api/job/${responseData.jobId}/status`, {
              credentials: 'include'
            });
            
            if (!statusResponse.ok) {
              clearInterval(pollInterval);
              setIsLoading(false);
              setError('Failed to check job status');
              return;
            }
            
            const status = await statusResponse.json();
            
            if (status.status === 'complete') {
              clearInterval(pollInterval);
              const data = status.result;
              setRepoData(data.repoData || data);
              setAuthors(data.authors || []);
              setCurrentRepoUrl(repoUrl);
              setFilteredAuthor(null);
              setTimelineCommitLimit(null);
              setView('detail');
              setIsLoading(false);
            } else if (status.status === 'failed') {
              clearInterval(pollInterval);
              setIsLoading(false);
              setError(status.error || 'Analysis failed');
            }
            // Continue polling if status is 'pending' or 'processing'
          } catch (err) {
            clearInterval(pollInterval);
            setIsLoading(false);
            setError('Failed to poll job status');
          }
        }, 1000); // Poll every second
        
        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          if (isLoading) {
            setIsLoading(false);
            setError('Analysis timed out');
          }
        }, 5 * 60 * 1000);
      } else {
        // Immediate response (cached data)
        setRepoData(responseData.repoData || responseData);
        setAuthors(responseData.authors || []);
        setCurrentRepoUrl(repoUrl);
        setFilteredAuthor(null);
        setTimelineCommitLimit(null);
        setView('detail');
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setIsLoading(false);
    }
  };

  const handleRepoSelect = (repo: ConstellationRepo) => {
    handleAnalyzeRepo(repo.clone_url);
  };

  const handleLogout = () => {
    setAuthState('unauthenticated');
    setUser(null);
    setUserRepos([]);
    setView('constellation');
    setRepoData(null);
    setSelectedCommit(null);
  };

  return (
    <main className="relative w-screen h-screen bg-black overflow-hidden">
      <Header 
        authState={authState} 
        user={user} 
        onLogout={handleLogout}
        onSearchRepo={handleAnalyzeRepo}
      />

      {authState === 'loading' && (
        <Loader />
      )}

      {authState === 'unauthenticated' && (
        <>
          {!repoData && !isLoading && (
            <RepoInputForm onAnalyze={handleAnalyzeRepo} error={error} />
          )}
          {isLoading && <Loader />}
          {repoData && view === 'detail' && (
            <>
              <GitGalaxyCanvas 
                repoData={repoData} 
                onCommitSelect={setSelectedCommit} 
                selectedCommit={selectedCommit}
                filteredAuthor={filteredAuthor}
                timelineCommitLimit={timelineCommitLimit}
              />
              <CommitInfoPanel 
                commit={selectedCommit} 
                onClose={() => setSelectedCommit(null)}
                repoUrl={currentRepoUrl || undefined}
              />
              {repoData && authors.length > 0 && (
                <AnalyticsPanel
                  authors={authors}
                  commitCount={Object.keys(repoData).length}
                  filteredAuthor={filteredAuthor}
                  timelineCommitLimit={timelineCommitLimit}
                  onAuthorFilterChange={setFilteredAuthor}
                  onTimelineChange={setTimelineCommitLimit}
                />
              )}
              <button
                onClick={() => {
                  setView('constellation');
                  setRepoData(null);
                  setSelectedCommit(null);
                }}
                className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 px-3 sm:px-4 py-1.5 sm:py-2 bg-cyan-500/80 hover:bg-cyan-500 text-black font-mono font-bold rounded transition-colors z-50 text-xs sm:text-sm"
              >
                Back to Repository List
              </button>
            </>
          )}
        </>
      )}

      {authState === 'authenticated' && (
        <>
          {view === 'constellation' && userRepos.length > 0 && (
            <>
              <ConstellationCanvas 
                repos={userRepos} 
                onRepoSelect={handleRepoSelect}
              />
              <div className="absolute bottom-0 right-0 p-3 sm:p-4 md:p-6 lg:p-8 pointer-events-none text-right">
                <p className="text-xs sm:text-sm font-mono text-white/40">Tap a repository to analyze</p>
                <p className="text-xs sm:text-sm font-mono text-white/40 hidden sm:block">Hover to see repository names</p>
                <p className="text-xs sm:text-sm font-mono text-white/40">Pinch to zoom | Drag to rotate</p>
              </div>
            </>
          )}
          
          {view === 'detail' && repoData && (
            <>
              <GitGalaxyCanvas 
                repoData={repoData} 
                onCommitSelect={setSelectedCommit} 
                selectedCommit={selectedCommit}
                filteredAuthor={filteredAuthor}
                timelineCommitLimit={timelineCommitLimit}
              />
              <CommitInfoPanel 
                commit={selectedCommit} 
                onClose={() => setSelectedCommit(null)}
                repoUrl={currentRepoUrl || undefined}
              />
              {repoData && authors.length > 0 && (
                <AnalyticsPanel
                  authors={authors}
                  commitCount={Object.keys(repoData).length}
                  filteredAuthor={filteredAuthor}
                  timelineCommitLimit={timelineCommitLimit}
                  onAuthorFilterChange={setFilteredAuthor}
                  onTimelineChange={setTimelineCommitLimit}
                />
              )}
              <button
                onClick={() => {
                  setView('constellation');
                  setRepoData(null);
                  setSelectedCommit(null);
                }}
                className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 px-3 sm:px-4 py-1.5 sm:py-2 bg-cyan-500/80 hover:bg-cyan-500 text-black font-mono font-bold rounded transition-colors z-50 text-xs sm:text-sm"
              >
                Back to Constellation
              </button>
              <div className="absolute bottom-0 right-0 p-3 sm:p-4 md:p-6 lg:p-8 pointer-events-none text-right">
                <p className="text-xs sm:text-sm font-mono text-white/40">Tap a node to inspect</p>
                <p className="text-xs sm:text-sm font-mono text-white/40 hidden sm:block">Drag to rotate | Scroll to zoom</p>
                <p className="text-xs sm:text-sm font-mono text-white/40 sm:hidden">Drag to rotate | Pinch to zoom</p>
              </div>
            </>
          )}
          
          {isLoading && <Loader />}
        </>
      )}
    </main>
  );
};

export default App;