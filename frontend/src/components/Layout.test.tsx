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
  useNotifications: vi.fn(() => ({
    notify: {
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
    },
  })),
}));

vi.mock('../hooks/useStories', () => ({
  useHealth: vi.fn(() => ({
    data: { checks: { database: { status: 'healthy' }, redis: { status: 'healthy' }, vault: { status: 'healthy' } } },
  })),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    isLoading: false,
    isAdmin: false,
    isPending: false,
    isApproved: true,
    user: { id: 'test-user', email: 'test@test.com', role: 'user', status: 'approved' },
  })),
}));

vi.mock('./ChatEntryButton', () => ({
  ChatEntryButton: vi.fn(() => null),
}));

vi.mock('../store/chatStore', () => ({
  useChatStore: Object.assign(
    vi.fn(() => ({
      open: vi.fn(),
      isOpen: false,
      storyId: null,
    })),
    {
      getState: vi.fn(() => ({
        open: vi.fn(),
      })),
    }
  ),
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
    const buttons = screen.getAllByRole('button');
    buttons[0].click();
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });

  it('renders a menu button', () => {
    render(<Header onMenuClick={onMenuClick} />);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(1);
  });
});
