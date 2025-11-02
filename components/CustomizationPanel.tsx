import React from 'react';
import type { Settings, Theme } from '../types';

interface CustomizationPanelProps {
  settings: Settings;
  onSettingsChange: (newSettings: Settings) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const CustomizationPanel: React.FC<CustomizationPanelProps> = ({
  settings,
  onSettingsChange,
  isOpen,
  onToggle
}) => {
  const handleThemeChange = (theme: Theme) => {
    onSettingsChange({ ...settings, theme });
  };

  const handleBloomStrengthChange = (value: number) => {
    onSettingsChange({ ...settings, bloomStrength: value });
  };

  const handleAutoRotateSpeedChange = (value: number) => {
    onSettingsChange({ ...settings, autoRotateSpeed: value });
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-14 left-4 z-50 p-3 bg-cyan-500/80 hover:bg-cyan-500 text-black font-mono font-bold rounded transition-colors shadow-lg pointer-events-auto"
        aria-label="Open customization panel"
      >
        ⚙️
      </button>
    );
  }

  return (
    <div className="fixed bottom-14 left-4 z-50 w-72 md:w-80 bg-black/90 backdrop-blur-sm border border-cyan-300/30 rounded-lg p-4 shadow-lg shadow-cyan-500/20 animate-fade-in pointer-events-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm md:text-base text-cyan-300/80 uppercase tracking-widest font-mono">
          Customization
        </h3>
        <button
          onClick={onToggle}
          className="text-white/50 hover:text-white transition-colors text-xl leading-none"
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      {/* Theme Selection */}
      <div className="mb-4">
        <label className="block text-xs text-white/70 uppercase tracking-wider mb-2 font-mono">
          Theme
        </label>
        <select
          value={settings.theme}
          onChange={(e) => handleThemeChange(e.target.value as Theme)}
          className="w-full px-2 py-1.5 bg-black/50 border border-white/20 rounded text-white/90 font-mono text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          <option value="cyberpunk">Cyberpunk</option>
          <option value="forest">Forest</option>
          <option value="solarized">Solarized</option>
        </select>
      </div>

      {/* Bloom Strength */}
      <div className="mb-4">
        <label className="block text-xs text-white/70 uppercase tracking-wider mb-2 font-mono">
          Bloom Strength: {settings.bloomStrength.toFixed(1)}
        </label>
        <input
          type="range"
          min="0.5"
          max="3.0"
          step="0.1"
          value={settings.bloomStrength}
          onChange={(e) => handleBloomStrengthChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-black/50 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />
        <div className="flex justify-between text-xs text-white/50 mt-1">
          <span>0.5</span>
          <span>3.0</span>
        </div>
      </div>

      {/* Auto Rotate Speed */}
      <div className="mb-4">
        <label className="block text-xs text-white/70 uppercase tracking-wider mb-2 font-mono">
          Rotation Speed: {settings.autoRotateSpeed.toFixed(1)}
        </label>
        <input
          type="range"
          min="0.0"
          max="2.0"
          step="0.1"
          value={settings.autoRotateSpeed}
          onChange={(e) => handleAutoRotateSpeedChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-black/50 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />
        <div className="flex justify-between text-xs text-white/50 mt-1">
          <span>0.0</span>
          <span>2.0</span>
        </div>
      </div>
    </div>
  );
};

export default CustomizationPanel;

