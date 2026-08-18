import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { NotificationContainer } from './components/NotificationContainer';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const StoryCreate = lazy(() => import('./pages/StoryCreate').then(m => ({ default: m.StoryCreate })));
const ShotPlanReview = lazy(() => import('./pages/ShotPlanReview').then(m => ({ default: m.ShotPlanReview })));
const ShotPlanEditor = lazy(() => import('./pages/ShotPlanEditor').then(m => ({ default: m.ShotPlanEditor })));
const CharacterManager = lazy(() => import('./pages/CharacterManager').then(m => ({ default: m.CharacterManager })));
const ProgressDashboard = lazy(() => import('./pages/ProgressDashboard').then(m => ({ default: m.ProgressDashboard })));
const FaceLockReview = lazy(() => import('./pages/FaceLockReview').then(m => ({ default: m.FaceLockReview })));
const DeliveryPage = lazy(() => import('./pages/DeliveryPage').then(m => ({ default: m.DeliveryPage })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Register = lazy(() => import('./pages/Register').then(m => ({ default: m.Register })));
const PromptReview = lazy(() => import('./pages/PromptReview').then(m => ({ default: m.PromptReview })));
const ChunkPlayerPage = lazy(() => import('./pages/ChunkPlayerPage').then(m => ({ default: m.ChunkPlayerPage })));
const Preferences = lazy(() => import('./pages/Preferences').then(m => ({ default: m.Preferences })));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const PendingApproval = lazy(() => import('./pages/PendingApproval').then(m => ({ default: m.PendingApproval })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then(m => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })));

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Suspense fallback={<LoadingFallback />}><Login /></Suspense>} />
        <Route path="/register" element={<Suspense fallback={<LoadingFallback />}><Register /></Suspense>} />
        <Route path="/forgot-password" element={<Suspense fallback={<LoadingFallback />}><ForgotPassword /></Suspense>} />
        <Route path="/reset-password" element={<Suspense fallback={<LoadingFallback />}><ResetPassword /></Suspense>} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Suspense fallback={<LoadingFallback />}>
                  <Routes>
                    <Route path="/admin" element={<AdminDashboard />} />
                    <Route path="/pending" element={<PendingApproval />} />
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/stories/new" element={<StoryCreate />} />
                    <Route path="/stories/:storyId/plan" element={<ShotPlanReview />} />
                    <Route path="/stories/:storyId/plan/edit" element={<ShotPlanEditor />} />
                    <Route path="/stories/:storyId/characters" element={<CharacterManager />} />
                    <Route path="/stories/:storyId/progress" element={<ProgressDashboard />} />
                    <Route path="/stories/:storyId/review" element={<FaceLockReview />} />
                    <Route path="/stories/:storyId/prompt-review" element={<PromptReview />} />
                    <Route path="/stories/:storyId/chunks" element={<ChunkPlayerPage />} />
                    <Route path="/stories/:storyId/delivery" element={<DeliveryPage />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/preferences" element={<Preferences />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
      <NotificationContainer />
    </>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">404</h1>
        <p className="text-gray-500 mb-4">Page not found</p>
        <a href="/" className="btn-primary">Back to Dashboard</a>
      </div>
    </div>
  );
}

export default App;
