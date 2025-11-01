import React from 'react';

const Loader: React.FC = () => {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm z-50 p-4">
      <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-cyan-300/50 border-t-cyan-300 rounded-full animate-spin"></div>
      <p className="mt-3 sm:mt-4 text-white/80 font-mono tracking-widest text-sm sm:text-base">Analyzing Repository...</p>
      <p className="mt-2 text-white/50 font-mono text-xs sm:text-sm text-center">This may take a moment for large repos.</p>
    </div>
  );
};

const keyframes = `
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin {
  animation: spin 1s linear infinite;
}
`;

const style = document.createElement('style');
style.innerHTML = keyframes;
document.head.appendChild(style);


export default Loader;