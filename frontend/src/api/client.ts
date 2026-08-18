import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, PaginatedResponse, StateChangeEvent } from '../types/api';

// Use ?? to allow empty string (means relative URLs through Vite proxy)
const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });

    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        // Add auth token if available
        const token = localStorage.getItem('auth_token');
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // ============================================
  // Stories
  // ============================================
  async createStory(data: { brief: any; userId: string }): Promise<ApiResponse<{ storyId: string; shotPlan: any[] }>> {
    const response = await this.client.post<ApiResponse<{ storyId: string; shotPlan: any[] }>>('/api/stories', data);
    return response.data;
  }

  async getStory(storyId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/stories/${storyId}`);
    return response.data;
  }

  async presentShotPlan(storyId: string): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(`/api/stories/${storyId}/present`);
    return response.data;
  }

  async approveShotPlan(storyId: string, userId: string): Promise<ApiResponse<{ success: boolean; status: string }>> {
    const response = await this.client.post<ApiResponse<{ success: boolean; status: string }>>(`/api/stories/${storyId}/approve`, { userId });
    return response.data;
  }

  async reviseShotPlan(storyId: string, revisions: any[]): Promise<ApiResponse<{ shots: any[] }>> {
    const response = await this.client.patch<ApiResponse<{ shots: any[] }>>(`/api/stories/${storyId}/plan`, { revisions });
    return response.data;
  }

  async cancelStory(storyId: string, userId: string, option: string): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(`/api/stories/${storyId}/cancel`, { userId, option });
    return response.data;
  }

  async listStories(params?: { page?: number; pageSize?: number; status?: string }): Promise<ApiResponse<PaginatedResponse<any>>> {
    const response = await this.client.get<ApiResponse<PaginatedResponse<any>>>('/api/stories', { params });
    return response.data;
  }

  // ============================================
  // Characters
  // ============================================
  async uploadCharacter(data: { storyId: string; userId: string; character: any }): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(`/api/stories/${data.storyId}/characters`, {
      userId: data.userId,
      character: data.character,
    });
    return response.data;
  }

  async getCharacters(storyId: string): Promise<ApiResponse<{ characters: any[] }>> {
    const response = await this.client.get<ApiResponse<{ characters: any[] }>>(`/api/stories/${storyId}/characters`);
    return response.data;
  }

  async getCharacter(storyId: string, name: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/stories/${storyId}/characters/${name}`);
    return response.data;
  }

  async deleteCharacter(storyId: string, characterId: string): Promise<ApiResponse<any>> {
    const response = await this.client.delete<ApiResponse<any>>(`/api/stories/${storyId}/characters/${characterId}`);
    return response.data;
  }

  // ============================================
  // Models & Router
  // ============================================
  async getModels(): Promise<ApiResponse<any[]>> {
    const response = await this.client.get<ApiResponse<any[]>>('/api/router/models');
    return response.data;
  }

  async getModelEligibility(shotId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/router/models/eligibility`, { params: { shot: shotId } });
    return response.data;
  }

  async getUserModelPriority(userId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/users/${userId}/model-priority`);
    return response.data;
  }

  async updateUserModelPriority(userId: string, priorityList: string[], useSystemDefault: boolean): Promise<ApiResponse<any>> {
    const response = await this.client.patch<ApiResponse<any>>(`/api/users/${userId}/model-priority`, { priorityList, useSystemDefault });
    return response.data;
  }

  // ============================================
  // Admission & Generation
  // ============================================
  async getShotAdmissionStatus(shotId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/shots/${shotId}/admission-status`);
    return response.data;
  }

  async getStoryAdmissionPipeline(storyId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/stories/${storyId}/admission-pipeline`);
    return response.data;
  }

  async getShotGenerationStatus(shotId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/shots/${shotId}/generation-status`);
    return response.data;
  }

  async regenerateShot(shotId: string, userId: string, options?: any): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(`/api/shots/${shotId}/regenerate`, { userId, ...options });
    return response.data;
  }

  // ============================================
  // Face-Lock
  // ============================================
  async getFaceLockResults(shotId: string): Promise<ApiResponse<any[]>> {
    const response = await this.client.get<ApiResponse<any[]>>(`/api/shots/${shotId}/face-lock-results`);
    return response.data;
  }

  async getCharacterConsistencyReport(characterId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/characters/${characterId}/consistency-report`);
    return response.data;
  }

  // ============================================
  // Merge & Delivery
  // ============================================
  async approveMerge(storyId: string): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(`/api/stories/${storyId}/approve-merge`);
    return response.data;
  }

  async mergeStory(storyId: string, options?: { resolution?: string; transition?: any }): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(`/api/merger/merge`, { storyId, ...options });
    return response.data;
  }

  async partialRegenerate(data: { storyId: string; shotIds: string[]; userId: string; options?: any }): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>(`/api/merger/partial-regenerate`, data);
    return response.data;
  }

  async getDelivery(storyId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/stories/${storyId}/delivery`);
    return response.data;
  }

  async getDownloadUrl(storyId: string): Promise<ApiResponse<{ signedUrl: string; expiresAt: string }>> {
    const response = await this.client.get<ApiResponse<{ signedUrl: string; expiresAt: string }>>(`/api/stories/${storyId}/download`);
    return response.data;
  }

  // ============================================
  // Cost & Budget
  // ============================================
  async getCostBreakdown(storyId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/stories/${storyId}/cost-breakdown`);
    return response.data;
  }

  async getCostAttribution(storyId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/stories/${storyId}/cost-attribution`);
    return response.data;
  }

  async getUserBudget(userId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/users/${userId}/budget`);
    return response.data;
  }

  // ============================================
  // Audit & Health
  // ============================================
  async getAuditLogs(params?: { storyId?: string; userId?: string; page?: number; pageSize?: number }): Promise<ApiResponse<PaginatedResponse<any>>> {
    const response = await this.client.get<ApiResponse<PaginatedResponse<any>>>('/api/audit-logs', { params });
    return response.data;
  }

  async getHealth(): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>('/health');
    return response.data;
  }

  async getServiceHealth(service: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/health/${service}`);
    return response.data;
  }

  async getStoryStateHistory(storyId: string): Promise<ApiResponse<any[]>> {
    const response = await this.client.get<ApiResponse<any[]>>(`/api/stories/${storyId}/state-history`);
    return response.data;
  }

  // ============================================
  // Settings
  // ============================================
  async getUserSettings(userId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/users/${userId}/settings`);
    return response.data;
  }

  async updateUserSettings(userId: string, settings: any): Promise<ApiResponse<any>> {
    const response = await this.client.patch<ApiResponse<any>>(`/api/users/${userId}/settings`, settings);
    return response.data;
  }

  async getProjectSettings(projectId: string): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>(`/api/projects/${projectId}/settings`);
    return response.data;
  }

  async updateProjectSettings(projectId: string, settings: any): Promise<ApiResponse<any>> {
    const response = await this.client.patch<ApiResponse<any>>(`/api/projects/${projectId}/settings`, settings);
    return response.data;
  }

  // ============================================
  // Sacred Guard
  // ============================================
  async getSacredGuardThresholds(): Promise<ApiResponse<any>> {
    const response = await this.client.get<ApiResponse<any>>('/api/sacred-guard/thresholds');
    return response.data;
  }

  async updateSacredGuardThresholds(thresholds: any): Promise<ApiResponse<any>> {
    const response = await this.client.patch<ApiResponse<any>>('/api/sacred-guard/thresholds', thresholds);
    return response.data;
  }

  async submitSacredGuardAppeal(data: any): Promise<ApiResponse<any>> {
    const response = await this.client.post<ApiResponse<any>>('/api/sacred-guard/appeals', data);
    return response.data;
  }

  // ============================================
  // SSE Stream
  // ============================================
  createEventSource(storyId: string, onMessage: (event: StateChangeEvent) => void, onError?: (error: Event) => void): EventSource {
    // Use relative URL so it goes through Vite proxy (which adds CORS headers)
    const url = `/api/stories/${storyId}/stream`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('Failed to parse SSE message:', e);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      if (onError) onError(error);
      // Auto-reconnect handled by browser
    };

    return eventSource;
  }

  // ============================================
  // Auth
  // ============================================
  async login(email: string, password: string): Promise<ApiResponse<{ token: string; user: { id: string; email: string; role: string; status: string; accessExpiresAt: string | null }; pending?: boolean; expired?: boolean; revoked?: boolean }>> {
    const response = await this.client.post<ApiResponse<{ token: string; user: { id: string; email: string; role: string; status: string; accessExpiresAt: string | null }; pending?: boolean; expired?: boolean; revoked?: boolean }>>('/auth/login', { email, password });
    return response.data;
  }

  async register(email: string, password: string): Promise<ApiResponse<{ token: string; user: { id: string; email: string; role: string; status: string; accessExpiresAt: string | null } }>> {
    const response = await this.client.post<ApiResponse<{ token: string; user: { id: string; email: string; role: string; status: string; accessExpiresAt: string | null } }>>('/auth/register', { email, password });
    return response.data;
  }

  async getMe(): Promise<ApiResponse<{ id: string; email: string; role: string; status: string; accessExpiresAt: string | null }>> {
    const response = await this.client.get<ApiResponse<{ id: string; email: string; role: string; status: string; accessExpiresAt: string | null }>>('/auth/me');
    return response.data;
  }

  async forgotPassword(email: string): Promise<ApiResponse<{ message: string }>> {
    const response = await this.client.post<ApiResponse<{ message: string }>>('/auth/forgot-password', { email });
    return response.data;
  }

  async resetPassword(token: string, password: string): Promise<ApiResponse<{ message: string }>> {
    const response = await this.client.post<ApiResponse<{ message: string }>>('/auth/reset-password', { token, password });
    return response.data;
  }

  // ============================================
  // Admin
  // ============================================
  async listUsers(status?: string): Promise<ApiResponse<{ users: any[] }>> {
    const params = status ? { status } : {};
    const response = await this.client.get<ApiResponse<{ users: any[] }>>('/admin/users', { params });
    return response.data;
  }

  async approveUser(userId: string, durationHours: number): Promise<ApiResponse<{ success: boolean; message: string }>> {
    const response = await this.client.post<ApiResponse<{ success: boolean; message: string }>>(`/admin/approve/${userId}`, { durationHours });
    return response.data;
  }

  async rejectUser(userId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    const response = await this.client.post<ApiResponse<{ success: boolean; message: string }>>(`/admin/reject/${userId}`);
    return response.data;
  }

  async revokeUser(userId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    const response = await this.client.post<ApiResponse<{ success: boolean; message: string }>>(`/admin/revoke/${userId}`);
    return response.data;
  }

  async extendUser(userId: string, durationHours: number): Promise<ApiResponse<{ success: boolean; message: string }>> {
    const response = await this.client.post<ApiResponse<{ success: boolean; message: string }>>(`/admin/extend/${userId}`, { durationHours });
    return response.data;
  }

  async deleteUser(userId: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    const response = await this.client.delete<ApiResponse<{ success: boolean; message: string }>>(`/admin/users/${userId}`);
    return response.data;
  }

  async getAuditLog(limit?: number, offset?: number): Promise<ApiResponse<{ auditLog: any[] }>> {
    const params: Record<string, number> = {};
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const response = await this.client.get<ApiResponse<{ auditLog: any[] }>>('/admin/audit', { params });
    return response.data;
  }

  // ============================================
  // Prompt Review
  // ============================================
  async getPromptReview(storyId: string): Promise<ApiResponse<{ prompt: string; warnings: string[]; sanitized: boolean }>> {
    const response = await this.client.post<ApiResponse<{ prompt: string; warnings: string[]; sanitized: boolean }>>(`/api/stories/${storyId}/prompt-review`);
    return response.data;
  }

  async approvePrompt(storyId: string, prompt: string): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.post<ApiResponse<{ success: boolean }>>(`/api/stories/${storyId}/prompt-approve`, { prompt });
    return response.data;
  }

  // ============================================
  // Feedback
  // ============================================
  async submitFeedback(storyId: string, data: { rating: number; comment?: string; flagReason?: string }): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.post<ApiResponse<{ success: boolean }>>(`/api/stories/${storyId}/feedback`, data);
    return response.data;
  }

  // ============================================
  // Preferences
  // ============================================
  async getUserPreferences(userId: string): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.get<ApiResponse<Record<string, unknown>>>(`/api/users/${userId}/preferences`);
    return response.data;
  }

  async updateUserPreferences(userId: string, preferences: Record<string, unknown>): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.put<ApiResponse<{ success: boolean }>>(`/api/users/${userId}/preferences`, preferences);
    return response.data;
  }

  async resetUserPreferences(userId: string): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.delete<ApiResponse<{ success: boolean }>>(`/api/users/${userId}/preferences`);
    return response.data;
  }
}

export const apiClient = new ApiClient();
export default apiClient;