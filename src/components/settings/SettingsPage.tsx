import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { HeaderControls } from '../ui/HeaderControls';
import { TodoistSetup } from '../todoist/TodoistSetup';
import { DataManagement } from './DataManagement';
import { CapacitySettings } from './CapacitySettings';
import { useDayPlan } from '../../hooks/useDayPlan';
import { inputClass, labelClass } from '../ui/formStyles';

const TABS = ['integrations', 'capacity', 'data'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
    integrations: 'Integrations',
    capacity: 'Capacity',
    data: 'Data',
};

function isTab(value: string | null): value is Tab {
    return TABS.includes(value as Tab);
}

export function SettingsPage() {
    const navigate = useNavigate();
    const { settings, dispatch } = useDayPlan();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const [activeTab, setActiveTab] = useState<Tab>(isTab(tabParam) ? tabParam : 'integrations');

    const selectTab = (tab: Tab) => {
        setActiveTab(tab);
        setSearchParams({ tab }, { replace: true });
    };

    const handleShowSavedSessions = () => {
        navigate('/setup', { state: { fromWelcome: true } });
    };

    return (
        <div className="min-h-screen flex flex-col">
            <header className="px-6 py-4 border-b border-border">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="text-xl font-semibold text-accent flex items-center gap-2"
                        >
                            <Logo />
                            Orchestrate
                        </Link>
                        <span className="text-text-light text-sm">/</span>
                        <span className="text-sm text-text">Settings</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigate(-1)}
                            className="text-sm text-text-light hover:text-accent cursor-pointer"
                        >
                            ← Back
                        </button>
                        <HeaderControls />
                    </div>
                </div>
            </header>

            <main className="flex-1 px-6 py-6">
                <div className="max-w-5xl mx-auto flex gap-8">
                    {/* Vertical tab sidebar */}
                    <nav className="w-48 flex-shrink-0">
                        <div className="mb-5 pb-5 border-b border-border">
                            <label className={labelClass}>Your name</label>
                            <input
                                type="text"
                                value={settings.userName ?? ''}
                                onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', settings: { userName: e.target.value } })}
                                placeholder="e.g. Alex"
                                className={inputClass}
                            />
                        </div>
                        <ul className="space-y-1">
                            {TABS.map((tab) => (
                                <li key={tab}>
                                    <button
                                        onClick={() => selectTab(tab)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${activeTab === tab
                                            ? 'bg-accent text-white'
                                            : 'text-text-light hover:bg-surface-dark hover:text-text'
                                            }`}
                                    >
                                        {TAB_LABELS[tab]}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    {/* Tab content */}
                    <section className="flex-1 min-w-0">
                        <h2 className="text-lg font-semibold mb-4">{TAB_LABELS[activeTab]}</h2>
                        {activeTab === 'integrations' && <TodoistSetup />}
                        {activeTab === 'capacity' && <CapacitySettings />}
                        {activeTab === 'data' && (
                            <DataManagement onShowSavedSessions={handleShowSavedSessions} />
                        )}
                    </section>
                </div>
            </main>
        </div>
    );
}
