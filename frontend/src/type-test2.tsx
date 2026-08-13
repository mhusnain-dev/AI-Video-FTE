import type { ReactNode, ReactElement } from 'react';

interface AdmissionResult {
  passed: boolean;
}

function AdmissionResultDisplay({ admission }: { admission: AdmissionResult }): ReactElement {
  return <div>test</div>;
}

function getAdmissionJSX(admission: AdmissionResult | undefined, onView: () => void): ReactNode | null {
  if (!admission) return null;
  return <AdmissionResultDisplay admission={admission} />;
}

function renderFaceLockResults(): ReactNode | null {
  return null;
}

// This mimics ShotDetailPanel exactly - no return type, multiple conditional JSX
function TestComponent(admission?: AdmissionResult) {
  const getJSX = () => getAdmissionJSX(admission, () => {});
  const renderFL = () => renderFaceLockResults();

  return (
    <div>
      <p>test</p>
      {renderFL()}  // first conditional
      {getJSX()}    // second conditional - mimics line 338
      {true && <div>third conditional</div>}  // third conditional - mimics line 341
    </div>
  );
}
