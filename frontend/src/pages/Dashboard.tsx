import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  DocumentTextIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { useStories, useHealth } from '../hooks/useStories';
import { StatusBadge } from '../components/ShotCard';
import type { Story, StoryStatus } from '../types/api';

const STATUS_ICONS: Record<StoryStatus, typeof DocumentTextIcon> = {
  draft: DocumentTextIcon,
  planning: ClockIcon,
  awaiting_approval: ExclamationTriangleIcon,
  approved: CheckCircleIcon,
  in_progress: ClockIcon,
  generating: ClockIcon,
  pending_merge: ClockIcon,
  merging: ClockIcon,
  completed: CheckCircleIcon,
  failed: XCircleIcon,
  cancelled: XCircleIcon,
  paused_cost: ExclamationTriangleIcon,
  paused_rate_limit: ExclamationTriangleIcon,
  paused_sacred_guard: ExclamationTriangleIcon,
};

export function Dashboard() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const { data: storiesResponse, isLoading, isError, refetch } = useStories({
    page,
    pageSize: 10,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  });

  const { data: health } = useHealth();

  const stories = storiesResponse?.data?.items || [];
  const totalPages = storiesResponse?.data?.totalPages || 1;
  const total = storiesResponse?.data?.total || 0;

  const filteredStories = stories.filter((story: Story) =>
    story.brief?.narrative?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    story.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusIcon = (status: StoryStatus) => {
    const Icon = STATUS_ICONS[status] || DocumentTextIcon;
    return <Icon className="w-5 h-5" />;
  };

  const handleCreateStory = () => {
    navigate('/stories/new');
  };

  const handleViewStory = (story: Story) => {
    navigate(`/stories/${story.id}/plan`);
  };

  const handleViewProgress = (story: Story) => {
    navigate(`/stories/${story.id}/progress`);
  };

  const handleViewDelivery = (story: Story) => {
    navigate(`/stories/${story.id}/delivery`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎬</span>
              <h1 className="text-xl font-bold text-gray-900">AI Video FTE</h1>
            </div>

            <div className="flex items-center gap-4">
              {/* Health Status */}
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${
                  health?.data?.status === 'healthy' ? 'bg-green-500' :
                  health?.data?.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-gray-600 capitalize">
                  {health?.data?.status || 'unknown'}
                </span>
              </div>

              <button onClick={handleCreateStory} className="btn-primary">
                <PlusIcon className="w-5 h-5 mr-2" />
                New Story
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search stories by narrative or ID..."
              className="input pl-10"
            />
          </div>

          <div className="flex items-center gap-3">
            <FunnelIcon className="w-5 h-5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input w-auto"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="planning">Planning</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="approved">Approved</option>
              <option value="in_progress">In Progress</option>
              <option value="generating">Generating</option>
              <option value="merging">Merging</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="paused_cost">Paused (Cost)</option>
              <option value="paused_rate_limit">Paused (Rate Limit)</option>
              <option value="paused_sacred_guard">Paused (Sacred Guard)</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Total Stories"
            value={total}
            icon={DocumentTextIcon}
            color="blue"
          />
          <StatCard
            title="In Progress"
            value={stories.filter((s: Story) => ['in_progress', 'generating', 'merging'].includes(s.status)).length}
            icon={ClockIcon}
            color="purple"
          />
          <StatCard
            title="Completed"
            value={stories.filter((s: Story) => s.status === 'completed').length}
            icon={CheckCircleIcon}
            color="green"
          />
          <StatCard
            title="Need Attention"
            value={stories.filter((s: Story) => ['awaiting_approval', 'failed', 'paused_cost', 'paused_rate_limit', 'paused_sacred_guard'].includes(s.status)).length}
            icon={ExclamationTriangleIcon}
            color="orange"
          />
        </div>

        {/* Stories List */}
        <div className="card">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4" />
              <p className="text-gray-500">Loading stories...</p>
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-red-600">
              <ExclamationTriangleIcon className="w-12 h-12 mx-auto mb-4" />
              <p>Failed to load stories</p>
              <button onClick={() => refetch()} className="btn-primary mt-4">
                Retry
              </button>
            </div>
          ) : filteredStories.length === 0 ? (
            <div className="p-12 text-center">
              <DocumentTextIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No stories found</h3>
              <p className="text-gray-500 mb-6">
                {searchQuery || statusFilter !== 'all' ? 'Try adjusting your search or filters.' : 'Get started by creating your first story.'}
              </p>
              {!searchQuery && statusFilter === 'all' && (
                <button onClick={handleCreateStory} className="btn-primary">
                  <PlusIcon className="w-5 h-5 mr-2" />
                  Create Story
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Story</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shots</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Updated</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredStories.map((story: Story) => (
                      <tr key={story.id} className="hover:bg-gray-50 transition">
                        <td className="px-4 py-4">
                          <div>
                            <p className="font-medium text-gray-900 truncate max-w-xs">
                              {story.brief?.narrative?.substring(0, 80)}...
                            </p>
                            <p className="text-xs text-gray-500">
                              {story.id.substring(0, 8)}...
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(story.status)}
                            <StatusBadge status={story.status} type="story" size="sm" />
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {formatDuration(story.brief?.targetDurationSeconds || 0)}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {story.shotPlan?.length || 0}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-600">
                          {story.costActualUsd ? `$${story.costActualUsd.toFixed(2)}` :
                           story.costEstimateUsd ? `$${story.costEstimateUsd.toFixed(2)} (est.)` : '—'}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-500">
                          {formatDate(story.updatedAt)}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {['awaiting_approval'].includes(story.status) && (
                              <button
                                onClick={() => handleViewStory(story)}
                                className="btn-primary text-sm"
                              >
                                Review
                              </button>
                            )}
                            {['in_progress', 'generating', 'merging', 'approved'].includes(story.status) && (
                              <button
                                onClick={() => handleViewProgress(story)}
                                className="btn-secondary text-sm"
                              >
                                Progress
                              </button>
                            )}
                            {story.status === 'completed' && (
                              <button
                                onClick={() => handleViewDelivery(story)}
                                className="btn-primary text-sm"
                              >
                                Download
                              </button>
                            )}
                            <button
                              onClick={() => handleViewStory(story)}
                              className="btn-ghost text-sm"
                              title="View Details"
                            >
                              Details
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    Page {page} of {totalPages} ({total} total)
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="btn-secondary text-sm"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="btn-secondary text-sm"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: any; color: string }) {
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-xl ${colorClasses[color as keyof typeof colorClasses] || 'bg-gray-500'}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default Dashboard;