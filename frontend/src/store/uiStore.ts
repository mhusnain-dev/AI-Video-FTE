import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Story, Shot, CharacterReference } from '../types/api';

interface UIState {
  // Global UI state
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';
  notifications: Notification[];

  // Current context
  currentStoryId: string | null;
  currentShotId: string | null;

  // Modal state
  modals: Record<string, boolean>;

  // Form drafts (auto-save)
  draftStory: Partial<Story> | null;
  draftShot: Partial<Shot> | null;

  // Actions
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => string;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  setCurrentStory: (storyId: string | null) => void;
  setCurrentShot: (shotId: string | null) => void;
  openModal: (modalId: string) => void;
  closeModal: (modalId: string) => void;
  closeAllModals: () => void;
  setDraftStory: (draft: Partial<Story> | null) => void;
  setDraftShot: (draft: Partial<Shot> | null) => void;
}

interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
  timestamp: number;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Initial state
      sidebarOpen: true,
      theme: 'system',
      notifications: [],
      currentStoryId: null,
      currentShotId: null,
      modals: {},
      draftStory: null,
      draftShot: null,

      // Actions
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setTheme: (theme) => set({ theme }),

      addNotification: (notification) => {
        const id = crypto.randomUUID();
        const newNotification: Notification = {
          ...notification,
          id,
          timestamp: Date.now(),
        };
        set((state) => ({
          notifications: [...state.notifications, newNotification],
        }));

        // Auto-remove after duration (default 5s)
        const duration = notification.duration ?? 5000;
        setTimeout(() => {
          get().removeNotification(id);
        }, duration);

        return id;
      },

      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      clearNotifications: () => set({ notifications: [] }),

      setCurrentStory: (storyId) => set({ currentStoryId: storyId }),
      setCurrentShot: (shotId) => set({ currentShotId: shotId }),

      openModal: (modalId) =>
        set((state) => ({
          modals: { ...state.modals, [modalId]: true },
        })),

      closeModal: (modalId) =>
        set((state) => {
          const { [modalId]: _, ...rest } = state.modals;
          return { modals: rest };
        }),

      closeAllModals: () => set({ modals: {} }),

      setDraftStory: (draft) => set({ draftStory: draft }),
      setDraftShot: (draft) => set({ draftShot: draft }),
    }),
    {
      name: 'ai-video-fte-ui',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        theme: state.theme,
        draftStory: state.draftStory,
        draftShot: state.draftShot,
      }),
    }
  )
);

// ============================================
// Helper hook for notifications
// ============================================
export function useNotifications() {
  const { notifications, addNotification, removeNotification, clearNotifications } = useUIStore();

  const notify = {
    success: (title: string, message?: string) => addNotification({ type: 'success', title, message }),
    error: (title: string, message?: string) => addNotification({ type: 'error', title, message, duration: 8000 }),
    warning: (title: string, message?: string) => addNotification({ type: 'warning', title, message }),
    info: (title: string, message?: string) => addNotification({ type: 'info', title, message }),
    custom: (notification: Omit<Notification, 'id' | 'timestamp'>) => addNotification(notification),
  };

  return { notifications, notify, removeNotification, clearNotifications };
}

// ============================================
// Helper hook for modals
// ============================================
export function useModal(modalId: string) {
  const { modals, openModal, closeModal } = useUIStore();
  const isOpen = modals[modalId] ?? false;
  return { isOpen, open: () => openModal(modalId), close: () => closeModal(modalId) };
}