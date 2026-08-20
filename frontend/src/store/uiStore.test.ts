import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

// Reset the store between tests
beforeEach(() => {
  useUIStore.setState({
    sidebarOpen: true,
    theme: 'system',
    notifications: [],
    currentStoryId: null,
    currentShotId: null,
    modals: {},
    draftStory: null,
    draftShot: null,
  });
});

describe('uiStore', () => {
  it('has correct initial state', () => {
    const state = useUIStore.getState();
    expect(state.sidebarOpen).toBe(true);
    expect(state.theme).toBe('system');
    expect(state.notifications).toEqual([]);
    expect(state.currentStoryId).toBeNull();
    expect(state.modals).toEqual({});
  });

  it('toggles sidebar', () => {
    const { toggleSidebar } = useUIStore.getState();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
    toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  it('sets theme', () => {
    const { setTheme } = useUIStore.getState();
    setTheme('dark');
    expect(useUIStore.getState().theme).toBe('dark');
  });

  it('manages modals', () => {
    const { openModal, closeModal, closeAllModals } = useUIStore.getState();
    openModal('test-modal');
    expect(useUIStore.getState().modals['test-modal']).toBe(true);
    closeModal('test-modal');
    expect(useUIStore.getState().modals['test-modal']).toBeUndefined();
    openModal('modal-1');
    openModal('modal-2');
    closeAllModals();
    expect(useUIStore.getState().modals).toEqual({});
  });

  it('adds and removes notifications', () => {
    const { addNotification, removeNotification } = useUIStore.getState();
    const id = addNotification({ type: 'success', title: 'Test' });
    expect(useUIStore.getState().notifications.length).toBe(1);
    expect(useUIStore.getState().notifications[0].title).toBe('Test');
    removeNotification(id);
    expect(useUIStore.getState().notifications.length).toBe(0);
  });
});
