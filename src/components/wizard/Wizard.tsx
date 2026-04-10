import { useDayPlan } from '../../context/DayPlanContext';
import { Step1Priorities } from './Step1Priorities';
import { Step2TodolistSync } from './Step2TodolistSync';
import { Step3Categorize } from './Step3Categorize';
import { Step4ScheduleMain } from './Step4ScheduleMain';
import { Step5ScheduleBackground } from './Step5ScheduleBackground';
import { Step6StartMusic } from './Step6StartMusic';

const STEPS = [
    Step1Priorities,
    Step2TodolistSync,
    Step3Categorize,
    Step4ScheduleMain,
    Step5ScheduleBackground,
    Step6StartMusic,
];

export function Wizard() {
    const { plan } = useDayPlan();
    const StepComponent = STEPS[plan.wizardStep - 1] ?? Step1Priorities;
    return <StepComponent />;
}
