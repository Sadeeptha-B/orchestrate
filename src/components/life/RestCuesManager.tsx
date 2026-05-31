import { Card } from '../ui/Card';
import { LifeShell } from './LifeShell';
import { RestCuesEditor } from './RestCuesEditor';

export function RestCuesManager() {
    return (
        <LifeShell
            title="True Rest cues"
            subtitle="Non-stimulating recovery prompts surfaced on the dashboard and during low-energy check-ins. No completion, no streak — just gentle nudges."
            crumbs={[{ label: 'Rest cues', to: '/rest-cues' }]}
        >
            <Card>
                <RestCuesEditor />
            </Card>
        </LifeShell>
    );
}
