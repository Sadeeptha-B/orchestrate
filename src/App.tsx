import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { DayPlanProvider } from './context/DayPlanContext';
import { useDayPlan } from './hooks/useDayPlan';
import { TodoistProvider } from './context/TodoistContext';
import { ReconciliationProvider } from './context/ReconciliationContext';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

const Wizard = lazy(() => import('./components/wizard/Wizard').then((mod) => ({ default: mod.Wizard })));
const Dashboard = lazy(() => import('./components/dashboard/Dashboard').then((mod) => ({ default: mod.Dashboard })));
const Welcome = lazy(() => import('./components/Welcome').then((mod) => ({ default: mod.Welcome })));
const LifeView = lazy(() => import('./components/life/LifeView').then((mod) => ({ default: mod.LifeView })));
const SeasonsManager = lazy(() => import('./components/life/SeasonsManager').then((mod) => ({ default: mod.SeasonsManager })));
const SeasonDetail = lazy(() => import('./components/life/SeasonDetail').then((mod) => ({ default: mod.SeasonDetail })));
const HabitsLibrary = lazy(() => import('./components/life/HabitsLibrary').then((mod) => ({ default: mod.HabitsLibrary })));
const RestCuesManager = lazy(() => import('./components/life/RestCuesManager').then((mod) => ({ default: mod.RestCuesManager })));
const UserGuide = lazy(() => import('./components/guide/UserGuide').then((mod) => ({ default: mod.UserGuide })));
const SettingsPage = lazy(() => import('./components/settings/SettingsPage').then((mod) => ({ default: mod.SettingsPage })));

function RouteFallback() {
    return (
        <div className="min-h-screen bg-app text-text px-4 py-10 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card px-5 py-4 text-sm text-text-light">
                Loading…
            </div>
        </div>
    );
}

function AppRoutes() {
    const { plan } = useDayPlan();
    const location = useLocation();
    const fromWelcome = (location.state as { fromWelcome?: boolean })?.fromWelcome === true;

    return (
        <Suspense fallback={<RouteFallback />}>
            <Routes>
                <Route
                    path="/"
                    element={plan.setupComplete ? <Dashboard /> : <Welcome />}
                />
                <Route
                    path="/setup"
                    element={
                        plan.setupComplete || fromWelcome
                            ? <Wizard />
                            : <Navigate to="/" replace />
                    }
                />
                <Route path="/life" element={<LifeView />} />
                <Route path="/season" element={<SeasonsManager />} />
                <Route path="/season/:id" element={<SeasonDetail />} />
                <Route path="/habits" element={<HabitsLibrary />} />
                <Route path="/rest-cues" element={<RestCuesManager />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/guide" element={<UserGuide />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </Suspense>
    );
}

export default function App() {
    return (
        <ErrorBoundary>
            <DayPlanProvider>
                <TodoistProvider>
                    <ReconciliationProvider>
                        <AppRoutes />
                    </ReconciliationProvider>
                </TodoistProvider>
            </DayPlanProvider>
        </ErrorBoundary>
    );
}

