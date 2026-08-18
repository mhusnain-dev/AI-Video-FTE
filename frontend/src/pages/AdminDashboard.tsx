import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// Helper to format dates
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

// Duration options
const DURATION_OPTIONS = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

type Tab = 'users' | 'audit';

export function AdminDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [approveDuration, setApproveDuration] = useState<Record<string, number>>({});

  // Fetch users
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', statusFilter],
    queryFn: async () => {
      const res = await apiClient.listUsers(statusFilter || undefined);
      return res.data.users;
    },
  });

  // Fetch audit log
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: async () => {
      const res = await apiClient.getAuditLog(100, 0);
      return res.data.auditLog;
    },
    enabled: activeTab === 'audit',
  });

  // Mutations
  const approveMutation = useMutation({
    mutationFn: ({ userId, hours }: { userId: string; hours: number }) => apiClient.approveUser(userId, hours),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (userId: string) => apiClient.rejectUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (userId: string) => apiClient.revokeUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => apiClient.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  const handleApprove = (userId: string) => {
    const hours = approveDuration[userId] || 168; // default 7 days
    approveMutation.mutate({ userId, hours });
  };

  const handleReject = (userId: string) => {
    if (confirm('Reject and delete this user? This cannot be undone.')) {
      rejectMutation.mutate(userId);
    }
  };

  const handleRevoke = (userId: string) => {
    if (confirm('Revoke this user\'s access?')) {
      revokeMutation.mutate(userId);
    }
  };

  const handleDelete = (userId: string) => {
    if (confirm('Permanently delete this user? This cannot be undone.')) {
      deleteMutation.mutate(userId);
    }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      revoked: 'bg-red-100 text-red-800',
      expired: 'bg-orange-100 text-orange-800',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-1">Manage user accounts and access permissions</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('users')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'users'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Users
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'audit'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Audit Log
          </button>
        </nav>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div>
          {/* Status Filter */}
          <div className="mb-4 flex gap-2">
            {['', 'pending', 'approved', 'revoked'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-lg text-sm font-medium ${
                  statusFilter === s
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>

          {usersLoading ? (
            <div className="text-center py-8 text-gray-500">Loading users...</div>
          ) : (
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Access Expires</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Registered</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {usersData?.map((u: any) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {u.email}
                        {u.id === user?.id && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{u.role}</td>
                      <td className="px-6 py-4">{statusBadge(u.status)}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{formatDate(u.accessExpiresAt)}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{formatDate(u.createdAt)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2 flex-wrap">
                          {u.status === 'pending' && (
                            <>
                              <select
                                value={approveDuration[u.id] || 168}
                                onChange={(e) => setApproveDuration({ ...approveDuration, [u.id]: parseInt(e.target.value) })}
                                className="text-xs border border-gray-300 rounded px-2 py-1"
                              >
                                {DURATION_OPTIONS.map((opt) => (
                                  <option key={opt.hours} value={opt.hours}>{opt.label}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleApprove(u.id)}
                                disabled={approveMutation.isPending}
                                className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleReject(u.id)}
                                disabled={rejectMutation.isPending}
                                className="text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {u.status === 'approved' && u.id !== user?.id && (
                            <>
                              <select
                                value={approveDuration[u.id] || 168}
                                onChange={(e) => setApproveDuration({ ...approveDuration, [u.id]: parseInt(e.target.value) })}
                                className="text-xs border border-gray-300 rounded px-2 py-1"
                              >
                                {DURATION_OPTIONS.map((opt) => (
                                  <option key={opt.hours} value={opt.hours}>{opt.label}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleApprove(u.id)}
                                disabled={approveMutation.isPending}
                                className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                              >
                                Extend
                              </button>
                              <button
                                onClick={() => handleRevoke(u.id)}
                                disabled={revokeMutation.isPending}
                                className="text-xs bg-orange-600 text-white px-3 py-1 rounded hover:bg-orange-700 disabled:opacity-50"
                              >
                                Revoke
                              </button>
                              <button
                                onClick={() => handleDelete(u.id)}
                                disabled={deleteMutation.isPending}
                                className="text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {(u.status === 'revoked' || u.status === 'expired') && u.id !== user?.id && (
                            <button
                              onClick={() => handleDelete(u.id)}
                              disabled={deleteMutation.isPending}
                              className="text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(!usersData || usersData.length === 0) && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500">No users found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Audit Log Tab */}
      {activeTab === 'audit' && (
        <div>
          {auditLoading ? (
            <div className="text-center py-8 text-gray-500">Loading audit log...</div>
          ) : (
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {auditData?.map((entry: any) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-600">{formatDate(entry.createdAt)}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{entry.adminEmail}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          entry.action === 'approve' ? 'bg-green-100 text-green-800' :
                          entry.action === 'reject' || entry.action === 'delete' ? 'bg-red-100 text-red-800' :
                          entry.action === 'revoke' ? 'bg-orange-100 text-orange-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{entry.targetEmail || entry.targetUserId}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{JSON.stringify(entry.details)}</td>
                    </tr>
                  ))}
                  {(!auditData || auditData.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">No audit entries yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
