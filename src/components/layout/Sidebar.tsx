import React from 'react';
import { PageId } from '../../types/trading';
import {
  TrendingUp,
  Cpu,
  BarChart3,
  FlaskConical,
  Bot,
  History,
  User,
  Settings,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  Zap,
} from 'lucide-react';

interface SidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  onResetBalance: () => void;
  tradingMode: 'demo' | 'real';
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  onResetBalance,
}) => {
  // Navigation items matching binarypro.site/dashboard/trade specification exactly
  const menuItems: { id: PageId; label: string; icon: React.ElementType }[] = [
    { id: 'trade', label: 'Trade', icon: TrendingUp },
    { id: 'analysis', label: 'Market Analysis', icon: BarChart3 },
    { id: 'builder', label: 'Strategy Builder', icon: Cpu },
    { id: 'bots', label: 'Trading Bots', icon: Bot },
    { id: 'backtesting', label: 'Backtesting', icon: FlaskConical },
    { id: 'history', label: 'Trade History', icon: History },
    { id: 'account', label: 'Account', icon: User },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'help', label: 'Help & Risk', icon: ShieldCheck },
  ];

  const handleItemClick = (page: PageId) => {
    onNavigate(page);
    onCloseMobile();
  };

  const isCurrentActive = (itemId: PageId) => {
    if (itemId === 'trade' && (currentPage === 'trade' || currentPage === 'dashboard')) {
      return true;
    }
    return currentPage === itemId;
  };

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between">
      {/* Navigation Links */}
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
          {!isCollapsed && <span>Trading Terminal</span>}
          {/* Mobile close button */}
          <button
            onClick={onCloseMobile}
            className="lg:hidden text-slate-400 hover:text-slate-100 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = isCurrentActive(item.id);
          return (
            <button
              key={item.id}
              onClick={() => handleItemClick(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </div>

      {/* Bottom Controls */}
      <div className="p-3 border-t border-slate-800/80 space-y-2">
        {!isCollapsed && (
          <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold text-slate-300">Practice Demo</span>
              <button
                onClick={onResetBalance}
                title="Reset simulated funds to $10,000"
                className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors font-mono"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset $10k</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 leading-tight">
              Test strategies risk-free with live Deriv synthetic ticks.
            </p>
          </div>
        )}

        {/* Desktop collapse toggle */}
        <button
          onClick={onToggleCollapse}
          className="hidden lg:flex w-full items-center justify-center gap-2 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-lg transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse Menu</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block bg-[#090D16] border-r border-slate-800/80 transition-all duration-200 shrink-0 ${
          isCollapsed ? 'w-16' : 'w-56'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <div className="fixed inset-y-0 left-0 w-60 bg-[#090D16] border-r border-slate-800 z-50">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
