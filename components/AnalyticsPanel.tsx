import React from 'react';
import type { Author } from '../types';

interface AnalyticsPanelProps {
  authors: Author[];
  commitCount: number;
  filteredAuthor: string | null;
  timelineCommitLimit: number | null;
  onAuthorFilterChange: (author: string | null) => void;
  onTimelineChange: (limit: number | null) => void;
}

const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
  authors,
  commitCount,
  filteredAuthor,
  timelineCommitLimit,
  onAuthorFilterChange,
  onTimelineChange
}) => {
  return (
    <div className="absolute bottom-24 sm:bottom-28 left-3 sm:left-4 bg-black/70 backdrop-blur-sm border border-cyan-300/20 rounded-lg p-3 sm:p-4 text-white font-mono shadow-lg shadow-cyan-500/10 z-50 max-w-[280px] sm:max-w-sm">
      <h3 className="text-xs sm:text-sm text-cyan-300/80 uppercase tracking-widest mb-3">Analytics</h3>
      
      {/* Author Filter */}
      <div className="mb-4">
        <label className="block text-xs text-white/70 mb-2">Filter by Author</label>
        <select
          value={filteredAuthor || ''}
          onChange={(e) => onAuthorFilterChange(e.target.value || null)}
          className="w-full px-2 py-1.5 bg-black/50 border border-white/20 rounded text-white/90 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          <option value="">All Authors</option>
          {authors.map((author) => (
            <option key={author.name} value={author.name}>
              {author.name} ({author.commitCount})
            </option>
          ))}
        </select>
      </div>
      
      {/* Timeline Scrubber */}
      <div className="mb-3">
        <label className="block text-xs text-white/70 mb-2">
          Timeline: {timelineCommitLimit !== null ? `${timelineCommitLimit} commits` : 'All commits'}
        </label>
        <input
          type="range"
          min="0"
          max={commitCount}
          value={timelineCommitLimit !== null ? timelineCommitLimit : commitCount}
          onChange={(e) => {
            const value = parseInt(e.target.value, 10);
            onTimelineChange(value === commitCount ? null : value);
          }}
          className="w-full h-2 bg-black/50 rounded-lg appearance-none cursor-pointer accent-cyan-400"
        />
        <div className="flex justify-between text-xs text-white/50 mt-1">
          <span>Start</span>
          <span>{commitCount}</span>
        </div>
      </div>
      
      {/* Stats */}
      <div className="pt-3 border-t border-white/10">
        <div className="text-xs text-white/60">
          <p>Total Authors: {authors.length}</p>
          <p>Total Commits: {commitCount}</p>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPanel;

