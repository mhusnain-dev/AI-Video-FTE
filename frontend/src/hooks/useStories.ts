import { useQuery, useMutation, useQueryClient, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import apiClient from '../api/client';
import type { CreateStoryRequest, ShotPlanRevision } from '../types/api';

// ============================================
// Query Keys
// ============================================
export const storyKeys = {
  all: ['stories'] as const,
  lists: () => [...storyKeys.all, 'list'] as const,
  list: (params: any) => [...storyKeys.lists(), params] as const,
  detail: (id: string) => [...storyKeys.all, 'detail', id] as const,
  admissionPipeline: (id: string) => [...storyKeys.detail(id), 'admission-pipeline'] as const,
  costBreakdown: (id: string) => [...storyKeys.detail(id), 'cost-breakdown'] as const,
  stateHistory: (id: string) => [...storyKeys.detail(id), 'state-history'] as const,
};

export const characterKeys = {
  all: ['characters'] as const,
  list: (storyId: string) => [...characterKeys.all, 'list', storyId] as const,
  detail: (storyId: string, name: string) => [...characterKeys.all, 'detail', storyId, name] as const,
  consistencyReport: (characterId: string) => [...characterKeys.all, 'consistency', characterId] as const,
};

export const shotKeys = {
  all: ['shots'] as const,
  detail: (id: string) => [...shotKeys.all, 'detail', id] as const,
  admissionStatus: (id: string) => [...shotKeys.detail(id), 'admission'] as const,
  generationStatus: (id: string) => [...shotKeys.detail(id), 'generation'] as const,
  faceLockResults: (id: string) => [...shotKeys.detail(id), 'face-lock'] as const,
};

export const modelKeys = {
  all: ['models'] as const,
  list: () => [...modelKeys.all, 'list'] as const,
  eligibility: (shotId: string) => [...modelKeys.all, 'eligibility', shotId] as const,
  userPriority: (userId: string) => [...modelKeys.all, 'user-priority', userId] as const,
};

export const deliveryKeys = {
  all: ['delivery'] as const,
  detail: (storyId: string) => [...deliveryKeys.all, 'detail', storyId] as const,
};

export const costKeys = {
  all: ['cost'] as const,
  breakdown: (storyId: string) => [...costKeys.all, 'breakdown', storyId] as const,
  attribution: (storyId: string) => [...costKeys.all, 'attribution', storyId] as const,
  userBudget: (userId: string) => [...costKeys.all, 'user-budget', userId] as const,
};

export const auditKeys = {
  all: ['audit'] as const,
  logs: (params: any) => [...auditKeys.all, 'logs', params] as const,
};

export const healthKeys = {
  all: ['health'] as const,
  overall: () => [...healthKeys.all, 'overall', 'v2'] as const,
  service: (service: string) => [...healthKeys.all, 'service', service] as const,
};

export const settingsKeys = {
  all: ['settings'] as const,
  user: (userId: string) => [...settingsKeys.all, 'user', userId] as const,
  project: (projectId: string) => [...settingsKeys.all, 'project', projectId] as const,
};

export const sacredGuardKeys = {
  all: ['sacred-guard'] as const,
  thresholds: () => [...sacredGuardKeys.all, 'thresholds'] as const,
};

// ============================================
// Story Hooks
// ============================================
export function useCreateStory(
  options?: UseMutationOptions<any, Error, CreateStoryRequest>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateStoryRequest) => apiClient.createStory(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: storyKeys.lists() });
      if (data.storyId) {
        queryClient.setQueryData(storyKeys.detail(data.storyId), data);
      }
    },
    ...options,
  });
}

export function useStory(
  storyId: string,
  options?: Partial<UseQueryOptions<any, Error, any>>
) {
  return useQuery({
    queryKey: storyKeys.detail(storyId),
    queryFn: () => apiClient.getStory(storyId),
    enabled: !!storyId,
    staleTime: 5000,
    refetchInterval: (query) => {
      const story = query.state.data;
      if (story && ['in_progress', 'generating', 'pending_merge', 'merging', 'awaiting_approval', 'approved'].includes(story.status)) {
        return 2000;
      }
      return false;
    },
    ...options,
  });
}

export function usePresentShotPlan(
  options?: UseMutationOptions<any, Error, string>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) => apiClient.presentShotPlan(storyId),
    onSuccess: (_, storyId) => {
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });
    },
    ...options,
  });
}

export function useApproveShotPlan(
  options?: UseMutationOptions<any, Error, { storyId: string; userId: string }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, userId }) => apiClient.approveShotPlan(storyId, userId),
    onSuccess: (_, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });
    },
    ...options,
  });
}

export function useReviseShotPlan(
  options?: UseMutationOptions<any, Error, { storyId: string; revisions: ShotPlanRevision[] }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, revisions }) => apiClient.reviseShotPlan(storyId, revisions),
    onSuccess: (_, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });
    },
    ...options,
  });
}

export function useCancelStory(
  options?: UseMutationOptions<any, Error, { storyId: string; userId: string; option: string }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, userId, option }) => apiClient.cancelStory(storyId, userId, option),
    onSuccess: (_, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });
      queryClient.invalidateQueries({ queryKey: storyKeys.lists() });
    },
    ...options,
  });
}

export function useStories(
  params?: { page?: number; pageSize?: number; status?: string },
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: storyKeys.list(params),
    queryFn: () => apiClient.listStories(params).then(r => r.data),
    staleTime: 10000,
    ...options,
  });
}

// ============================================
// Character Hooks
// ============================================
export function useCharacters(
  storyId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: characterKeys.list(storyId),
    queryFn: () => apiClient.getCharacters(storyId),
    enabled: !!storyId,
    staleTime: 10000,
    ...options,
  });
}

export function useCharacter(
  storyId: string,
  name: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: characterKeys.detail(storyId, name),
    queryFn: () => apiClient.getCharacter(storyId, name).then(r => r.data),
    enabled: !!storyId && !!name,
    staleTime: 10000,
    ...options,
  });
}

export function useUploadCharacter(
  options?: UseMutationOptions<any, Error, { storyId: string; userId: string; character: any }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiClient.uploadCharacter(data),
    onSuccess: (_, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.list(storyId) });
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });
    },
    ...options,
  });
}

export function useDeleteCharacter(
  options?: UseMutationOptions<any, Error, { storyId: string; characterId: string }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, characterId }) => apiClient.deleteCharacter(storyId, characterId),
    onSuccess: (_, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: characterKeys.list(storyId) });
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });
    },
    ...options,
  });
}

// ============================================
// Model Hooks
// ============================================
export function useModels(
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: modelKeys.list(),
    queryFn: () => apiClient.getModels().then(r => r.data),
    staleTime: 60000,
    ...options,
  });
}

export function useModelEligibility(
  shotId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: modelKeys.eligibility(shotId),
    queryFn: () => apiClient.getModelEligibility(shotId).then(r => r.data),
    enabled: !!shotId,
    staleTime: 30000,
    ...options,
  });
}

export function useUserModelPriority(
  userId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: modelKeys.userPriority(userId),
    queryFn: () => apiClient.getUserModelPriority(userId).then(r => r.data),
    enabled: !!userId,
    staleTime: 60000,
    ...options,
  });
}

export function useUpdateUserModelPriority(
  options?: UseMutationOptions<any, Error, { userId: string; priorityList: string[]; useSystemDefault: boolean }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, priorityList, useSystemDefault }) => apiClient.updateUserModelPriority(userId, priorityList, useSystemDefault),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: modelKeys.userPriority(userId) });
    },
    ...options,
  });
}

// ============================================
// Admission & Generation Hooks
// ============================================
export function useShotAdmissionStatus(
  shotId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: shotKeys.admissionStatus(shotId),
    queryFn: () => apiClient.getShotAdmissionStatus(shotId).then(r => r.data),
    enabled: !!shotId,
    refetchInterval: 3000,
    ...options,
  });
}

export function useStoryAdmissionPipeline(
  storyId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: storyKeys.admissionPipeline(storyId),
    queryFn: () => apiClient.getStoryAdmissionPipeline(storyId).then(r => r.data),
    enabled: !!storyId,
    refetchInterval: 3000,
    ...options,
  });
}

export function useShotGenerationStatus(
  shotId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: shotKeys.generationStatus(shotId),
    queryFn: () => apiClient.getShotGenerationStatus(shotId).then(r => r.data),
    enabled: !!shotId,
    refetchInterval: 2000,
    ...options,
  });
}

export function useRegenerateShot(
  options?: UseMutationOptions<any, Error, { shotId: string; userId: string; options?: any }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shotId, userId, options }) => apiClient.regenerateShot(shotId, userId, options),
    onSuccess: (_, { shotId }) => {
      queryClient.invalidateQueries({ queryKey: shotKeys.detail(shotId) });
      queryClient.invalidateQueries({ queryKey: shotKeys.generationStatus(shotId) });
      queryClient.invalidateQueries({ queryKey: shotKeys.faceLockResults(shotId) });
    },
    ...options,
  });
}

// ============================================
// Face-Lock Hooks
// ============================================
export function useFaceLockResults(
  shotId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: shotKeys.faceLockResults(shotId),
    queryFn: () => apiClient.getFaceLockResults(shotId).then(r => r.data),
    enabled: !!shotId,
    refetchInterval: 3000,
    ...options,
  });
}

export function useCharacterConsistencyReport(
  characterId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: characterKeys.consistencyReport(characterId),
    queryFn: () => apiClient.getCharacterConsistencyReport(characterId).then(r => r.data),
    enabled: !!characterId,
    staleTime: 30000,
    ...options,
  });
}

// ============================================
// Merge & Delivery Hooks
// ============================================
export function useMergeStory(
  options?: UseMutationOptions<any, Error, { storyId: string; options?: any }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, options }) => apiClient.mergeStory(storyId, options),
    onSuccess: (_, { storyId }) => {
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });
      queryClient.invalidateQueries({ queryKey: deliveryKeys.detail(storyId) });
    },
    ...options,
  });
}

export function usePartialRegenerate(
  options?: UseMutationOptions<any, Error, { storyId: string; shotIds: string[]; userId: string; options?: any }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => apiClient.partialRegenerate(data),
    onSuccess: (_, { storyId, shotIds }) => {
      queryClient.invalidateQueries({ queryKey: storyKeys.detail(storyId) });
      shotIds.forEach(id => {
        queryClient.invalidateQueries({ queryKey: shotKeys.detail(id) });
        queryClient.invalidateQueries({ queryKey: shotKeys.generationStatus(id) });
        queryClient.invalidateQueries({ queryKey: shotKeys.faceLockResults(id) });
      });
    },
    ...options,
  });
}

export function useDelivery(
  storyId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: deliveryKeys.detail(storyId),
    queryFn: () => apiClient.getDelivery(storyId).then(r => r.data),
    enabled: !!storyId,
    staleTime: 30000,
    ...options,
  });
}

export function useDownloadUrl(
  _storyId: string,
  options?: UseMutationOptions<any, Error, string>
) {
  return useMutation({
    mutationFn: (storyId: string) => apiClient.getDownloadUrl(storyId),
    ...options,
  });
}

// ============================================
// Cost Hooks
// ============================================
export function useCostBreakdown(
  storyId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: costKeys.breakdown(storyId),
    queryFn: () => apiClient.getCostBreakdown(storyId).then(r => r.data),
    enabled: !!storyId,
    staleTime: 30000,
    ...options,
  });
}

export function useCostAttribution(
  storyId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: costKeys.attribution(storyId),
    queryFn: () => apiClient.getCostAttribution(storyId).then(r => r.data),
    enabled: !!storyId,
    staleTime: 30000,
    ...options,
  });
}

export function useUserBudget(
  userId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: costKeys.userBudget(userId),
    queryFn: () => apiClient.getUserBudget(userId).then(r => r.data),
    enabled: !!userId,
    staleTime: 60000,
    ...options,
  });
}

// ============================================
// Audit & Health Hooks
// ============================================
export function useAuditLogs(
  params?: { storyId?: string; userId?: string; page?: number; pageSize?: number },
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: auditKeys.logs(params),
    queryFn: () => apiClient.getAuditLogs(params).then(r => r.data),
    staleTime: 10000,
    ...options,
  });
}

export function useHealth(
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: healthKeys.overall(),
    queryFn: () => apiClient.getHealth(),
    refetchInterval: 30000,
    ...options,
  });
}

export function useServiceHealth(
  service: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: healthKeys.service(service),
    queryFn: () => apiClient.getServiceHealth(service),
    enabled: !!service,
    refetchInterval: 30000,
    ...options,
  });
}

export function useStoryStateHistory(
  storyId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: storyKeys.stateHistory(storyId),
    queryFn: () => apiClient.getStoryStateHistory(storyId).then(r => r.data),
    enabled: !!storyId,
    staleTime: 10000,
    ...options,
  });
}

// ============================================
// Settings Hooks
// ============================================
export function useUserSettings(
  userId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: settingsKeys.user(userId),
    queryFn: () => apiClient.getUserSettings(userId).then(r => r.data),
    enabled: !!userId,
    staleTime: 60000,
    ...options,
  });
}

export function useUpdateUserSettings(
  options?: UseMutationOptions<any, Error, { userId: string; settings: any }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, settings }) => apiClient.updateUserSettings(userId, settings),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.user(userId) });
    },
    ...options,
  });
}

export function useProjectSettings(
  projectId: string,
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: settingsKeys.project(projectId),
    queryFn: () => apiClient.getProjectSettings(projectId).then(r => r.data),
    enabled: !!projectId,
    staleTime: 60000,
    ...options,
  });
}

export function useUpdateProjectSettings(
  options?: UseMutationOptions<any, Error, { projectId: string; settings: any }>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, settings }) => apiClient.updateProjectSettings(projectId, settings),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.project(projectId) });
    },
    ...options,
  });
}

// ============================================
// Sacred Guard Hooks
// ============================================
export function useSacredGuardThresholds(
  options?: UseQueryOptions<any, Error, any>
) {
  return useQuery({
    queryKey: sacredGuardKeys.thresholds(),
    queryFn: () => apiClient.getSacredGuardThresholds().then(r => r.data),
    staleTime: 60000,
    ...options,
  });
}

export function useUpdateSacredGuardThresholds(
  options?: UseMutationOptions<any, Error, any>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (thresholds: any) => apiClient.updateSacredGuardThresholds(thresholds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sacredGuardKeys.thresholds() });
    },
    ...options,
  });
}

export function useSubmitSacredGuardAppeal(
  options?: UseMutationOptions<any, Error, any>
) {
  return useMutation({
    mutationFn: (data: any) => apiClient.submitSacredGuardAppeal(data),
    ...options,
  });
}