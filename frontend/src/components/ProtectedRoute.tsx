import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, isAdmin, isPending, isApproved } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (isPending) {
    return <Navigate to="/pending" replace />;
  }

  if (isAdmin && window.location.pathname !== '/admin') {
    return <Navigate to="/admin" replace />;
  }

  if (!isAdmin && window.location.pathname === '/admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
