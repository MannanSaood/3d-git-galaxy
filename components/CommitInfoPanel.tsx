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
    <div className="absolute top-16 sm:top-20 md:top-24 left-3 right-3 sm:left-4 sm:right-auto sm:w-72 md:w-80 lg:w-96 max-w-[calc(100vw-1.5rem)] sm:max-w-none bg-black/70 backdrop-blur-sm border border-cyan-300/20 rounded-lg p-3 sm:p-4 text-white font-mono shadow-lg shadow-cyan-500/10 transition-opacity duration-300 animate-fade-in z-60">
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
      <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-white/10">
        <p className="text-xs sm:text-sm text-white/90 break-words">{commit.node.message}</p>
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
