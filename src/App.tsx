import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { DayPlanProvider, useDayPlan } from './context/DayPlanContext';
import { Wizard } from './components/wizard/Wizard';
import { Dashboard } from './components/dashboard/Dashboard';
import { Welcome } from './components/Welcome';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

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
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}

export default function App() {
    return (
        <ErrorBoundary>
            <DayPlanProvider>
                <AppRoutes />
            </DayPlanProvider>
        </ErrorBoundary>
    );
}

