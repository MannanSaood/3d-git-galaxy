import React, { useState, useEffect } from 'react';
import type { CommitNode, DiffStat } from '../types';
import { API_BASE_URL } from '../config';

interface CommitInfoPanelProps {
  commit: { hash: string, node: CommitNode } | null;
  onClose: () => void;
  repoUrl?: string;
}

const CommitInfoPanel: React.FC<CommitInfoPanelProps> = ({ commit, onClose, repoUrl }) => {
  const [diffStat, setDiffStat] = useState<DiffStat | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (commit && repoUrl) {
      setLoadingDiff(true);
      fetch(`${API_BASE_URL}/api/repo/commit/${commit.hash}/diff?repoUrl=${encodeURIComponent(repoUrl)}`)
        .then(res => res.json())
        .then(data => {
          setDiffStat(data);
          setLoadingDiff(false);
        })
        .catch(() => {
          setLoadingDiff(false);
        });
    } else {
      setDiffStat(null);
    }
  }, [commit, repoUrl]);

  const handleSummarize = async () => {
    if (!commit || !repoUrl || isSummarizing) return;
    
    setIsSummarizing(true);
    setSummaryError(null);
    setSummary(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/summarize-commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          repoUrl,
          commitHash: commit.hash,
          commitMessage: commit.node.message,
        }),
      });
      
      if (!response.ok) {
        // Try to parse error response, but handle cases where it's not JSON
        let errorMessage = 'Failed to generate summary';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          // If response is not JSON (like 404 HTML), use status text
          errorMessage = response.status === 404 
            ? 'AI service endpoint not found. Make sure the backend server is running on port 3001.'
            : `Server returned ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      setSummary(data.summary);
    } catch (error: any) {
      setSummaryError(error.message || 'Failed to generate AI summary. Make sure GEMINI_API_KEY is configured.');
    } finally {
      setIsSummarizing(false);
    }
  };

  if (!commit) {
    return null;
  }

  return (
    <div className="absolute top-24 sm:top-28 md:top-32 left-3 right-3 sm:left-auto sm:right-4 sm:w-72 md:w-80 lg:w-96 max-w-[calc(100vw-1.5rem)] sm:max-w-none bg-black/70 backdrop-blur-sm border border-cyan-300/20 rounded-lg p-3 sm:p-4 text-white font-mono shadow-lg shadow-cyan-500/10 transition-opacity duration-300 animate-fade-in z-60">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-xs sm:text-sm text-cyan-300/80 uppercase tracking-widest">Commit Details</h2>
          <p className="text-xs sm:text-sm text-yellow-300 break-all mt-1 font-mono">
            {commit.hash}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white transition-colors text-xl sm:text-2xl leading-none flex-shrink-0 ml-2"
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>
      
      {/* Author */}
      {commit.node.author && (
        <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/10">
          <p className="text-xs sm:text-sm text-white/70 uppercase tracking-wider mb-1">Author</p>
          <p className="text-xs sm:text-sm text-cyan-300/90">{commit.node.author}</p>
        </div>
      )}
      
      {/* Commit Message */}
      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/10">
        <p className="text-xs sm:text-sm text-white/70 uppercase tracking-wider mb-1">Message</p>
        <p className="text-xs sm:text-sm text-white/90 break-words">{commit.node.message}</p>
      </div>
      
      {/* Diff Statistics */}
      {diffStat && (
        <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/10">
          <p className="text-xs sm:text-sm text-white/70 uppercase tracking-wider mb-2">Changes</p>
          <div className="flex flex-wrap gap-3 sm:gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs sm:text-sm text-green-400">{diffStat.filesChanged}</span>
              <span className="text-xs text-white/60">files</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs sm:text-sm text-green-400">+{diffStat.insertions}</span>
              <span className="text-xs text-white/60">insertions</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs sm:text-sm text-red-400">-{diffStat.deletions}</span>
              <span className="text-xs text-white/60">deletions</span>
            </div>
          </div>
        </div>
      )}
      
      {loadingDiff && (
        <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/10">
          <p className="text-xs text-white/50">Loading diff statistics...</p>
        </div>
      )}

      {/* AI Summary Section */}
      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/10">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs sm:text-sm text-white/70 uppercase tracking-wider">AI Summary</p>
          {!summary && !isSummarizing && (
            <button
              onClick={handleSummarize}
              disabled={!repoUrl || isSummarizing}
              className="px-2 py-1 text-xs bg-cyan-500/80 hover:bg-cyan-500 disabled:bg-cyan-500/40 disabled:cursor-not-allowed text-black font-mono font-bold rounded transition-colors"
            >
              Summarize with AI
            </button>
          )}
        </div>
        
        {isSummarizing && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <div className="w-4 h-4 border-2 border-cyan-300/50 border-t-cyan-300 rounded-full animate-spin" />
            <span>Generating summary...</span>
          </div>
        )}
        
        {summaryError && (
          <p className="text-xs text-red-400 mt-2">{summaryError}</p>
        )}
        
        {summary && (
          <div className="mt-2 p-2 bg-black/40 rounded border border-cyan-300/20 max-h-32 sm:max-h-40 overflow-y-auto">
            <p className="text-xs sm:text-sm text-white/90 whitespace-pre-wrap">{summary}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Simple fade-in animation for tailwind
const keyframes = `
@keyframes fade-in {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
  animation: fade-in 0.3s ease-out forwards;
}
`;

const style = document.createElement('style');
style.innerHTML = keyframes;
document.head.appendChild(style);


export default CommitInfoPanel;
