import { Suspense, lazy, type ComponentType } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { DayPlanProvider } from './context/DayPlanContext';
import { useDayPlan } from './hooks/useDayPlan';
import { TodoistProvider } from './context/TodoistContext';
import { ReconciliationProvider } from './context/ReconciliationContext';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

/**
 * Wrap a route's dynamic import so a failed chunk fetch — typically a stale hashed chunk after a
 * new build/deploy (the loaded `index.html` references chunk filenames that no longer exist on the
 * server) — triggers a single full-page reload to pull the fresh `index.html` + chunk graph. A
 * successful load clears the guard; the timestamp caps reloads to one per 10s so a genuinely
 * missing chunk surfaces to the `ErrorBoundary` instead of looping.
 */
function lazyWithReload<T extends ComponentType<object>>(factory: () => Promise<{ default: T }>) {
    return lazy(async () => {
        const KEY = 'orchestrate-chunk-reload-at';
        try {
            const mod = await factory();
            sessionStorage.removeItem(KEY);
            return mod;
        } catch (err) {
            const lastReload = Number(sessionStorage.getItem(KEY) ?? 0);
            if (Date.now() - lastReload > 10_000) {
                sessionStorage.setItem(KEY, String(Date.now()));
                window.location.reload();
                return new Promise<{ default: T }>(() => {}); // hold the Suspense fallback until reload
            }
            throw err;
        }
    });
}

const Wizard = lazyWithReload(() => import('./components/wizard/Wizard').then((mod) => ({ default: mod.Wizard })));
const Dashboard = lazyWithReload(() => import('./components/dashboard/Dashboard').then((mod) => ({ default: mod.Dashboard })));
const Welcome = lazyWithReload(() => import('./components/Welcome').then((mod) => ({ default: mod.Welcome })));
const LifeView = lazyWithReload(() => import('./components/life/LifeView').then((mod) => ({ default: mod.LifeView })));
const SeasonsManager = lazyWithReload(() => import('./components/life/SeasonsManager').then((mod) => ({ default: mod.SeasonsManager })));
const SeasonDetail = lazyWithReload(() => import('./components/life/SeasonDetail').then((mod) => ({ default: mod.SeasonDetail })));
const HabitsLibrary = lazyWithReload(() => import('./components/life/HabitsLibrary').then((mod) => ({ default: mod.HabitsLibrary })));
const UserGuide = lazyWithReload(() => import('./components/guide/UserGuide').then((mod) => ({ default: mod.UserGuide })));
const SettingsPage = lazyWithReload(() => import('./components/settings/SettingsPage').then((mod) => ({ default: mod.SettingsPage })));

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

