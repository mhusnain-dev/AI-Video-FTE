import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { StoryCreate } from './pages/StoryCreate';
import { ShotPlanReview } from './pages/ShotPlanReview';
import { ShotPlanEditor } from './pages/ShotPlanEditor';
import { CharacterManager } from './pages/CharacterManager';
import { ProgressDashboard } from './pages/ProgressDashboard';
import { FaceLockReview } from './pages/FaceLockReview';
import { DeliveryPage } from './pages/DeliveryPage';
import { Settings } from './pages/Settings';
import { NotificationContainer } from './components/NotificationContainer';

export function App() {
  return (
    <>
      <AppLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/stories/new" element={<StoryCreate />} />
          <Route path="/stories/:storyId/plan" element={<ShotPlanReview />} />
          <Route path="/stories/:storyId/plan/edit" element={<ShotPlanEditor />} />
          <Route path="/stories/:storyId/characters" element={<CharacterManager />} />
          <Route path="/stories/:storyId/progress" element={<ProgressDashboard />} />
          <Route path="/stories/:storyId/review" element={<FaceLockReview />} />
          <Route path="/stories/:storyId/delivery" element={<DeliveryPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppLayout>
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