export interface WizardStep {
    num: number;
    label: string;
}

export const WIZARD_STEPS: WizardStep[] = [
    { num: 1, label: 'Intentions' },
    { num: 2, label: 'Refine' },
    { num: 3, label: 'Schedule' },
    { num: 4, label: 'Music' },
];

export const TOTAL_STEPS = WIZARD_STEPS.length;
