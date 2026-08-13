import { useState } from 'react';
import {
  Bars3Icon,
  XMarkIcon,
  HomeIcon,
  Cog6ToothIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { useUIStore } from '../store/uiStore';
import { useHealth } from '../hooks/useStories';
import { clsx } from 'clsx';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: HomeIcon },
  { path: '/stories/new', label: 'New Story', icon: PlusIcon },
  { path: '/settings', label: 'Settings', icon: Cog6ToothIcon },
] as const;

function PlusIcon({ className = '' }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { sidebarOpen, setCurrentStory } = useUIStore();
  const { data: health } = useHealth();

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out flex flex-col',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎬</span>
            <span className="font-bold text-gray-900">AI Video FTE</span>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-2 text-gray-400 hover:text-gray-600"
            aria-label="Close sidebar"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.path}
              href={item.path}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                window.location.pathname === item.path
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {item.label}
            </a>
          ))}
        </nav>

        {/* Health Status */}
        <div className="p-4 border-t border-gray-200">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">System Health</h3>
          <div className="space-y-2">
            {[
              { key: 'database', label: 'Database', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /></svg> },
              { key: 'redis', label: 'Redis', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" /></svg> },
              { key: 'vault', label: 'Vault', icon: ShieldCheckIcon },
            ].map(({ key, label, icon }) => {
              const check = health?.checks?.[key];
              const status = check?.status || 'unknown';
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <span className={clsx('w-2 h-2 rounded-full', status === 'healthy' ? 'bg-green-500' : status === 'degraded' ? 'bg-yellow-500' : 'bg-gray-400')} />
                  <span className="flex-1">{label}</span>
                  <span className={clsx('text-xs font-medium capitalize', status === 'healthy' ? 'text-green-600' : status === 'degraded' ? 'text-yellow-600' : 'text-gray-500')}>
                    {status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30 lg:hidden">
      <div className="flex items-center justify-between h-16 px-4">
        <button onClick={onMenuClick} className="p-2 text-gray-500 hover:text-gray-700">
          <Bars3Icon className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xl">🎬</span>
          <h1 className="text-lg font-bold text-gray-900">AI Video FTE</h1>
        </div>
        <div className="w-10" />
      </div>
    </header>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar isOpen={mobileSidebarOpen} onClose={() => setMobileSidebarOpen(false)} />
      <Header onMenuClick={() => setMobileSidebarOpen(true)} />
      <div className="lg:pl-64">
        <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      </div>
    </div>
  );
}

export default AppLayout;