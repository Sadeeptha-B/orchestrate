import { Routes, Route, Navigate } from 'react-router-dom';
import { DayPlanProvider, useDayPlan } from './context/DayPlanContext';
import { Wizard } from './components/wizard/Wizard';
import { Dashboard } from './components/dashboard/Dashboard';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

function AppRoutes() {
    const { plan } = useDayPlan();

    return (
        <Routes>
            <Route
                path="/"
                element={plan.setupComplete ? <Dashboard /> : <Navigate to="/setup" replace />}
            />
            <Route
                path="/setup"
                element={<Wizard />}
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

