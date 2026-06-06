export interface WizardStep {
    num: number;
    label: string;
}

export const WIZARD_STEPS: WizardStep[] = [
    { num: 1, label: 'Intentions' },
    { num: 2, label: 'Refine' },
    { num: 3, label: 'Sessions' },
    { num: 4, label: 'Schedule' },
    { num: 5, label: 'Music' },
];

export const TOTAL_STEPS = WIZARD_STEPS.length;
