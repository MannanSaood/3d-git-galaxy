import React, { useState } from 'react';

interface RepoInputFormProps {
  onAnalyze: (repoUrl: string) => void;
  error: string | null;
}

const RepoInputForm: React.FC<RepoInputFormProps> = ({ onAnalyze, error }) => {
  const [repoUrl, setRepoUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAnalyze(repoUrl);
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <form onSubmit={handleSubmit} className="bg-black/30 backdrop-blur-sm border border-cyan-300/20 p-8 rounded-lg shadow-lg shadow-cyan-500/10">
          <label htmlFor="repoUrl" className="block text-white/80 font-mono text-lg mb-2">
            Enter Public GitHub Repo URL
          </label>
          <input
            id="repoUrl"
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="e.g., https://github.com/facebook/react"
            className="w-full bg-black/50 border border-white/20 rounded p-3 text-white/90 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-shadow"
          />
          <button
            type="submit"
            className="w-full mt-4 bg-cyan-500/80 hover:bg-cyan-500 text-black font-mono font-bold py-3 rounded transition-colors"
          >
            Analyze Repository
          </button>
           {error && (
            <p className="mt-4 text-center text-red-400/90 font-mono text-sm bg-red-500/10 border border-red-500/20 p-3 rounded">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
};

export default RepoInputForm;