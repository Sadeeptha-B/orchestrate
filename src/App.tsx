import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { DayPlanProvider, useDayPlan } from './context/DayPlanContext';
import { TodoistProvider } from './context/TodoistContext';
import { Wizard } from './components/wizard/Wizard';
import { Dashboard } from './components/dashboard/Dashboard';
import { Welcome } from './components/Welcome';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { LifeView } from './components/life/LifeView';
import { SeasonsManager } from './components/life/SeasonsManager';
import { SeasonDetail } from './components/life/SeasonDetail';
import { HabitsLibrary } from './components/life/HabitsLibrary';

function AppRoutes() {
    const { plan } = useDayPlan();
    const location = useLocation();
    const fromWelcome = (location.state as { fromWelcome?: boolean })?.fromWelcome === true;

    return (
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
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}

export default function App() {
    return (
        <ErrorBoundary>
            <DayPlanProvider>
                <TodoistProvider>
                    <AppRoutes />
                </TodoistProvider>
            </DayPlanProvider>
        </ErrorBoundary>
    );
}

