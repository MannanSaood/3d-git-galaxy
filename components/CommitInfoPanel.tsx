import React from 'react';
import type { CommitNode } from '../types';

interface CommitInfoPanelProps {
  commit: { hash: string, node: CommitNode } | null;
  onClose: () => void;
}

const CommitInfoPanel: React.FC<CommitInfoPanelProps> = ({ commit, onClose }) => {
  if (!commit) {
    return null;
  }

  return (
    <div className="absolute top-4 right-4 md:top-8 md:right-8 w-80 max-w-[calc(100vw-2rem)] bg-black/50 backdrop-blur-sm border border-cyan-300/20 rounded-lg p-4 text-white font-mono shadow-lg shadow-cyan-500/10 transition-opacity duration-300 animate-fade-in">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xs text-cyan-300/80 uppercase tracking-widest">Commit Details</h2>
          <p className="text-sm text-yellow-300 break-words mt-1">
            {commit.hash}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-white/50 hover:text-white transition-colors text-2xl leading-none"
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>
      <div className="mt-4 pt-4 border-t border-white/10">
        <p className="text-sm text-white/90">{commit.node.message}</p>
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
