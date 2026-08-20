import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../api/client';

export function PendingApproval() {
  const { user, logout, token } = useAuth();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [countdown, setCountdown] = useState(3);

  const checkApproval = useCallback(async () => {
    if (!token || status !== 'pending') return;
    try {
      const res = await apiClient.getMe();
      if (res.data.status === 'approved') {
        if (pollRef.current) clearInterval(pollRef.current);
        setPendingVisible(false);
        setTimeout(() => setStatus('approved'), 400);
      } else if (res.data.status === 'revoked' || res.data.status === 'expired') {
        if (pollRef.current) clearInterval(pollRef.current);
        setPendingVisible(false);
        setTimeout(() => setStatus('rejected'), 400);
      }
    } catch {
      logout();
    }
  }, [token, logout, status]);

  useEffect(() => {
    pollRef.current = setInterval(checkApproval, 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checkApproval]);

  useEffect(() => {
    if (status === 'pending') return;
    let remaining = 3;
    setCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        if (status === 'approved') {
          window.location.href = '/';
        } else {
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  const [pendingVisible, setPendingVisible] = useState(true);

  return (
    <div
      className="min-h-screen flex items-center justify-center transition-colors duration-500"
      style={{
        backgroundColor: status === 'approved' ? '#f0fdf4' : status === 'rejected' ? '#fef2f2' : '#f9fafb',
      }}
    >
      {/* Pending Card */}
      <div
        className={`absolute max-w-md w-full mx-4 bg-white rounded-xl shadow-lg p-8 text-center transition-all duration-400 ease-in-out ${
          pendingVisible
            ? 'opacity-100 scale-100'
            : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Account Pending Approval</h1>
        <p className="text-gray-600 mb-2">
          Your account (<span className="font-medium">{user?.email}</span>) has been registered successfully.
        </p>
        <p className="text-gray-500 mb-6">
          An administrator needs to approve your account before you can access the platform.
          This page will update automatically once you are approved.
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-6">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />
          <span>Waiting for admin approval...</span>
        </div>
        <button
          onClick={logout}
          className="w-full bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition-colors"
        >
          Logout
        </button>
      </div>

      {/* Approved Card */}
      {status === 'approved' && (
        <div className="absolute max-w-lg w-full mx-4 bg-white rounded-2xl shadow-2xl border-2 border-green-200 p-10 text-center animate-scale-in animate-glow-green">
          <div className="mb-6">
            <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center animate-pulse">
              <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-green-600 mb-3">Account Activated</h1>
          <p className="text-gray-700 text-lg mb-2">
            Your account has been <span className="font-semibold text-green-600">approved</span> by the administrator.
          </p>
          <p className="text-gray-500 mb-8">
            Redirecting to your dashboard in <span className="font-bold text-green-600">{countdown}</span> seconds.
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-green-500 h-full rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${((3 - countdown) / 3) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Rejection Card */}
      {status === 'rejected' && (
        <div className="absolute max-w-lg w-full mx-4 bg-white rounded-2xl shadow-2xl border-2 border-red-200 p-10 text-center animate-scale-in">
          <div className="mb-6">
            <div className="mx-auto w-20 h-20 bg-red-100 rounded-full flex items-center justify-center animate-pulse">
              <svg className="w-10 h-10 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-red-600 mb-3">Account Rejected</h1>
          <p className="text-gray-700 text-lg mb-2">
            Your account has been <span className="font-semibold text-red-600">rejected</span> by the administrator.
          </p>
          <p className="text-gray-500 mb-8">
            You will be redirected to the login page in <span className="font-bold text-red-600">{countdown}</span> seconds.
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-red-500 h-full rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${((3 - countdown) / 3) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default PendingApproval;
