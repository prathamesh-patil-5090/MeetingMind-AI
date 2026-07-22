import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { ImportPage } from './pages/ImportPage';
import { MeetingDetailPage } from './pages/MeetingDetailPage';
import { RecordPage } from './pages/RecordPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="record" element={<RecordPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="meetings/:id" element={<MeetingDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
