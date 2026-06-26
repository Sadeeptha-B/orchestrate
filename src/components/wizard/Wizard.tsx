import { useDayPlan } from '../../hooks/useDayPlan';
import { Step1Sessions } from './Step1Sessions';
import { Step2Intentions } from './Step2Intentions';
import { Step3Refine } from './Step3Refine';
import { Step4Schedule } from './Step4Schedule';
import { Step5Launch } from './Step5Launch';

const STEPS = [
    Step1Sessions,
    Step2Intentions,
    Step3Refine,
    Step4Schedule,
    Step5Launch,
];

export function Wizard() {
    const { plan } = useDayPlan();
    const StepComponent = STEPS[plan.wizardStep - 1] ?? Step1Sessions;
    return <StepComponent />;
}
