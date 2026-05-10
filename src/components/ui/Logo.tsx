interface LogoProps {
    className?: string;
}

export function Logo({ className = 'w-6 h-6' }: LogoProps) {
    return (
        <img
            src={import.meta.env.BASE_URL + 'favicon.svg'}
            alt=""
            className={className}
        />
    );
}
