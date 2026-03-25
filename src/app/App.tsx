import { RouterProvider } from 'react-router';
import { router } from './routes';
import AccessGate from './components/AccessGate';

export default function App() {
  return (
    <AccessGate>
      <RouterProvider router={router} />
    </AccessGate>
  );
}