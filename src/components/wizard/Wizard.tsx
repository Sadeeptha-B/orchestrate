import { useDayPlan } from '../../context/DayPlanContext';
import { Step1Intentions } from './Step1Intentions';
import { Step2Categorize } from './Step2Categorize';
import { Step3ScheduleMain } from './Step3ScheduleMain';
import { Step4ScheduleBackground } from './Step4ScheduleBackground';
import { Step5StartMusic } from './Step5StartMusic';

const STEPS = [
    Step1Intentions,
    Step2Categorize,
    Step3ScheduleMain,
    Step4ScheduleBackground,
    Step5StartMusic,
];

export function Wizard() {
    const { plan } = useDayPlan();
    const StepComponent = STEPS[plan.wizardStep - 1] ?? Step1Intentions;
    return <StepComponent />;
}
