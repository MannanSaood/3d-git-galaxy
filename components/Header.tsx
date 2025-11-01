import React, { useState } from 'react';
import type { User } from '../types';

interface HeaderProps {
  authState: 'loading' | 'authenticated' | 'unauthenticated';
  user: User | null;
  onLogout: () => void;
  onSearchRepo?: (repoUrl: string) => void;
}

const Header: React.FC<HeaderProps> = ({ authState, user, onLogout, onSearchRepo }) => {
  const [searchUrl, setSearchUrl] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      if (response.ok) {
        onLogout();
      }
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchUrl.trim() || !onSearchRepo) return;
    
    setIsSearching(true);
    try {
      await onSearchRepo(searchUrl.trim());
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
      setSearchUrl('');
    }
  };

  return (
    <div className="absolute top-0 left-0 right-0 z-50 p-3 sm:p-4 md:p-6 lg:p-8 pointer-events-none">
      {/* Top row: Title and Avatar */}
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <div className="flex-shrink-0">
          <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-mono text-cyan-300/80 tracking-widest">3D Git Galaxy</h1>
          {authState === 'unauthenticated' && (
            <p className="text-xs sm:text-sm md:text-base font-mono text-white/60 mt-1 sm:mt-2 hidden sm:block">Visualize a public Git repository</p>
          )}
        </div>
        
        {/* Avatar in top-right corner */}
        {authState === 'authenticated' && user && (
          <div className="relative pointer-events-auto">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center focus:outline-none"
              aria-label="User menu"
            >
              <img
                src={user.avatar_url}
                alt={user.login}
                className="w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full border-2 border-cyan-300/50 hover:border-cyan-300 transition-colors cursor-pointer flex-shrink-0"
              />
            </button>
            
            {showDropdown && (
              <>
                {/* Backdrop to close dropdown on click outside */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowDropdown(false)}
                />
                {/* Dropdown menu */}
                <div className="absolute top-12 right-0 z-50 bg-black/90 backdrop-blur-sm border border-cyan-300/30 rounded-lg shadow-lg shadow-cyan-500/20 min-w-[180px] overflow-hidden animate-fade-in">
                  <div className="p-3 border-b border-cyan-300/20">
                    <div className="flex items-center gap-2">
                      <img
                        src={user.avatar_url}
                        alt={user.login}
                        className="w-8 h-8 rounded-full border border-cyan-300/50"
                      />
                      <span className="text-white/90 font-mono text-sm truncate">{user.login}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      handleLogout();
                    }}
                    className="w-full px-4 py-3 bg-red-500/80 hover:bg-red-500 text-white font-mono font-bold transition-colors text-sm text-left"
                  >
                    Logout
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      
      {/* Bottom row: Search and Login */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 md:gap-4 pointer-events-auto w-full sm:w-auto">
          {/* Search input for repo URL */}
          {(authState === 'authenticated' || authState === 'unauthenticated') && onSearchRepo && (
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                value={searchUrl}
                onChange={(e) => setSearchUrl(e.target.value)}
                placeholder="Search GitHub repo URL..."
                className="px-2 sm:px-3 py-1.5 sm:py-2 bg-black/50 border border-white/20 rounded text-white/90 font-mono text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-shadow flex-1 sm:w-48 md:w-64"
                disabled={isSearching}
              />
              <button
                type="submit"
                disabled={isSearching || !searchUrl.trim()}
                className="px-3 sm:px-4 py-1.5 sm:py-2 bg-cyan-500/80 hover:bg-cyan-500 disabled:bg-cyan-500/40 disabled:cursor-not-allowed text-black font-mono font-bold rounded transition-colors text-xs sm:text-sm whitespace-nowrap"
              >
                {isSearching ? '...' : 'Search'}
              </button>
            </form>
          )}
          {authState === 'loading' && (
            <div className="w-6 h-6 sm:w-8 sm:h-8 border-2 border-cyan-300/50 border-t-cyan-300 rounded-full animate-spin self-center" />
          )}
          
          {authState === 'unauthenticated' && (
            <a
              href="/api/auth/github"
              className="px-3 sm:px-4 py-1.5 sm:py-2 bg-cyan-500/80 hover:bg-cyan-500 text-black font-mono font-bold rounded transition-colors text-xs sm:text-sm text-center"
            >
              Login with GitHub
            </a>
          )}
      </div>
    </div>
  );
};

export default Header;

