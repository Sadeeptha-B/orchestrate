export interface WizardStep {
    num: number;
    label: string;
}

export const WIZARD_STEPS: WizardStep[] = [
    { num: 1, label: 'Sessions' },
    { num: 2, label: 'Intentions' },
    { num: 3, label: 'Refine' },
    { num: 4, label: 'Schedule' },
    { num: 5, label: 'Ready' },
];

export const TOTAL_STEPS = WIZARD_STEPS.length;
