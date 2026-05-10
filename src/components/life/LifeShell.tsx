import type { ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';

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
                        <ThemeToggle />
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
