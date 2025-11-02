// API configuration for development and production
const getApiBaseUrl = (): string => {
  // In production (Vercel), use the Render backend URL
  // In development, use relative path (Vite proxy will handle it)
  // Check if we're in production mode
  const isProduction = typeof window !== 'undefined' && window.location.hostname !== 'localhost';
  
  if (isProduction) {
    // Production: Use Render backend URL
    return 'https://threed-git-galaxy.onrender.com';
  }
  // Development: Use relative path (Vite proxy handles it)
  return '';
};

export const API_BASE_URL = getApiBaseUrl();

