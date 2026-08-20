import { STEPS, completedCountForStatus } from "../domain/project.js";

export function Stepper({ project }) {
  const completed = completedCountForStatus(project.status);

  return (
    <ol className="stepper" aria-label="Pipeline progress">
      {STEPS.map((step, index) => {
        const state = index < completed ? "done" : step.key === project.currentStep ? "current" : "pending";
        return (
          <li className={`step ${state}`} key={step.key}>
            <span className="step-number" aria-hidden="true">
              {state === "done" ? <>&#10003;</> : index + 1}
            </span>
            <span>
              <span className="step-label">{step.label}</span>
              <span className="step-state">{state === "current" ? "Current" : state}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
