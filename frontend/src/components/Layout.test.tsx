import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Layout';

// Mock the stores and hooks
vi.mock('../store/uiStore', () => ({
  useUIStore: vi.fn(() => ({
    sidebarOpen: true,
    toggleSidebar: vi.fn(),
    setCurrentStory: vi.fn(),
  })),
}));

vi.mock('../hooks/useStories', () => ({
  useHealth: vi.fn(() => ({
    data: { checks: { database: { status: 'healthy' }, redis: { status: 'healthy' }, vault: { status: 'healthy' } } },
  })),
}));

describe('Header', () => {
  const onMenuClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the app title', () => {
    render(<Header onMenuClick={onMenuClick} />);
    expect(screen.getByText('AI Video FTE')).toBeDefined();
  });

  it('calls onMenuClick when menu button is clicked', () => {
    render(<Header onMenuClick={onMenuClick} />);
    const menuButton = screen.getByRole('button');
    menuButton.click();
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('renders a menu button', () => {
    render(<Header onMenuClick={onMenuClick} />);
    expect(screen.getByRole('button')).toBeDefined();
  });
});
