import { useDayPlan } from '../../context/DayPlanContext';
import { Step1Intentions } from './Step1Intentions';
import { Step2Refine } from './Step2Refine';
import { Step3Schedule } from './Step3Schedule';
import { Step4StartMusic } from './Step4StartMusic';

const STEPS = [
    Step1Intentions,
    Step2Refine,
    Step3Schedule,
    Step4StartMusic,
];

export function Wizard() {
    const { plan } = useDayPlan();
    const StepComponent = STEPS[plan.wizardStep - 1] ?? Step1Intentions;
    return <StepComponent />;
}
