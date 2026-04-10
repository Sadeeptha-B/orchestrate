import type { SessionSlot } from '../types';

export const defaultSessionSlots: SessionSlot[] = [
    {
        id: 'early-morning',
        name: 'Early Morning',
        startTime: '06:00',
        endTime: '08:00',
    },
    {
        id: 'morning',
        name: 'Morning',
        startTime: '09:00',
        endTime: '13:00',
    },
    {
        id: 'afternoon',
        name: 'Afternoon',
        startTime: '14:30',
        endTime: '18:30',
    },
    {
        id: 'night',
        name: 'Night',
        startTime: '20:30',
        endTime: '23:00',
    },
];
