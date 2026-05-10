import type { ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';

interface Crumb {
    label: string;
    to: string;
}

interface LifeShellProps {
    title: string;
    subtitle?: string;
    crumbs?: Crumb[];
    children: ReactNode;
}

export function LifeShell({ title, subtitle, crumbs = [], children }: LifeShellProps) {
    const navigate = useNavigate();
    const { theme, toggle: toggleTheme } = useTheme();

    return (
        <div className="min-h-screen flex flex-col">
            <header className="px-6 py-4 border-b border-border">
                <div className="max-w-5xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link
                            to="/"
                            className="text-xl font-semibold text-accent flex items-center gap-2"
                        >
                            <img
                                src={import.meta.env.BASE_URL + 'favicon.svg'}
                                alt=""
                                className="w-6 h-6"
                            />
                            Orchestrate
                        </Link>
                        <span className="text-text-light text-sm">/</span>
                        <Link to="/life" className="text-sm text-text-light hover:text-accent">
                            Life
                        </Link>
                        {crumbs.map((c) => (
                            <span key={c.to} className="flex items-center gap-2">
                                <span className="text-text-light text-sm">/</span>
                                <Link to={c.to} className="text-sm text-text-light hover:text-accent">
                                    {c.label}
                                </Link>
                            </span>
                        ))}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigate('/')}
                            className="text-sm text-text-light hover:text-accent cursor-pointer"
                        >
                            Back to Dashboard
                        </button>
                        <button
                            onClick={toggleTheme}
                            className="p-1.5 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer"
                            aria-label="Toggle theme"
                        >
                            {theme === 'dark' ? '☀️' : '\u{1F319}'}
                        </button>
                    </div>
                </div>
            </header>
            <main className="flex-1 px-6 py-6">
                <div className="max-w-5xl mx-auto">
                    <div className="mb-6">
                        <h2 className="text-2xl font-semibold mb-1">{title}</h2>
                        {subtitle && <p className="text-sm text-text-light">{subtitle}</p>}
                    </div>
                    {children}
                </div>
            </main>
        </div>
    );
}
