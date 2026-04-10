import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    className?: string;
}

export function Card({ children, className = '', ...rest }: CardProps) {
    return (
        <div className={`bg-white rounded-xl border border-border p-5 ${className}`} {...rest}>
            {children}
        </div>
    );
}
