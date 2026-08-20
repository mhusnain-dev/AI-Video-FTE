import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  streaming?: boolean;
  action?: ChatAction;
}

export interface ChatAction {
  type: 'update_shot_prompt' | 'update_shot_camera' | 'update_shot_duration' | 'update_shot_transition';
  shotId: string;
  field: string;
  before: string;
  after: string;
  status: 'proposed' | 'applied' | 'dismissed';
}

export interface ChatSummary {
  timestamp: string;
  summary: string;
  actions: ChatAction[];
}

export type LLMProvider = 'gemini' | 'nvidia';

interface ChatState {
  isOpen: boolean;
  storyId: string | null;
  messages: ChatMessage[];
  summaries: ChatSummary[];
  streaming: boolean;
  streamBuffer: string;
  pendingAction: ChatAction | null;
  temperature: number;
  selectedModel: LLMProvider;
  readOnly: boolean;

  open: (storyId: string, readOnly?: boolean) => void;
  close: () => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  appendStreamToken: (token: string) => void;
  commitStream: () => void;
  setPendingAction: (action: ChatAction | null) => void;
  applyAction: (shotId: string) => void;
  dismissAction: () => void;
  addSummary: (summary: ChatSummary) => void;
  setSummaries: (summaries: ChatSummary[]) => void;
  setTemperature: (temp: number) => void;
  setSelectedModel: (model: LLMProvider) => void;
  setReadOnly: (readOnly: boolean) => void;
  clearStory: (storyId: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      storyId: null,
      messages: [],
      summaries: [],
      streaming: false,
      streamBuffer: '',
      pendingAction: null,
      temperature: 0.3,
      selectedModel: 'gemini',
      readOnly: false,

      open: (storyId: string, readOnly = false) => {
        set({
          isOpen: true,
          storyId,
          messages: [],
          summaries: [],
          streaming: false,
          streamBuffer: '',
          pendingAction: null,
          readOnly,
        });
      },

      close: () => {
        set({
          isOpen: false,
          storyId: null,
          messages: [],
          summaries: [],
          streaming: false,
          streamBuffer: '',
          pendingAction: null,
          readOnly: false,
        });
      },

      addMessage: (msg: ChatMessage) => {
        set(state => ({
          messages: [...state.messages, msg],
        }));
      },

      updateLastMessage: (content: string) => {
        set(state => {
          if (state.messages.length === 0) return state;
          const newMessages = [...state.messages];
          newMessages[newMessages.length - 1] = {
            ...newMessages[newMessages.length - 1],
            content,
          };
          return { messages: newMessages };
        });
      },

      appendStreamToken: (token: string) => {
        set(state => ({
          streamBuffer: state.streamBuffer + token,
          streaming: true,
        }));
      },

      commitStream: () => {
        set(state => {
          if (state.streamBuffer === '') return state;
          const newMessages = [...state.messages];
          if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
            newMessages[newMessages.length - 1] = {
              ...newMessages[newMessages.length - 1],
              content: newMessages[newMessages.length - 1].content + state.streamBuffer,
              streaming: false,
            };
          } else {
            newMessages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: state.streamBuffer,
              timestamp: new Date().toISOString(),
              streaming: false,
            });
          }
          return {
            messages: newMessages,
            streamBuffer: '',
            streaming: false,
          };
        });
      },

      setPendingAction: (action: ChatAction | null) => {
        set({ pendingAction: action });
      },

      applyAction: (shotId: string) => {
        set(state => ({
          pendingAction: state.pendingAction ? { ...state.pendingAction, status: 'applied' as const, shotId } : null,
        }));
      },

      dismissAction: () => {
        set({ pendingAction: null });
      },

      addSummary: (summary: ChatSummary) => {
        set(state => ({
          summaries: [...state.summaries, summary],
        }));
      },

      setSummaries: (summaries: ChatSummary[]) => {
        set({ summaries });
      },

      setTemperature: (temp: number) => {
        set({ temperature: temp });
      },

      setSelectedModel: (model: LLMProvider) => {
        set({ selectedModel: model });
      },

      setReadOnly: (readOnly: boolean) => {
        set({ readOnly });
      },

      clearStory: (storyId: string) => {
        const state = get();
        if (state.storyId === storyId) {
          set({
            isOpen: false,
            storyId: null,
            messages: [],
            summaries: [],
            streaming: false,
            streamBuffer: '',
            pendingAction: null,
            readOnly: false,
          });
        }
      },
    }),
    {
      name: 'chat-store',
      partialize: (state) => ({
        temperature: state.temperature,
        selectedModel: state.selectedModel,
      }),
    }
  )
);