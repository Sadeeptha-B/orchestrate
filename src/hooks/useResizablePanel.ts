import { useState, useRef, useCallback, useEffect } from 'react';

const PANEL_MIN = 220;
const PANEL_MAX = 480;
const PANEL_DEFAULT = 288;

export function useResizablePanel() {
    const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
    const dragging = useRef(false);
    const startX = useRef(0);
    const startWidth = useRef(PANEL_DEFAULT);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        dragging.current = true;
        startX.current = e.clientX;
        startWidth.current = panelWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }, [panelWidth]);

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            if (!dragging.current) return;
            const delta = e.clientX - startX.current;
            const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth.current + delta));
            setPanelWidth(next);
        };
        const onMouseUp = () => {
            if (!dragging.current) return;
            dragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    return { panelWidth, onMouseDown };
}
