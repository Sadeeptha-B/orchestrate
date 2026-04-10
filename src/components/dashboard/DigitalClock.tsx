import { useState, useEffect } from 'react';
import { format } from 'date-fns';

export function DigitalClock() {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    return (
        <div className="border border-dotted border-border rounded-lg p-4 text-right select-none">
            <p className="text-5xl font-semibold tracking-tight tabular-nums text-text">
                {format(now, 'h:mm')}
                <span className="text-xl ml-1 text-text-light font-medium">{format(now, 'a')}</span>
            </p>
            <p className="text-sm text-text-light mt-1">{format(now, 'EEEE, MMMM d')}</p>
        </div>
    );
}
